import {
  evaluationsRepository,
  testCasesRepository,
  criteriaRepository,
  runsRepository,
  testCaseResultsRepository,
  type EvaluationWithRelations,
} from '../repositories/evaluations.repository.js';
import { prisma } from '../config/database.js';
import { transformResponse, transformDecimal } from '../utils/transform.js';
import { AppError } from '@ssrprompt/shared';
import type { Prisma, StoredFile, TestCase, EvaluationCriterion, EvaluationRun, TestCaseResult } from '@prisma/client';
import { filesService, type DownloadRange } from './files.service.js';
import { abortEvaluationRun, enqueueEvaluationRetryScores, enqueueEvaluationRun } from './evaluation-queue.service.js';

type LegacyBase64Attachment = { name: string; type: string; base64: string };
type StoredAttachment = { fileId: string; name: string; type: string; size: number };

function normalizeBase64(value: string): string {
  const comma = value.indexOf(',');
  if (value.startsWith('data:') && comma !== -1) {
    return value.slice(comma + 1);
  }
  return value;
}

function isLegacyBase64Attachments(value: unknown): value is LegacyBase64Attachment[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return (
      typeof record.name === 'string' &&
      typeof record.type === 'string' &&
      typeof record.base64 === 'string' &&
      record.base64.length > 0
    );
  });
}

function isStoredAttachments(value: unknown): value is StoredAttachment[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return typeof record.fileId === 'string' && typeof record.name === 'string' && typeof record.type === 'string';
  });
}

function normalizeCaseConcurrency(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.floor(parsed));
}

function getDefaultCaseConcurrencyFromEnv(): number {
  const configured = normalizeCaseConcurrency(process.env.EVALUATION_CASE_CONCURRENCY);
  return configured ?? 1;
}

function withEvaluationExecutionDefaults<T extends { config?: unknown }>(evaluation: T): T {
  const defaultCaseConcurrency = getDefaultCaseConcurrencyFromEnv();
  const nextConfig =
    evaluation.config && typeof evaluation.config === 'object' && !Array.isArray(evaluation.config)
      ? { ...(evaluation.config as Record<string, unknown>) }
      : {};

  nextConfig.case_concurrency = defaultCaseConcurrency;
  delete nextConfig.execution_mode;

  (evaluation as { config?: unknown }).config = nextConfig;
  return evaluation;
}

async function materializeAttachmentsForUser(
  fromUserId: string,
  toUserId: string,
  rawAttachments: unknown
): Promise<StoredAttachment[]> {
  if (!rawAttachments || !Array.isArray(rawAttachments) || rawAttachments.length === 0) return [];

  if (isStoredAttachments(rawAttachments)) {
    if (fromUserId === toUserId) return rawAttachments;

    const cloned = await Promise.all(
      rawAttachments.map(async (attachment) => {
        try {
          const { meta, buffer } = await filesService.downloadBuffer(fromUserId, attachment.fileId);
          const stored = await filesService.upload(toUserId, {
            originalName: attachment.name || meta.originalName,
            mimeType: attachment.type || meta.mimeType,
            size: buffer.length,
            buffer,
          });
          return {
            fileId: stored.id,
            name: stored.originalName,
            type: stored.mimeType,
            size: stored.size,
          } satisfies StoredAttachment;
        } catch {
          return null;
        }
      })
    );

    return cloned.filter((item): item is StoredAttachment => item !== null);
  }

  if (isLegacyBase64Attachments(rawAttachments)) {
    const migrated: StoredAttachment[] = [];
    for (const attachment of rawAttachments) {
      const buffer = Buffer.from(normalizeBase64(attachment.base64), 'base64');
      const stored = await filesService.upload(toUserId, {
        originalName: attachment.name,
        mimeType: attachment.type,
        size: buffer.length,
        buffer,
      });
      migrated.push({
        fileId: stored.id,
        name: stored.originalName,
        type: stored.mimeType,
        size: stored.size,
      });
    }
    return migrated;
  }

  return [];
}

/**
 * Evaluations Service
 */
export class EvaluationsService {
  private async assertPromptAccessible(
    userId: string,
    promptId: string
  ): Promise<{ id: string; isPublic: boolean }> {
    const prompt = await prisma.prompt.findFirst({
      where: {
        id: promptId,
        OR: [{ userId }, { isPublic: true }],
      },
      select: { id: true, isPublic: true },
    });

    if (!prompt) {
      throw new AppError(404, 'NOT_FOUND', 'Prompt not found');
    }

    return prompt;
  }

  private async assertModelAccessible(userId: string, modelId: string): Promise<void> {
    const model = await prisma.model.findUnique({
      where: { id: modelId },
      select: {
        id: true,
        provider: {
          select: { userId: true, isSystem: true },
        },
      },
    });

    if (!model) {
      throw new AppError(404, 'NOT_FOUND', 'Model not found');
    }

    if (model.provider.userId !== userId && !model.provider.isSystem) {
      throw new AppError(403, 'FORBIDDEN', 'Access denied to this model');
    }
  }

  /**
   * Verify the evaluation is owned by the current user (not just readable/public).
   */
  async assertOwner(userId: string, evaluationId: string): Promise<void> {
    await evaluationsRepository.findByIdOrThrow(userId, evaluationId);
  }

  /**
   * Get all evaluations for a user
   */
  async findAll(userId: string): Promise<EvaluationWithRelations[]> {
    const evaluations = await evaluationsRepository.findAll(userId);
    return evaluations.map((e) => transformResponse(e));
  }

  /**
   * Get evaluation by ID with all relations
   */
  async findById(userId: string, id: string): Promise<EvaluationWithRelations> {
    const evaluation = await evaluationsRepository.findByIdWithRelations(userId, id);
    if (!evaluation) {
      throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
    }

    // For non-owner views (public evaluations), attachments are hidden by default because they are tenant-scoped
    // files and may contain sensitive data. If the owner explicitly enables sharing, only expose stored file refs.
    if (evaluation.userId !== userId) {
      if (evaluation.testCases && evaluation.testCases.length > 0) {
        for (const testCase of evaluation.testCases) {
          const rawAttachments = (testCase.attachments ?? []) as unknown;
          const shouldExposeAttachments = evaluation.shareAttachments && isStoredAttachments(rawAttachments);
          if (!shouldExposeAttachments) {
            (testCase as unknown as { attachments: unknown }).attachments = [];
          }
        }
      }
      return withEvaluationExecutionDefaults(transformResponse(evaluation));
    }

    // Lazy-migrate legacy base64 attachments to stored files for owner views.
    if (evaluation.userId === userId && evaluation.testCases && evaluation.testCases.length > 0) {
      for (const testCase of evaluation.testCases) {
        const rawAttachments = (testCase.attachments ?? []) as unknown;
        if (!rawAttachments || isStoredAttachments(rawAttachments) || !isLegacyBase64Attachments(rawAttachments)) {
          continue;
        }

        const migrated: StoredAttachment[] = [];
        for (const attachment of rawAttachments) {
          const buffer = Buffer.from(normalizeBase64(attachment.base64), 'base64');
          const stored = await filesService.upload(userId, {
            originalName: attachment.name,
            mimeType: attachment.type,
            size: buffer.length,
            buffer,
          });
          migrated.push({
            fileId: stored.id,
            name: stored.originalName,
            type: stored.mimeType,
            size: stored.size,
          });
        }

        await testCasesRepository.update(testCase.id, {
          attachments: migrated as unknown as Prisma.JsonArray,
        });

        // Ensure the response matches the migrated state without an extra fetch.
        (testCase as unknown as { attachments: unknown }).attachments = migrated;
      }
    }

    return withEvaluationExecutionDefaults(transformResponse(evaluation));
  }

  async downloadAttachment(
    requesterUserId: string,
    evaluationId: string,
    fileId: string,
    range: DownloadRange
  ): Promise<{
    meta: StoredFile;
    body: unknown;
    contentLength?: number;
    contentRange?: string;
  }> {
    const evaluation = await evaluationsRepository.findByIdWithRelations(requesterUserId, evaluationId);
    if (!evaluation) {
      throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
    }

    const isOwner = evaluation.userId === requesterUserId;
    if (!isOwner && !evaluation.shareAttachments) {
      throw new AppError(403, 'FORBIDDEN', 'Attachments are not shared for this evaluation');
    }

    const testCases = evaluation.testCases ?? [];
    const allowedFileIds = new Set<string>();
    for (const testCase of testCases) {
      const rawAttachments = (testCase.attachments ?? []) as unknown;
      if (!isStoredAttachments(rawAttachments)) continue;
      for (const attachment of rawAttachments) {
        allowedFileIds.add(attachment.fileId);
      }
    }

    if (!allowedFileIds.has(fileId)) {
      throw new AppError(404, 'NOT_FOUND', 'File not found');
    }

    // Serve the attachment using the owner's tenant scope.
    return filesService.download(evaluation.userId, fileId, range);
  }

  /**
   * Create a new evaluation
   */
  async create(
    userId: string,
    data: {
      name: string;
      promptId?: string;
      modelId?: string;
      judgeModelId?: string;
      config?: Record<string, unknown>;
      orderIndex?: number;
      testCases?: Array<{
        name?: string;
        inputText: string;
        inputVariables?: Record<string, unknown>;
        attachments?: unknown[];
        expectedOutput?: string;
        notes?: string;
      }>;
      criteria?: Array<{
        name: string;
        description?: string;
        prompt?: string;
        weight?: number;
        enabled?: boolean;
      }>;
    }
  ): Promise<EvaluationWithRelations> {
    if (data.promptId) {
      await this.assertPromptAccessible(userId, data.promptId);
    }
    if (data.modelId) {
      await this.assertModelAccessible(userId, data.modelId);
    }
    if (data.judgeModelId) {
      await this.assertModelAccessible(userId, data.judgeModelId);
    }

    const evaluation = await evaluationsRepository.createWithRelations(
      userId,
      {
        name: data.name,
        prompt: data.promptId ? { connect: { id: data.promptId } } : undefined,
        model: data.modelId ? { connect: { id: data.modelId } } : undefined,
        judgeModel: data.judgeModelId ? { connect: { id: data.judgeModelId } } : undefined,
        config: (data.config as Prisma.JsonObject) || {},
        orderIndex: data.orderIndex,
      },
      data.testCases?.map((tc) => ({
        name: tc.name || '',
        inputText: tc.inputText,
        inputVariables: (tc.inputVariables as Prisma.JsonObject) || {},
        attachments: (tc.attachments as Prisma.JsonArray) || [],
        expectedOutput: tc.expectedOutput,
        notes: tc.notes,
      })),
      data.criteria?.map((c) => ({
        name: c.name,
        description: c.description,
        prompt: c.prompt,
        weight: c.weight,
        enabled: c.enabled ?? true,
      }))
    );

    return transformResponse(evaluation);
  }

  /**
   * Update an evaluation
   */
  async update(
    userId: string,
    id: string,
    data: {
      name?: string;
      promptId?: string | null;
      modelId?: string | null;
      judgeModelId?: string | null;
      status?: 'pending' | 'running' | 'completed' | 'failed';
      config?: Record<string, unknown>;
      results?: Record<string, unknown>;
      isPublic?: boolean;
      shareAttachments?: boolean;
      orderIndex?: number;
      completedAt?: string | null;
    }
  ): Promise<EvaluationWithRelations> {
    const existing = await evaluationsRepository.findByIdOrThrow(userId, id);

    const updateData: Prisma.EvaluationUpdateInput = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.config !== undefined) updateData.config = data.config as Prisma.JsonObject;
    if (data.results !== undefined) updateData.results = data.results as Prisma.JsonObject;
    if (data.isPublic !== undefined) updateData.isPublic = data.isPublic;
    if (data.shareAttachments !== undefined) updateData.shareAttachments = data.shareAttachments;
    if (data.orderIndex !== undefined) updateData.orderIndex = data.orderIndex;

    if (data.completedAt !== undefined) {
      updateData.completedAt = data.completedAt ? new Date(data.completedAt) : null;
    }

    // Handle relation updates
    if (data.promptId !== undefined) {
      if (data.promptId) {
        await this.assertPromptAccessible(userId, data.promptId);
      }
      updateData.prompt = data.promptId ? { connect: { id: data.promptId } } : { disconnect: true };
    }
    if (data.modelId !== undefined) {
      if (data.modelId) {
        await this.assertModelAccessible(userId, data.modelId);
      }
      updateData.model = data.modelId ? { connect: { id: data.modelId } } : { disconnect: true };
    }
    if (data.judgeModelId !== undefined) {
      if (data.judgeModelId) {
        await this.assertModelAccessible(userId, data.judgeModelId);
      }
      updateData.judgeModel = data.judgeModelId ? { connect: { id: data.judgeModelId } } : { disconnect: true };
    }

    if (data.status === 'completed' || data.status === 'failed') {
      updateData.completedAt = new Date();
    }
    if (data.status === 'pending' || data.status === 'running') {
      updateData.completedAt = null;
    }

    // Guardrail: a public evaluation must not reference a private prompt.
    const nextPromptId =
      data.promptId !== undefined ? (data.promptId ?? null) : (existing.promptId ?? null);

    // Invariant: cannot inherit model parameters from a prompt when no prompt is linked.
    // If a prompt reference is dropped (e.g. copying public evaluations with private prompts),
    // auto-clear `inherited_from_prompt` to avoid inconsistent state in UI and runner logic.
    if (!nextPromptId) {
      const effectiveConfig =
        data.config && typeof data.config === 'object' && !Array.isArray(data.config)
          ? (data.config as Prisma.JsonObject)
          : existing.config && typeof existing.config === 'object' && !Array.isArray(existing.config)
            ? (existing.config as Prisma.JsonObject)
            : {};
      const inherited = (effectiveConfig as Record<string, unknown>).inherited_from_prompt;
      if (inherited === true) {
        updateData.config = { ...effectiveConfig, inherited_from_prompt: false };
      }
    }

    const nextIsPublic =
      data.isPublic !== undefined ? data.isPublic : existing.isPublic;

    const nextShareAttachments =
      data.shareAttachments !== undefined ? data.shareAttachments : existing.shareAttachments;

    // Keep invariants: attachments can only be shared when the evaluation is public.
    if (!nextIsPublic && nextShareAttachments) {
      updateData.shareAttachments = false;
    }

    if (nextIsPublic && nextPromptId) {
      const prompt = await prisma.prompt.findUnique({
        where: { id: nextPromptId },
        select: { isPublic: true },
      });

      // If user explicitly tries to publish, block. Otherwise auto-unpublish to keep invariants.
      if (!prompt?.isPublic) {
        if (data.isPublic === true) {
          throw new AppError(400, 'VALIDATION_ERROR', 'Cannot publish an evaluation for a private prompt');
        }
        updateData.isPublic = false;
      }
    }

    await evaluationsRepository.update(userId, id, updateData);
    return this.findById(userId, id);
  }

  /**
   * Delete an evaluation
   */
  async delete(userId: string, id: string): Promise<void> {
    await this.assertOwner(userId, id);
    await evaluationsRepository.delete(userId, id);
  }

  /**
   * Copy an evaluation
   */
  async copy(userId: string, id: string, newName?: string): Promise<EvaluationWithRelations> {
    const original = await evaluationsRepository.findByIdWithRelations(userId, id);
    if (!original) {
      throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
    }

    const nextPromptId = original.promptId ?? null;
    const nextModelId = original.modelId ?? null;
    const nextJudgeModelId = original.judgeModelId ?? null;

    // If any referenced entities are not accessible for the copier, drop the reference instead of failing the copy.
    // This keeps copy usable when system models/providers change or legacy rows exist.
    const resolvedPromptId = await (async () => {
      if (!nextPromptId) return null;
      try {
        await this.assertPromptAccessible(userId, nextPromptId);
        return nextPromptId;
      } catch {
        return null;
      }
    })();

    const resolvedModelId = await (async () => {
      if (!nextModelId) return null;
      try {
        await this.assertModelAccessible(userId, nextModelId);
        return nextModelId;
      } catch {
        return null;
      }
    })();

    const resolvedJudgeModelId = await (async () => {
      if (!nextJudgeModelId) return null;
      try {
        await this.assertModelAccessible(userId, nextJudgeModelId);
        return nextJudgeModelId;
      } catch {
        return null;
      }
    })();

    const allowAttachmentCopy = original.userId === userId || original.shareAttachments;
    const copiedConfigBase =
      original.config && typeof original.config === 'object' && !Array.isArray(original.config)
        ? (original.config as Prisma.JsonObject)
        : {};
    const copiedConfig: Prisma.JsonObject = resolvedPromptId
      ? copiedConfigBase
      : { ...copiedConfigBase, inherited_from_prompt: false };

    const copiedTestCases = original.testCases
      ? await Promise.all(
          original.testCases.map(async (tc) => {
            const rawAttachments = (tc.attachments ?? []) as unknown;
            const attachments = allowAttachmentCopy
              ? await materializeAttachmentsForUser(original.userId, userId, rawAttachments)
              : [];

            return {
              name: tc.name,
              inputText: tc.inputText,
              inputVariables: tc.inputVariables as Prisma.JsonObject,
              attachments: attachments as unknown as Prisma.JsonArray,
              expectedOutput: tc.expectedOutput,
              notes: tc.notes,
              orderIndex: tc.orderIndex,
            } satisfies Omit<Prisma.TestCaseCreateInput, 'evaluation'>;
          })
        )
      : undefined;

    const copiedCriteria = original.criteria
      ? original.criteria.map((c) => ({
          name: c.name,
          description: c.description ?? undefined,
          prompt: c.prompt ?? undefined,
          weight: c.weight,
          enabled: c.enabled,
        } satisfies Omit<Prisma.EvaluationCriterionCreateInput, 'evaluation'>))
      : undefined;

    const evaluation = await evaluationsRepository.createWithRelations(
      userId,
      {
        name: newName || `${original.name} (Copy)`,
        prompt: resolvedPromptId ? { connect: { id: resolvedPromptId } } : undefined,
        model: resolvedModelId ? { connect: { id: resolvedModelId } } : undefined,
        judgeModel: resolvedJudgeModelId ? { connect: { id: resolvedJudgeModelId } } : undefined,
        config: copiedConfig,
        results: {},
        status: 'pending',
        isPublic: false,
      },
      copiedTestCases,
      copiedCriteria
    );

    return transformResponse(evaluation);
  }

  /**
   * Update order for multiple evaluations
   */
  async updateOrder(userId: string, updates: { id: string; orderIndex: number }[]): Promise<void> {
    await evaluationsRepository.updateOrder(userId, updates);
  }

  /**
   * Get evaluations associated with a specific prompt.
   * Returns lightweight list for the evaluation selector.
   */
  async getEvaluationsByPromptId(userId: string, promptId: string) {
    const evaluations = await evaluationsRepository.findByPromptId(userId, promptId);

    return evaluations.map((ev) => ({
      id: ev.id,
      name: ev.name,
      modelName: ev.model?.name || ev.model?.modelId || 'Unknown',
      judgeModelName: ev.judgeModel?.name || ev.judgeModel?.modelId || 'Unknown',
      runCount: ev._count.runs,
      latestRunAt: ev.runs[0]?.createdAt ? new Date(ev.runs[0].createdAt).toISOString() : null,
      avgPassRate: 0, // Will be populated by getSummary if needed
    }));
  }

  /**
   * Get aggregated evaluation summary for a specific evaluation.
   * Computes: average pass rate, criterion scores, latency, token usage,
   * top failure cases, and recent trend delta.
   */
  async getEvaluationSummary(userId: string, evaluationId: string) {
    const runs = await evaluationsRepository.findCompletedRunsByEvaluationId(userId, evaluationId);

    if (runs.length === 0) {
      // Initialization state: return evaluation metadata and test cases even before the first run.
      const evaluation = await this.findById(userId, evaluationId);
      const criteriaNames = (evaluation.criteria || [])
        .filter((criterion) => criterion.enabled)
        .map((criterion) => criterion.name);
      const testCaseStats = (evaluation.testCases || []).map((testCase) => ({
        testCaseId: testCase.id,
        testCaseName: testCase.name,
        inputText: testCase.inputText,
        inputVariables: (testCase.inputVariables as Record<string, string>) || {},
        expectedOutput: testCase.expectedOutput,
        passCount: 0,
        totalCount: 0,
        latestPassed: false,
        latestScore: 0,
        latestModelOutput: '',
      }));

      return {
        evaluationId,
        evaluationName: evaluation.name,
        modelName: evaluation.model?.name || evaluation.model?.modelId || 'Unknown',
        judgeModelName: evaluation.judgeModel?.name || evaluation.judgeModel?.modelId || 'Unknown',
        totalRuns: 0,
        latestRunAt: null,
        avgPassRate: 0,
        avgCriterionScores: {},
        avgLatencyMs: 0,
        avgTokens: 0,
        topFailures: [],
        criteriaNames,
        testCaseStats,
      };
    }

    // All runs share the same evaluation - use the first one for metadata
    const evaluation = runs[0].evaluation;
    const evaluationName = evaluation.name;
    const modelName = evaluation.model?.name || evaluation.model?.modelId || 'Unknown';
    const judgeModelName = evaluation.judgeModel?.name || evaluation.judgeModel?.modelId || 'Unknown';
    const criteriaNames = evaluation.criteria
      .filter((c) => c.enabled)
      .map((c) => c.name);

    // Build test case name lookup
    const testCaseNameMap = new Map<string, string>();
    const testCaseExpectedMap = new Map<string, string | null>();
    for (const tc of evaluation.testCases) {
      testCaseNameMap.set(tc.id, tc.name);
      testCaseExpectedMap.set(tc.id, tc.expectedOutput);
    }

    // Aggregate pass rates per run
    const runPassRates: number[] = [];
    let totalLatencyMs = 0;
    let totalTokens = 0;
    let totalResultCount = 0;

    // Criterion score accumulation
    const criterionScoreSums: Record<string, number> = {};
    const criterionScoreCounts: Record<string, number> = {};

    // Failure tracking per test case
    const failureMap = new Map<string, {
      failCount: number;
      totalCount: number;
      latestModelOutput: string;
      latestAiFeedback: Record<string, string>;
      latestScores: Record<string, number>;
    }>();

    for (const run of runs) {
      const results = run.testCaseResults;
      if (results.length === 0) continue;

      const passedCount = results.filter((r) => r.passed).length;
      runPassRates.push(passedCount / results.length);

      for (const result of results) {
        totalResultCount++;
        totalLatencyMs += result.latencyMs;
        totalTokens += result.tokensInput + result.tokensOutput;

        // Accumulate criterion scores (handle Decimal types)
        const scores = result.scores as Record<string, unknown>;
        if (scores) {
          for (const [key, val] of Object.entries(scores)) {
            const numVal = typeof val === 'object' && val !== null
              ? Number(transformDecimal(val))
              : Number(val);
            if (!isNaN(numVal)) {
              criterionScoreSums[key] = (criterionScoreSums[key] || 0) + numVal;
              criterionScoreCounts[key] = (criterionScoreCounts[key] || 0) + 1;
            }
          }
        }

        // Track failures
        if (!result.passed) {
          const existing = failureMap.get(result.testCaseId);
          if (existing) {
            existing.failCount++;
            existing.totalCount++;
            // Update latest output/feedback (runs are ordered desc, so first occurrence is latest)
          } else {
            failureMap.set(result.testCaseId, {
              failCount: 1,
              totalCount: 1,
              latestModelOutput: result.modelOutput || '',
              latestAiFeedback: (result.aiFeedback as Record<string, string>) || {},
              latestScores: transformDecimal(scores as Record<string, number>) || {},
            });
          }
        } else {
          // Track total count for passed results too
          const existing = failureMap.get(result.testCaseId);
          if (existing) {
            existing.totalCount++;
          }
        }
      }
    }

    // Calculate averages
    const avgPassRate = runPassRates.length > 0
      ? runPassRates.reduce((a, b) => a + b, 0) / runPassRates.length
      : 0;

    const avgCriterionScores: Record<string, number> = {};
    for (const [key, sum] of Object.entries(criterionScoreSums)) {
      avgCriterionScores[key] = sum / (criterionScoreCounts[key] || 1);
    }

    const avgLatencyMs = totalResultCount > 0 ? totalLatencyMs / totalResultCount : 0;
    const avgTokens = totalResultCount > 0 ? totalTokens / totalResultCount : 0;

    // Sort failures by fail count descending, take top 10
    const topFailures = Array.from(failureMap.entries())
      .sort(([, a], [, b]) => b.failCount - a.failCount)
      .slice(0, 10)
      .map(([testCaseId, data]) => ({
        testCaseId,
        testCaseName: testCaseNameMap.get(testCaseId) || 'Unknown',
        failCount: data.failCount,
        totalCount: data.totalCount,
        latestModelOutput: data.latestModelOutput,
        latestAiFeedback: data.latestAiFeedback,
        expectedOutput: testCaseExpectedMap.get(testCaseId) || null,
        latestScores: data.latestScores,
      }));

    // Build testCaseStats for ALL test cases (for the verification panel)
    // Track per-testCase pass/fail across all runs
    const testCaseAggMap = new Map<string, {
      passCount: number;
      totalCount: number;
      latestPassed: boolean;
      latestScore: number;
      latestModelOutput: string;
    }>();

    // Process runs in order (newest first) to get "latest" values from first occurrence
    for (const run of runs) {
      for (const result of run.testCaseResults) {
        const existing = testCaseAggMap.get(result.testCaseId);
        if (existing) {
          existing.totalCount++;
          if (result.passed) existing.passCount++;
        } else {
          // First occurrence = latest run (runs are sorted desc)
          const scores = result.scores as Record<string, unknown>;
          const scoreValues = scores ? Object.values(scores).map(v =>
            typeof v === 'object' && v !== null ? Number(transformDecimal(v)) : Number(v)
          ).filter(n => !isNaN(n)) : [];
          const avgScore = scoreValues.length > 0
            ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length
            : 0;

          testCaseAggMap.set(result.testCaseId, {
            passCount: result.passed ? 1 : 0,
            totalCount: 1,
            latestPassed: result.passed,
            latestScore: avgScore,
            latestModelOutput: result.modelOutput || '',
          });
        }
      }
    }

    const testCaseStats = evaluation.testCases.map((tc) => {
      const stats = testCaseAggMap.get(tc.id);
      return {
        testCaseId: tc.id,
        testCaseName: tc.name,
        inputText: tc.inputText,
        inputVariables: (tc.inputVariables as Record<string, string>) || {},
        expectedOutput: tc.expectedOutput,
        passCount: stats?.passCount ?? 0,
        totalCount: stats?.totalCount ?? 0,
        latestPassed: stats?.latestPassed ?? true,
        latestScore: stats?.latestScore ?? 0,
        latestModelOutput: stats?.latestModelOutput ?? '',
      };
    });

    // Calculate recent delta (compare two most recent runs)
    let recentDelta: { passRateChange: number; criterionChanges: Record<string, number> } | undefined;
    if (runs.length >= 2) {
      const latestRun = runs[0];
      const previousRun = runs[1];

      const latestResults = latestRun.testCaseResults;
      const previousResults = previousRun.testCaseResults;

      if (latestResults.length > 0 && previousResults.length > 0) {
        const latestPassRate = latestResults.filter((r) => r.passed).length / latestResults.length;
        const prevPassRate = previousResults.filter((r) => r.passed).length / previousResults.length;

        const criterionChanges: Record<string, number> = {};
        // Calculate per-criterion score changes
        const latestCriterionAvgs: Record<string, { sum: number; count: number }> = {};
        const prevCriterionAvgs: Record<string, { sum: number; count: number }> = {};

        for (const r of latestResults) {
          const scores = r.scores as Record<string, unknown>;
          if (scores) {
            for (const [key, val] of Object.entries(scores)) {
              const numVal = Number(typeof val === 'object' && val !== null ? transformDecimal(val) : val);
              if (!isNaN(numVal)) {
                if (!latestCriterionAvgs[key]) latestCriterionAvgs[key] = { sum: 0, count: 0 };
                latestCriterionAvgs[key].sum += numVal;
                latestCriterionAvgs[key].count++;
              }
            }
          }
        }

        for (const r of previousResults) {
          const scores = r.scores as Record<string, unknown>;
          if (scores) {
            for (const [key, val] of Object.entries(scores)) {
              const numVal = Number(typeof val === 'object' && val !== null ? transformDecimal(val) : val);
              if (!isNaN(numVal)) {
                if (!prevCriterionAvgs[key]) prevCriterionAvgs[key] = { sum: 0, count: 0 };
                prevCriterionAvgs[key].sum += numVal;
                prevCriterionAvgs[key].count++;
              }
            }
          }
        }

        for (const key of Object.keys(latestCriterionAvgs)) {
          const latestAvg = latestCriterionAvgs[key].sum / latestCriterionAvgs[key].count;
          const prevAvg = prevCriterionAvgs[key]
            ? prevCriterionAvgs[key].sum / prevCriterionAvgs[key].count
            : 0;
          criterionChanges[key] = latestAvg - prevAvg;
        }

        recentDelta = {
          passRateChange: latestPassRate - prevPassRate,
          criterionChanges,
        };
      }
    }

    const latestRunAt = runs[0]?.createdAt
      ? new Date(runs[0].createdAt).toISOString()
      : null;

    return {
      evaluationId,
      evaluationName,
      modelName,
      judgeModelName,
      totalRuns: runs.length,
      latestRunAt,
      avgPassRate,
      avgCriterionScores,
      avgLatencyMs,
      avgTokens,
      topFailures,
      recentDelta,
      criteriaNames,
      testCaseStats,
    };
  }
}

/**
 * Test Cases Service
 */
export class TestCasesService {
  private evaluationsService = new EvaluationsService();

  /**
   * Create a test case
   */
  async create(
    userId: string,
    evaluationId: string,
    data: {
      name?: string;
      inputText?: string;
      inputVariables?: Record<string, unknown>;
      attachments?: unknown[];
      expectedOutput?: string;
      notes?: string;
      orderIndex?: number;
    }
  ): Promise<TestCase> {
    // Verify evaluation ownership
    await this.evaluationsService.assertOwner(userId, evaluationId);

    const testCase = await testCasesRepository.create(evaluationId, {
      name: data.name || '',
      inputText: data.inputText || '',
      inputVariables: (data.inputVariables as Prisma.JsonObject) || {},
      attachments: (data.attachments as Prisma.JsonArray) || [],
      expectedOutput: data.expectedOutput,
      notes: data.notes,
      orderIndex: data.orderIndex,
    });

    return transformResponse(testCase);
  }

  /**
   * Update a test case
   */
  async update(
    userId: string,
    id: string,
    data: {
      name?: string;
      inputText?: string;
      inputVariables?: Record<string, unknown>;
      attachments?: unknown[];
      expectedOutput?: string | null;
      notes?: string | null;
      orderIndex?: number;
    }
  ): Promise<TestCase> {
    const testCase = await testCasesRepository.findById(id);
    if (!testCase) {
      throw new AppError(404, 'NOT_FOUND', 'Test case not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.assertOwner(userId, testCase.evaluationId);

    const updateData: Prisma.TestCaseUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.inputText !== undefined) updateData.inputText = data.inputText;
    if (data.inputVariables !== undefined) updateData.inputVariables = data.inputVariables as Prisma.JsonObject;
    if (data.attachments !== undefined) updateData.attachments = data.attachments as Prisma.JsonArray;
    if (data.expectedOutput !== undefined) updateData.expectedOutput = data.expectedOutput;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.orderIndex !== undefined) updateData.orderIndex = data.orderIndex;

    const updated = await testCasesRepository.update(id, updateData);
    return transformResponse(updated);
  }

  /**
   * Delete a test case
   */
  async delete(userId: string, id: string): Promise<void> {
    const testCase = await testCasesRepository.findById(id);
    if (!testCase) {
      throw new AppError(404, 'NOT_FOUND', 'Test case not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.assertOwner(userId, testCase.evaluationId);

    await testCasesRepository.delete(id);
  }
}

/**
 * Criteria Service
 */
export class CriteriaService {
  private evaluationsService = new EvaluationsService();

  /**
   * Create a criterion
   */
  async create(
    userId: string,
    evaluationId: string,
    data: {
      name: string;
      description?: string;
      prompt?: string;
      weight?: number;
      enabled?: boolean;
    }
  ): Promise<EvaluationCriterion> {
    // Verify evaluation ownership
    await this.evaluationsService.assertOwner(userId, evaluationId);

    const criterion = await criteriaRepository.create(evaluationId, {
      name: data.name,
      description: data.description,
      prompt: data.prompt,
      weight: data.weight,
      enabled: data.enabled ?? true,
    });

    return transformDecimal(criterion);
  }

  /**
   * Update a criterion
   */
  async update(
    userId: string,
    id: string,
    data: {
      name?: string;
      description?: string | null;
      prompt?: string | null;
      weight?: number;
      enabled?: boolean;
    }
  ): Promise<EvaluationCriterion> {
    const criterion = await criteriaRepository.findById(id);
    if (!criterion) {
      throw new AppError(404, 'NOT_FOUND', 'Criterion not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.assertOwner(userId, criterion.evaluationId);

    const updateData: Prisma.EvaluationCriterionUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.prompt !== undefined) updateData.prompt = data.prompt;
    if (data.weight !== undefined) updateData.weight = data.weight;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;

    const updated = await criteriaRepository.update(id, updateData);
    return transformDecimal(updated);
  }

  /**
   * Delete a criterion
   */
  async delete(userId: string, id: string): Promise<void> {
    const criterion = await criteriaRepository.findById(id);
    if (!criterion) {
      throw new AppError(404, 'NOT_FOUND', 'Criterion not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.assertOwner(userId, criterion.evaluationId);

    await criteriaRepository.delete(id);
  }
}

/**
 * Runs Service
 */
export class RunsService {
  private evaluationsService = new EvaluationsService();

  private async getRunProgressStats(runId: string): Promise<{ completedCases: number; passedCases: number }> {
    const grouped = await prisma.testCaseResult.groupBy({
      by: ['passed'],
      where: { runId },
      _count: { _all: true },
    });

    let completedCases = 0;
    let passedCases = 0;

    for (const row of grouped) {
      const count = row._count._all;
      completedCases += count;
      if (row.passed) {
        passedCases += count;
      }
    }

    return { completedCases, passedCases };
  }

  /**
   * Create a new run
   */
  async create(
    userId: string,
    evaluationId: string,
    data?: {
      title?: string | null;
      modelParameters?: Record<string, unknown>;
      testCaseIds?: string[];
    },
    options?: {
      status?: 'pending' | 'running' | 'completed' | 'failed';
    }
  ): Promise<EvaluationRun> {
    // Verify evaluation ownership and get evaluation details with relations
    const evaluation = await evaluationsRepository.findByIdWithRelations(userId, evaluationId);
    if (!evaluation) {
      throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
    }
    if (evaluation.userId !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized');
    }

    const availableTestCaseIds = new Set((evaluation.testCases || []).map((tc) => tc.id));
    const selectedTestCaseIds = data?.testCaseIds?.length
      ? data.testCaseIds
      : Array.from(availableTestCaseIds);

    const invalidTestCaseIds = selectedTestCaseIds.filter((id) => !availableTestCaseIds.has(id));
    if (invalidTestCaseIds.length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Some selected test cases do not belong to this evaluation', {
        invalidTestCaseIds,
      });
    }

    const totalCases = selectedTestCaseIds.length;
    const normalizedTitle = typeof data?.title === 'string' ? data.title.trim() : null;

    // Build runConfig snapshot
    const runConfig: Record<string, unknown> = {
      promptId: evaluation.promptId,
      promptName: evaluation.prompt?.name || null,
      promptVersion: evaluation.prompt?.currentVersion || null,
      modelId: evaluation.modelId,
      modelName: evaluation.model?.name || null,
      judgeModelId: evaluation.judgeModelId,
      judgeModelName: evaluation.judgeModel?.name || null,
      passThreshold: (evaluation.config as Record<string, unknown>)?.pass_threshold,
      fileProcessing: ((evaluation.config as Record<string, unknown>)?.file_processing as string | undefined) || 'auto',
      ocrProvider: (evaluation.config as Record<string, unknown>)?.ocr_provider,
      testCaseIds: selectedTestCaseIds,
      queueTask: 'evaluation.run',
    };

    const nextStatus = options?.status ?? 'running';
    const run = await runsRepository.create(evaluationId, {
      status: nextStatus,
      title: normalizedTitle && normalizedTitle.length > 0 ? normalizedTitle : null,
      results: { totalCases, completedCases: 0 } as Prisma.JsonObject,
      modelParameters: data?.modelParameters as Prisma.JsonObject,
      runConfig: runConfig as Prisma.JsonObject,
    });

    // Sync evaluation status to match the new active run.
    try {
      await prisma.evaluation.update({
        where: { id: evaluationId },
        data: { status: nextStatus, completedAt: nextStatus === 'completed' || nextStatus === 'failed' ? new Date() : null },
      });
    } catch (e) {
      console.error('Failed to update evaluation status for new run:', e);
    }

    return transformResponse(run);
  }

  /**
   * Create a new run and enqueue server-side execution.
   */
  async createAndExecute(
    userId: string,
    evaluationId: string,
    data?: {
      title?: string | null;
      modelParameters?: Record<string, unknown>;
      testCaseIds?: string[];
    }
  ): Promise<EvaluationRun> {
    const run = await this.create(userId, evaluationId, data, { status: 'pending' });
    enqueueEvaluationRun(userId, run.id).catch((error) => {
      console.error('Failed to enqueue evaluation run:', error);
    });
    return run;
  }

  /**
   * Enqueue retrying AI scores for an existing run.
   */
  async retryScores(userId: string, runId: string): Promise<EvaluationRun> {
    const run = await prisma.evaluationRun.findUnique({
      where: { id: runId },
      include: {
        evaluation: {
          select: {
            id: true,
            userId: true,
            judgeModelId: true,
            criteria: {
              where: { enabled: true },
              select: { id: true },
            },
          },
        },
      },
    });
    if (!run || !run.evaluation) {
      throw new AppError(404, 'NOT_FOUND', 'Run not found');
    }
    if (run.evaluation.userId !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized');
    }
    if (run.status === 'pending' || run.status === 'running') {
      throw new AppError(409, 'CONFLICT', 'Run is already in progress');
    }
    if (!run.evaluation.judgeModelId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Judge model not set for evaluation');
    }
    if (run.evaluation.criteria.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'No enabled criteria configured');
    }

    const existingRunResults = (run.results || {}) as Record<string, unknown>;
    const fallbackTotalCases = await prisma.testCaseResult.count({ where: { runId } });
    const totalCases =
      typeof existingRunResults.totalCases === 'number' && Number.isFinite(existingRunResults.totalCases)
        ? existingRunResults.totalCases
        : fallbackTotalCases;

    const updated = await runsRepository.update(runId, {
      status: 'pending',
      errorMessage: null,
      completedAt: null,
      runConfig: {
        ...(run.runConfig && typeof run.runConfig === 'object' && !Array.isArray(run.runConfig)
          ? (run.runConfig as Prisma.JsonObject)
          : {}),
        queueTask: 'evaluation.retry_scores',
      } as Prisma.JsonObject,
      results: {
        ...existingRunResults,
        totalCases,
        completedCases: 0,
      } as Prisma.JsonObject,
    });

    try {
      await prisma.evaluation.update({
        where: { id: run.evaluation.id },
        data: { status: 'pending', completedAt: null },
      });
    } catch (error) {
      console.error('Failed to update evaluation status for retry scores:', error);
    }

    enqueueEvaluationRetryScores(userId, runId).catch((error) => {
      console.error('Failed to enqueue retry-score run:', error);
    });

    return transformResponse(updated);
  }

  /**
   * Retry only errored test cases in the same run.
   */
  async retryErroredCases(userId: string, runId: string): Promise<EvaluationRun> {
    const run = await prisma.evaluationRun.findUnique({
      where: { id: runId },
      include: {
        evaluation: {
          select: {
            id: true,
            userId: true,
            testCases: {
              select: { id: true },
            },
          },
        },
      },
    });
    if (!run || !run.evaluation) {
      throw new AppError(404, 'NOT_FOUND', 'Run not found');
    }
    if (run.evaluation.userId !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized');
    }
    if (run.status === 'pending' || run.status === 'running') {
      throw new AppError(409, 'CONFLICT', 'Run is already in progress');
    }

    const runConfig =
      run.runConfig && typeof run.runConfig === 'object' && !Array.isArray(run.runConfig)
        ? (run.runConfig as Prisma.JsonObject)
        : {};
    const scopedFromConfig = Array.isArray(runConfig.testCaseIds)
      ? (runConfig.testCaseIds as unknown[])
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    const availableTestCaseIds = new Set(run.evaluation.testCases.map((testCase) => testCase.id));
    const scopeTestCaseIds = Array.from(
      new Set(
        scopedFromConfig.length > 0
          ? scopedFromConfig
          : run.evaluation.testCases.map((testCase) => testCase.id)
      )
    ).filter((id) => availableTestCaseIds.has(id));
    if (scopeTestCaseIds.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'No test cases in this run');
    }

    const erroredResults = await prisma.testCaseResult.findMany({
      where: {
        runId,
        testCaseId: { in: scopeTestCaseIds },
        errorMessage: { not: null },
      },
      select: {
        testCaseId: true,
        errorMessage: true,
      },
    });
    const retryCaseIds = Array.from(
      new Set(
        erroredResults
          .filter((item) => typeof item.errorMessage === 'string' && item.errorMessage.trim().length > 0)
          .map((item) => item.testCaseId)
      )
    );
    if (retryCaseIds.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'No errored test cases to retry');
    }

    const existingRunResults = (run.results || {}) as Record<string, unknown>;
    const totalCases =
      typeof existingRunResults.totalCases === 'number' && Number.isFinite(existingRunResults.totalCases)
        ? existingRunResults.totalCases
        : scopeTestCaseIds.length;

    const updated = await runsRepository.update(runId, {
      status: 'pending',
      errorMessage: null,
      completedAt: null,
      runConfig: {
        ...runConfig,
        queueTask: 'evaluation.run',
        retryCaseIds,
      } as Prisma.JsonObject,
      results: {
        ...existingRunResults,
        totalCases,
      } as Prisma.JsonObject,
    });

    try {
      await prisma.evaluation.update({
        where: { id: run.evaluation.id },
        data: { status: 'pending', completedAt: null },
      });
    } catch (error) {
      console.error('Failed to update evaluation status for retry errored cases:', error);
    }

    enqueueEvaluationRun(userId, runId).catch((error) => {
      console.error('Failed to enqueue retry-errored-cases run:', error);
    });

    return transformResponse(updated);
  }

  /**
   * Update a run
   */
  async update(
    userId: string,
    id: string,
    data: {
      title?: string | null;
      status?: 'pending' | 'running' | 'completed' | 'failed';
      results?: Record<string, unknown>;
      errorMessage?: string | null;
      totalTokensInput?: number;
      totalTokensOutput?: number;
    }
  ): Promise<EvaluationRun> {
    const run = await runsRepository.findById(id);
    if (!run) {
      throw new AppError(404, 'NOT_FOUND', 'Run not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.assertOwner(userId, run.evaluationId);

    const updateData: Prisma.EvaluationRunUpdateInput = {};
    if (data.title !== undefined) {
      const normalizedTitle = typeof data.title === 'string' ? data.title.trim() : '';
      updateData.title = normalizedTitle.length > 0 ? normalizedTitle : null;
    }
    if (data.status !== undefined) updateData.status = data.status;
    if (data.results !== undefined) updateData.results = data.results as Prisma.JsonObject;
    if (data.errorMessage !== undefined) updateData.errorMessage = data.errorMessage;
    if (data.totalTokensInput !== undefined) updateData.totalTokensInput = data.totalTokensInput;
    if (data.totalTokensOutput !== undefined) updateData.totalTokensOutput = data.totalTokensOutput;

    if (data.status === 'completed' || data.status === 'failed') {
      updateData.completedAt = new Date();
    }

    const updated = await runsRepository.update(id, updateData);

    // Keep evaluation status aligned with the latest run status to avoid UI drift.
    if (data.status === 'running' || data.status === 'completed' || data.status === 'failed') {
      const evalUpdate: Prisma.EvaluationUpdateInput = { status: data.status };
      if (data.status === 'running') {
        evalUpdate.completedAt = null;
      }
      if (data.status === 'completed' || data.status === 'failed') {
        evalUpdate.completedAt = new Date();
      }
      if (data.results !== undefined && data.status === 'completed') {
        evalUpdate.results = data.results as Prisma.JsonObject;
      }
      try {
        await prisma.evaluation.update({
          where: { id: run.evaluationId },
          data: evalUpdate,
        });
      } catch (e) {
        console.error('Failed to sync evaluation status with run:', e);
      }
    }

    return transformResponse(updated);
  }

  /**
   * Get run by ID
   */
  async getById(userId: string, id: string): Promise<EvaluationRun> {
    const run = await prisma.evaluationRun.findUnique({
      where: { id },
      include: { evaluation: { select: { userId: true } } },
    });
    if (!run) {
      throw new AppError(404, 'NOT_FOUND', 'Run not found');
    }
    if (run.evaluation.userId !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized');
    }
    const { evaluation: _evaluation, ...rest } = run;
    return transformResponse(rest as EvaluationRun);
  }

  /**
   * Delete a run
   */
  async delete(userId: string, id: string): Promise<void> {
    const run = await runsRepository.findById(id);
    if (!run) {
      throw new AppError(404, 'NOT_FOUND', 'Run not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.assertOwner(userId, run.evaluationId);

    await runsRepository.delete(id);
  }

  /**
   * Abort a run
   */
  async abort(userId: string, id: string): Promise<EvaluationRun> {
    const run = await prisma.evaluationRun.findUnique({
      where: { id },
      select: { id: true, status: true, evaluationId: true },
    });
    if (!run) {
      throw new AppError(404, 'NOT_FOUND', 'Run not found');
    }

    await this.evaluationsService.assertOwner(userId, run.evaluationId);
    abortEvaluationRun(run.id);

    if (run.status === 'completed' || run.status === 'failed') {
      const existing = await prisma.evaluationRun.findUnique({ where: { id: run.id } });
      if (!existing) {
        throw new AppError(404, 'NOT_FOUND', 'Run not found');
      }
      return transformResponse(existing);
    }

    const errorMessage = 'Run aborted';
    const updated = await runsRepository.update(run.id, {
      status: 'failed',
      errorMessage,
      completedAt: new Date(),
    });

    try {
      await prisma.evaluation.update({
        where: { id: run.evaluationId },
        data: { status: 'failed', completedAt: new Date() },
      });
    } catch (e) {
      console.error('Failed to update evaluation status for aborted run:', e);
    }

    return transformResponse(updated);
  }

  /**
   * Get run results
   */
  async getResults(userId: string, id: string): Promise<TestCaseResult[]> {
    const run = await runsRepository.findById(id);
    if (!run) {
      throw new AppError(404, 'NOT_FOUND', 'Run not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.assertOwner(userId, run.evaluationId);

    const results = await testCaseResultsRepository.findByRunId(id);
    return results.map((r) => transformResponse(r));
  }

  /**
   * Add result to a run
   */
  async addResult(
    userId: string,
    runId: string,
    data: {
      testCaseId: string;
      modelOutput?: string;
      scores?: Record<string, number>;
      aiFeedback?: Record<string, unknown>;
      latencyMs?: number;
      ocrLatencyMs?: number;
      tokensInput?: number;
      tokensOutput?: number;
      passed?: boolean;
      errorMessage?: string | null;
    }
  ): Promise<TestCaseResult> {
    const run = await prisma.evaluationRun.findUnique({
      where: { id: runId },
      select: { id: true, evaluationId: true, results: true, runConfig: true },
    });
    if (!run) {
      throw new AppError(404, 'NOT_FOUND', 'Run not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.assertOwner(userId, run.evaluationId);

    const testCase = await testCasesRepository.findById(data.testCaseId);
    if (!testCase) {
      throw new AppError(404, 'NOT_FOUND', 'Test case not found');
    }

    if (testCase.evaluationId !== run.evaluationId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Test case does not belong to this evaluation');
    }

    const safeUpdate: Prisma.TestCaseResultUpdateInput = {};
    if (data.modelOutput !== undefined) safeUpdate.modelOutput = data.modelOutput;
    if (data.scores !== undefined) safeUpdate.scores = data.scores as Prisma.JsonObject;
    if (data.aiFeedback !== undefined) safeUpdate.aiFeedback = data.aiFeedback as Prisma.JsonObject;
    if (data.latencyMs !== undefined) safeUpdate.latencyMs = data.latencyMs;
    if (data.ocrLatencyMs !== undefined) safeUpdate.ocrLatencyMs = data.ocrLatencyMs;
    if (data.tokensInput !== undefined) safeUpdate.tokensInput = data.tokensInput;
    if (data.tokensOutput !== undefined) safeUpdate.tokensOutput = data.tokensOutput;
    if (data.passed !== undefined) safeUpdate.passed = data.passed;
    if (data.errorMessage !== undefined) safeUpdate.errorMessage = data.errorMessage;

    const result = await prisma.testCaseResult.upsert({
      where: {
        runId_testCaseId: {
          runId,
          testCaseId: data.testCaseId,
        },
      },
      update: safeUpdate,
      create: {
        evaluation: { connect: { id: run.evaluationId } },
        testCase: { connect: { id: data.testCaseId } },
        run: { connect: { id: runId } },
        modelOutput: data.modelOutput,
        scores: (data.scores as Prisma.JsonObject) || {},
        aiFeedback: (data.aiFeedback as Prisma.JsonObject) || {},
        latencyMs: data.latencyMs || 0,
        ocrLatencyMs: data.ocrLatencyMs || 0,
        tokensInput: data.tokensInput || 0,
        tokensOutput: data.tokensOutput || 0,
        passed: data.passed || false,
        errorMessage: data.errorMessage,
      },
    });

    // Maintain progress counters on the run record for accurate UI progress bars.
    try {
      const { completedCases, passedCases } = await this.getRunProgressStats(runId);
      const existingRunResults = (run.results || {}) as Record<string, unknown>;
      const config = run.runConfig as Record<string, unknown> | null;
      const configTestCaseIds = Array.isArray(config?.testCaseIds) ? (config!.testCaseIds as unknown[]) : [];
      const totalCases =
        typeof existingRunResults.totalCases === 'number'
          ? (existingRunResults.totalCases as number)
          : configTestCaseIds.length > 0
            ? configTestCaseIds.length
            : completedCases;

      const rate = totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0;
      const nextResults: Record<string, unknown> = {
        ...existingRunResults,
        totalCases,
        completedCases,
        passedCases,
        summary: `Total ${totalCases}, Passed ${passedCases}, Rate ${rate}%`,
      };

      await runsRepository.update(runId, { results: nextResults as Prisma.JsonObject });
    } catch (e) {
      console.error('Failed to update run progress:', e);
    }

    return transformResponse(result);
  }

  /**
   * Add results to a run in batches
   */
  async addResultsBatch(
    userId: string,
    runId: string,
    results: Array<{
      testCaseId: string;
      modelOutput?: string;
      scores?: Record<string, number>;
      aiFeedback?: Record<string, unknown>;
      latencyMs?: number;
      ocrLatencyMs?: number;
      tokensInput?: number;
      tokensOutput?: number;
      passed?: boolean;
      errorMessage?: string | null;
    }>
  ): Promise<TestCaseResult[]> {
    const run = await prisma.evaluationRun.findUnique({
      where: { id: runId },
      select: { id: true, evaluationId: true, results: true, runConfig: true },
    });
    if (!run) {
      throw new AppError(404, 'NOT_FOUND', 'Run not found');
    }

    await this.evaluationsService.assertOwner(userId, run.evaluationId);

    const deduped = new Map<string, typeof results[number]>();
    for (const item of results) {
      deduped.set(item.testCaseId, item);
    }
    const normalized = Array.from(deduped.values());
    if (normalized.length === 0) return [];

    const testCaseIds = normalized.map((item) => item.testCaseId);

    const validTestCases = await prisma.testCase.findMany({
      where: { id: { in: testCaseIds }, evaluationId: run.evaluationId },
      select: { id: true },
    });
    const validIds = new Set(validTestCases.map((tc) => tc.id));
    const invalidTestCaseIds = testCaseIds.filter((id) => !validIds.has(id));
    if (invalidTestCaseIds.length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Some selected test cases do not belong to this evaluation', {
        invalidTestCaseIds,
      });
    }

    const existing = await prisma.testCaseResult.findMany({
      where: { runId, testCaseId: { in: testCaseIds } },
      select: { id: true, testCaseId: true },
    });
    const existingMap = new Map(existing.map((item) => [item.testCaseId, item.id]));

    const updateOps: Prisma.PrismaPromise<unknown>[] = [];
    const createData: Prisma.TestCaseResultCreateManyInput[] = [];

    for (const item of normalized) {
      const existingId = existingMap.get(item.testCaseId);
      if (existingId) {
        const updateData: Prisma.TestCaseResultUpdateInput = {};
        if (item.modelOutput !== undefined) updateData.modelOutput = item.modelOutput;
        if (item.scores !== undefined) updateData.scores = item.scores as Prisma.JsonObject;
        if (item.aiFeedback !== undefined) updateData.aiFeedback = item.aiFeedback as Prisma.JsonObject;
        if (item.latencyMs !== undefined) updateData.latencyMs = item.latencyMs;
        if (item.ocrLatencyMs !== undefined) updateData.ocrLatencyMs = item.ocrLatencyMs;
        if (item.tokensInput !== undefined) updateData.tokensInput = item.tokensInput;
        if (item.tokensOutput !== undefined) updateData.tokensOutput = item.tokensOutput;
        if (item.passed !== undefined) updateData.passed = item.passed;
        if (item.errorMessage !== undefined) updateData.errorMessage = item.errorMessage;

        if (Object.keys(updateData).length > 0) {
          updateOps.push(
            prisma.testCaseResult.update({
              where: { id: existingId },
              data: updateData,
            })
          );
        }
      } else {
        createData.push({
          evaluationId: run.evaluationId,
          runId,
          testCaseId: item.testCaseId,
          modelOutput: item.modelOutput,
          scores: (item.scores as Prisma.JsonObject) || {},
          aiFeedback: (item.aiFeedback as Prisma.JsonObject) || {},
          latencyMs: item.latencyMs || 0,
          ocrLatencyMs: item.ocrLatencyMs || 0,
          tokensInput: item.tokensInput || 0,
          tokensOutput: item.tokensOutput || 0,
          passed: item.passed || false,
          errorMessage: item.errorMessage,
        });
      }
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (updateOps.length > 0) ops.push(...updateOps);
    if (createData.length > 0) {
      ops.push(prisma.testCaseResult.createMany({ data: createData }));
    }
    if (ops.length > 0) {
      await prisma.$transaction(ops);
    }

    const saved = await prisma.testCaseResult.findMany({
      where: { runId, testCaseId: { in: testCaseIds } },
    });

    try {
      const { completedCases, passedCases } = await this.getRunProgressStats(runId);
      const existingRunResults = (run.results || {}) as Record<string, unknown>;
      const config = run.runConfig as Record<string, unknown> | null;
      const configTestCaseIds = Array.isArray(config?.testCaseIds) ? (config!.testCaseIds as unknown[]) : [];
      const totalCases =
        typeof existingRunResults.totalCases === 'number'
          ? (existingRunResults.totalCases as number)
          : configTestCaseIds.length > 0
            ? configTestCaseIds.length
            : completedCases;

      const rate = totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0;
      const nextResults: Record<string, unknown> = {
        ...existingRunResults,
        totalCases,
        completedCases,
        passedCases,
        summary: `Total ${totalCases}, Passed ${passedCases}, Rate ${rate}%`,
      };

      await runsRepository.update(runId, { results: nextResults as Prisma.JsonObject });
    } catch (e) {
      console.error('Failed to update run progress:', e);
    }

    return saved.map((result) => transformResponse(result));
  }
}

// Export singleton instances
export const evaluationsService = new EvaluationsService();
export const testCasesService = new TestCasesService();
export const criteriaService = new CriteriaService();
export const runsService = new RunsService();
