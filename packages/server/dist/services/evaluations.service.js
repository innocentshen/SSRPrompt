import { evaluationsRepository, testCasesRepository, criteriaRepository, runsRepository, testCaseResultsRepository, } from '../repositories/evaluations.repository.js';
import { prisma } from '../config/database.js';
import { transformResponse, transformDecimal } from '../utils/transform.js';
import { AppError } from '@ssrprompt/shared';
import { filesService } from './files.service.js';
import { abortEvaluationRun, enqueueEvaluationRetryScores, enqueueEvaluationRun } from './evaluation-queue.service.js';
function normalizeBase64(value) {
    const comma = value.indexOf(',');
    if (value.startsWith('data:') && comma !== -1) {
        return value.slice(comma + 1);
    }
    return value;
}
function isLegacyBase64Attachments(value) {
    if (!Array.isArray(value) || value.length === 0)
        return false;
    return value.every((item) => {
        if (!item || typeof item !== 'object')
            return false;
        const record = item;
        return (typeof record.name === 'string' &&
            typeof record.type === 'string' &&
            typeof record.base64 === 'string' &&
            record.base64.length > 0);
    });
}
function isStoredAttachments(value) {
    if (!Array.isArray(value) || value.length === 0)
        return false;
    return value.every((item) => {
        if (!item || typeof item !== 'object')
            return false;
        const record = item;
        return typeof record.fileId === 'string' && typeof record.name === 'string' && typeof record.type === 'string';
    });
}
async function materializeAttachmentsForUser(fromUserId, toUserId, rawAttachments) {
    if (!rawAttachments || !Array.isArray(rawAttachments) || rawAttachments.length === 0)
        return [];
    if (isStoredAttachments(rawAttachments)) {
        if (fromUserId === toUserId)
            return rawAttachments;
        const cloned = await Promise.all(rawAttachments.map(async (attachment) => {
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
                };
            }
            catch {
                return null;
            }
        }));
        return cloned.filter((item) => item !== null);
    }
    if (isLegacyBase64Attachments(rawAttachments)) {
        const migrated = [];
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
    async assertPromptAccessible(userId, promptId) {
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
    async assertModelAccessible(userId, modelId) {
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
    async assertOwner(userId, evaluationId) {
        await evaluationsRepository.findByIdOrThrow(userId, evaluationId);
    }
    /**
     * Get all evaluations for a user
     */
    async findAll(userId) {
        const evaluations = await evaluationsRepository.findAll(userId);
        return evaluations.map((e) => transformResponse(e));
    }
    /**
     * Get evaluation by ID with all relations
     */
    async findById(userId, id) {
        const evaluation = await evaluationsRepository.findByIdWithRelations(userId, id);
        if (!evaluation) {
            throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
        }
        // For non-owner views (public evaluations), attachments are hidden by default because they are tenant-scoped
        // files and may contain sensitive data. If the owner explicitly enables sharing, only expose stored file refs.
        if (evaluation.userId !== userId) {
            if (evaluation.testCases && evaluation.testCases.length > 0) {
                for (const testCase of evaluation.testCases) {
                    const rawAttachments = (testCase.attachments ?? []);
                    const shouldExposeAttachments = evaluation.shareAttachments && isStoredAttachments(rawAttachments);
                    if (!shouldExposeAttachments) {
                        testCase.attachments = [];
                    }
                }
            }
            return transformResponse(evaluation);
        }
        // Lazy-migrate legacy base64 attachments to stored files for owner views.
        if (evaluation.userId === userId && evaluation.testCases && evaluation.testCases.length > 0) {
            for (const testCase of evaluation.testCases) {
                const rawAttachments = (testCase.attachments ?? []);
                if (!rawAttachments || isStoredAttachments(rawAttachments) || !isLegacyBase64Attachments(rawAttachments)) {
                    continue;
                }
                const migrated = [];
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
                    attachments: migrated,
                });
                // Ensure the response matches the migrated state without an extra fetch.
                testCase.attachments = migrated;
            }
        }
        return transformResponse(evaluation);
    }
    async downloadAttachment(requesterUserId, evaluationId, fileId, range) {
        const evaluation = await evaluationsRepository.findByIdWithRelations(requesterUserId, evaluationId);
        if (!evaluation) {
            throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
        }
        const isOwner = evaluation.userId === requesterUserId;
        if (!isOwner && !evaluation.shareAttachments) {
            throw new AppError(403, 'FORBIDDEN', 'Attachments are not shared for this evaluation');
        }
        const testCases = evaluation.testCases ?? [];
        const allowedFileIds = new Set();
        for (const testCase of testCases) {
            const rawAttachments = (testCase.attachments ?? []);
            if (!isStoredAttachments(rawAttachments))
                continue;
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
    async create(userId, data) {
        if (data.promptId) {
            await this.assertPromptAccessible(userId, data.promptId);
        }
        if (data.modelId) {
            await this.assertModelAccessible(userId, data.modelId);
        }
        if (data.judgeModelId) {
            await this.assertModelAccessible(userId, data.judgeModelId);
        }
        const evaluation = await evaluationsRepository.createWithRelations(userId, {
            name: data.name,
            prompt: data.promptId ? { connect: { id: data.promptId } } : undefined,
            model: data.modelId ? { connect: { id: data.modelId } } : undefined,
            judgeModel: data.judgeModelId ? { connect: { id: data.judgeModelId } } : undefined,
            config: data.config || {},
            orderIndex: data.orderIndex,
        }, data.testCases?.map((tc) => ({
            name: tc.name || '',
            inputText: tc.inputText,
            inputVariables: tc.inputVariables || {},
            attachments: tc.attachments || [],
            expectedOutput: tc.expectedOutput,
            notes: tc.notes,
        })), data.criteria?.map((c) => ({
            name: c.name,
            description: c.description,
            prompt: c.prompt,
            weight: c.weight,
            enabled: c.enabled ?? true,
        })));
        return transformResponse(evaluation);
    }
    /**
     * Update an evaluation
     */
    async update(userId, id, data) {
        const existing = await evaluationsRepository.findByIdOrThrow(userId, id);
        const updateData = {};
        if (data.name !== undefined)
            updateData.name = data.name;
        if (data.status !== undefined)
            updateData.status = data.status;
        if (data.config !== undefined)
            updateData.config = data.config;
        if (data.results !== undefined)
            updateData.results = data.results;
        if (data.isPublic !== undefined)
            updateData.isPublic = data.isPublic;
        if (data.shareAttachments !== undefined)
            updateData.shareAttachments = data.shareAttachments;
        if (data.orderIndex !== undefined)
            updateData.orderIndex = data.orderIndex;
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
        const nextPromptId = data.promptId !== undefined ? (data.promptId ?? null) : (existing.promptId ?? null);
        // Invariant: cannot inherit model parameters from a prompt when no prompt is linked.
        // If a prompt reference is dropped (e.g. copying public evaluations with private prompts),
        // auto-clear `inherited_from_prompt` to avoid inconsistent state in UI and runner logic.
        if (!nextPromptId) {
            const effectiveConfig = data.config && typeof data.config === 'object' && !Array.isArray(data.config)
                ? data.config
                : existing.config && typeof existing.config === 'object' && !Array.isArray(existing.config)
                    ? existing.config
                    : {};
            const inherited = effectiveConfig.inherited_from_prompt;
            if (inherited === true) {
                updateData.config = { ...effectiveConfig, inherited_from_prompt: false };
            }
        }
        const nextIsPublic = data.isPublic !== undefined ? data.isPublic : existing.isPublic;
        const nextShareAttachments = data.shareAttachments !== undefined ? data.shareAttachments : existing.shareAttachments;
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
    async delete(userId, id) {
        await this.assertOwner(userId, id);
        await evaluationsRepository.delete(userId, id);
    }
    /**
     * Copy an evaluation
     */
    async copy(userId, id, newName) {
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
            if (!nextPromptId)
                return null;
            try {
                await this.assertPromptAccessible(userId, nextPromptId);
                return nextPromptId;
            }
            catch {
                return null;
            }
        })();
        const resolvedModelId = await (async () => {
            if (!nextModelId)
                return null;
            try {
                await this.assertModelAccessible(userId, nextModelId);
                return nextModelId;
            }
            catch {
                return null;
            }
        })();
        const resolvedJudgeModelId = await (async () => {
            if (!nextJudgeModelId)
                return null;
            try {
                await this.assertModelAccessible(userId, nextJudgeModelId);
                return nextJudgeModelId;
            }
            catch {
                return null;
            }
        })();
        const allowAttachmentCopy = original.userId === userId || original.shareAttachments;
        const copiedConfigBase = original.config && typeof original.config === 'object' && !Array.isArray(original.config)
            ? original.config
            : {};
        const copiedConfig = resolvedPromptId
            ? copiedConfigBase
            : { ...copiedConfigBase, inherited_from_prompt: false };
        const copiedTestCases = original.testCases
            ? await Promise.all(original.testCases.map(async (tc) => {
                const rawAttachments = (tc.attachments ?? []);
                const attachments = allowAttachmentCopy
                    ? await materializeAttachmentsForUser(original.userId, userId, rawAttachments)
                    : [];
                return {
                    name: tc.name,
                    inputText: tc.inputText,
                    inputVariables: tc.inputVariables,
                    attachments: attachments,
                    expectedOutput: tc.expectedOutput,
                    notes: tc.notes,
                    orderIndex: tc.orderIndex,
                };
            }))
            : undefined;
        const copiedCriteria = original.criteria
            ? original.criteria.map((c) => ({
                name: c.name,
                description: c.description ?? undefined,
                prompt: c.prompt ?? undefined,
                weight: c.weight,
                enabled: c.enabled,
            }))
            : undefined;
        const evaluation = await evaluationsRepository.createWithRelations(userId, {
            name: newName || `${original.name} (Copy)`,
            prompt: resolvedPromptId ? { connect: { id: resolvedPromptId } } : undefined,
            model: resolvedModelId ? { connect: { id: resolvedModelId } } : undefined,
            judgeModel: resolvedJudgeModelId ? { connect: { id: resolvedJudgeModelId } } : undefined,
            config: copiedConfig,
            results: {},
            status: 'pending',
            isPublic: false,
        }, copiedTestCases, copiedCriteria);
        return transformResponse(evaluation);
    }
    /**
     * Update order for multiple evaluations
     */
    async updateOrder(userId, updates) {
        await evaluationsRepository.updateOrder(userId, updates);
    }
}
/**
 * Test Cases Service
 */
export class TestCasesService {
    constructor() {
        Object.defineProperty(this, "evaluationsService", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new EvaluationsService()
        });
    }
    /**
     * Create a test case
     */
    async create(userId, evaluationId, data) {
        // Verify evaluation ownership
        await this.evaluationsService.assertOwner(userId, evaluationId);
        const testCase = await testCasesRepository.create(evaluationId, {
            name: data.name || '',
            inputText: data.inputText || '',
            inputVariables: data.inputVariables || {},
            attachments: data.attachments || [],
            expectedOutput: data.expectedOutput,
            notes: data.notes,
            orderIndex: data.orderIndex,
        });
        return transformResponse(testCase);
    }
    /**
     * Update a test case
     */
    async update(userId, id, data) {
        const testCase = await testCasesRepository.findById(id);
        if (!testCase) {
            throw new AppError(404, 'NOT_FOUND', 'Test case not found');
        }
        // Verify evaluation ownership
        await this.evaluationsService.assertOwner(userId, testCase.evaluationId);
        const updateData = {};
        if (data.name !== undefined)
            updateData.name = data.name;
        if (data.inputText !== undefined)
            updateData.inputText = data.inputText;
        if (data.inputVariables !== undefined)
            updateData.inputVariables = data.inputVariables;
        if (data.attachments !== undefined)
            updateData.attachments = data.attachments;
        if (data.expectedOutput !== undefined)
            updateData.expectedOutput = data.expectedOutput;
        if (data.notes !== undefined)
            updateData.notes = data.notes;
        if (data.orderIndex !== undefined)
            updateData.orderIndex = data.orderIndex;
        const updated = await testCasesRepository.update(id, updateData);
        return transformResponse(updated);
    }
    /**
     * Delete a test case
     */
    async delete(userId, id) {
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
    constructor() {
        Object.defineProperty(this, "evaluationsService", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new EvaluationsService()
        });
    }
    /**
     * Create a criterion
     */
    async create(userId, evaluationId, data) {
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
    async update(userId, id, data) {
        const criterion = await criteriaRepository.findById(id);
        if (!criterion) {
            throw new AppError(404, 'NOT_FOUND', 'Criterion not found');
        }
        // Verify evaluation ownership
        await this.evaluationsService.assertOwner(userId, criterion.evaluationId);
        const updateData = {};
        if (data.name !== undefined)
            updateData.name = data.name;
        if (data.description !== undefined)
            updateData.description = data.description;
        if (data.prompt !== undefined)
            updateData.prompt = data.prompt;
        if (data.weight !== undefined)
            updateData.weight = data.weight;
        if (data.enabled !== undefined)
            updateData.enabled = data.enabled;
        const updated = await criteriaRepository.update(id, updateData);
        return transformDecimal(updated);
    }
    /**
     * Delete a criterion
     */
    async delete(userId, id) {
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
    constructor() {
        Object.defineProperty(this, "evaluationsService", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new EvaluationsService()
        });
    }
    /**
     * Create a new run
     */
    async create(userId, evaluationId, data, options) {
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
        const caseConcurrency = Number(process.env.EVALUATION_CASE_CONCURRENCY || '1');
        const executionMode = Number.isFinite(caseConcurrency) && caseConcurrency > 1 ? 'parallel' : 'sequential';
        // Build runConfig snapshot
        const runConfig = {
            promptId: evaluation.promptId,
            promptName: evaluation.prompt?.name || null,
            promptVersion: evaluation.prompt?.currentVersion || null,
            modelId: evaluation.modelId,
            modelName: evaluation.model?.name || null,
            judgeModelId: evaluation.judgeModelId,
            judgeModelName: evaluation.judgeModel?.name || null,
            passThreshold: evaluation.config?.pass_threshold,
            executionMode,
            fileProcessing: evaluation.config?.file_processing || 'auto',
            ocrProvider: evaluation.config?.ocr_provider,
            testCaseIds: selectedTestCaseIds,
            queueTask: 'evaluation.run',
        };
        const nextStatus = options?.status ?? 'running';
        const run = await runsRepository.create(evaluationId, {
            status: nextStatus,
            results: { totalCases, completedCases: 0 },
            modelParameters: data?.modelParameters,
            runConfig: runConfig,
        });
        // Sync evaluation status to match the new active run.
        try {
            await prisma.evaluation.update({
                where: { id: evaluationId },
                data: { status: nextStatus, completedAt: nextStatus === 'completed' || nextStatus === 'failed' ? new Date() : null },
            });
        }
        catch (e) {
            console.error('Failed to update evaluation status for new run:', e);
        }
        return transformResponse(run);
    }
    /**
     * Create a new run and enqueue server-side execution.
     */
    async createAndExecute(userId, evaluationId, data) {
        const run = await this.create(userId, evaluationId, data, { status: 'pending' });
        enqueueEvaluationRun(userId, run.id).catch((error) => {
            console.error('Failed to enqueue evaluation run:', error);
        });
        return run;
    }
    /**
     * Enqueue retrying AI scores for an existing run.
     */
    async retryScores(userId, runId) {
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
        const existingRunResults = (run.results || {});
        const fallbackTotalCases = await prisma.testCaseResult.count({ where: { runId } });
        const totalCases = typeof existingRunResults.totalCases === 'number' && Number.isFinite(existingRunResults.totalCases)
            ? existingRunResults.totalCases
            : fallbackTotalCases;
        const updated = await runsRepository.update(runId, {
            status: 'pending',
            errorMessage: null,
            completedAt: null,
            runConfig: {
                ...(run.runConfig && typeof run.runConfig === 'object' && !Array.isArray(run.runConfig)
                    ? run.runConfig
                    : {}),
                queueTask: 'evaluation.retry_scores',
            },
            results: {
                ...existingRunResults,
                totalCases,
                completedCases: 0,
            },
        });
        try {
            await prisma.evaluation.update({
                where: { id: run.evaluation.id },
                data: { status: 'pending', completedAt: null },
            });
        }
        catch (error) {
            console.error('Failed to update evaluation status for retry scores:', error);
        }
        enqueueEvaluationRetryScores(userId, runId).catch((error) => {
            console.error('Failed to enqueue retry-score run:', error);
        });
        return transformResponse(updated);
    }
    /**
     * Update a run
     */
    async update(userId, id, data) {
        const run = await runsRepository.findByIdWithResults(id);
        if (!run) {
            throw new AppError(404, 'NOT_FOUND', 'Run not found');
        }
        // Verify evaluation ownership
        await this.evaluationsService.assertOwner(userId, run.evaluationId);
        const updateData = {};
        if (data.status !== undefined)
            updateData.status = data.status;
        if (data.results !== undefined)
            updateData.results = data.results;
        if (data.errorMessage !== undefined)
            updateData.errorMessage = data.errorMessage;
        if (data.totalTokensInput !== undefined)
            updateData.totalTokensInput = data.totalTokensInput;
        if (data.totalTokensOutput !== undefined)
            updateData.totalTokensOutput = data.totalTokensOutput;
        if (data.status === 'completed' || data.status === 'failed') {
            updateData.completedAt = new Date();
        }
        const updated = await runsRepository.update(id, updateData);
        // Keep evaluation status aligned with the latest run status to avoid UI drift.
        if (data.status === 'running' || data.status === 'completed' || data.status === 'failed') {
            const evalUpdate = { status: data.status };
            if (data.status === 'running') {
                evalUpdate.completedAt = null;
            }
            if (data.status === 'completed' || data.status === 'failed') {
                evalUpdate.completedAt = new Date();
            }
            if (data.results !== undefined && data.status === 'completed') {
                evalUpdate.results = data.results;
            }
            try {
                await prisma.evaluation.update({
                    where: { id: run.evaluationId },
                    data: evalUpdate,
                });
            }
            catch (e) {
                console.error('Failed to sync evaluation status with run:', e);
            }
        }
        return transformResponse(updated);
    }
    /**
     * Get run by ID
     */
    async getById(userId, id) {
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
        return transformResponse(rest);
    }
    /**
     * Delete a run
     */
    async delete(userId, id) {
        const run = await runsRepository.findByIdWithResults(id);
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
    async abort(userId, id) {
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
        }
        catch (e) {
            console.error('Failed to update evaluation status for aborted run:', e);
        }
        return transformResponse(updated);
    }
    /**
     * Get run results
     */
    async getResults(userId, id) {
        const run = await runsRepository.findByIdWithResults(id);
        if (!run) {
            throw new AppError(404, 'NOT_FOUND', 'Run not found');
        }
        // Verify evaluation ownership
        await this.evaluationsService.findById(userId, run.evaluationId);
        return run.testCaseResults.map((r) => transformResponse(r));
    }
    /**
     * Add result to a run
     */
    async addResult(userId, runId, data) {
        const run = await runsRepository.findByIdWithResults(runId);
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
        const existing = await prisma.testCaseResult.findFirst({
            where: { runId, testCaseId: data.testCaseId },
            select: { id: true },
        });
        const safeUpdate = {};
        if (data.modelOutput !== undefined)
            safeUpdate.modelOutput = data.modelOutput;
        if (data.scores !== undefined)
            safeUpdate.scores = data.scores;
        if (data.aiFeedback !== undefined)
            safeUpdate.aiFeedback = data.aiFeedback;
        if (data.latencyMs !== undefined)
            safeUpdate.latencyMs = data.latencyMs;
        if (data.ocrLatencyMs !== undefined)
            safeUpdate.ocrLatencyMs = data.ocrLatencyMs;
        if (data.tokensInput !== undefined)
            safeUpdate.tokensInput = data.tokensInput;
        if (data.tokensOutput !== undefined)
            safeUpdate.tokensOutput = data.tokensOutput;
        if (data.passed !== undefined)
            safeUpdate.passed = data.passed;
        if (data.errorMessage !== undefined)
            safeUpdate.errorMessage = data.errorMessage;
        const result = existing
            ? await prisma.testCaseResult.update({
                where: { id: existing.id },
                data: safeUpdate,
            })
            : await testCaseResultsRepository.create({
                evaluation: { connect: { id: run.evaluationId } },
                testCase: { connect: { id: data.testCaseId } },
                run: { connect: { id: runId } },
                modelOutput: data.modelOutput,
                scores: data.scores || {},
                aiFeedback: data.aiFeedback || {},
                latencyMs: data.latencyMs || 0,
                ocrLatencyMs: data.ocrLatencyMs || 0,
                tokensInput: data.tokensInput || 0,
                tokensOutput: data.tokensOutput || 0,
                passed: data.passed || false,
                errorMessage: data.errorMessage,
            });
        // Maintain progress counters on the run record for accurate UI progress bars.
        try {
            const completedCases = await prisma.testCaseResult.count({ where: { runId } });
            const passedCases = await prisma.testCaseResult.count({ where: { runId, passed: true } });
            const existingRunResults = (run.results || {});
            const config = run.runConfig;
            const configTestCaseIds = Array.isArray(config?.testCaseIds) ? config.testCaseIds : [];
            const totalCases = typeof existingRunResults.totalCases === 'number'
                ? existingRunResults.totalCases
                : configTestCaseIds.length > 0
                    ? configTestCaseIds.length
                    : completedCases;
            const rate = totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0;
            const nextResults = {
                ...existingRunResults,
                totalCases,
                completedCases,
                passedCases,
                summary: `Total ${totalCases}, Passed ${passedCases}, Rate ${rate}%`,
            };
            await runsRepository.update(runId, { results: nextResults });
        }
        catch (e) {
            console.error('Failed to update run progress:', e);
        }
        return transformResponse(result);
    }
    /**
     * Add results to a run in batches
     */
    async addResultsBatch(userId, runId, results) {
        const run = await prisma.evaluationRun.findUnique({
            where: { id: runId },
            select: { id: true, evaluationId: true, results: true, runConfig: true },
        });
        if (!run) {
            throw new AppError(404, 'NOT_FOUND', 'Run not found');
        }
        await this.evaluationsService.assertOwner(userId, run.evaluationId);
        const deduped = new Map();
        for (const item of results) {
            deduped.set(item.testCaseId, item);
        }
        const normalized = Array.from(deduped.values());
        if (normalized.length === 0)
            return [];
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
        const updateOps = [];
        const createData = [];
        for (const item of normalized) {
            const existingId = existingMap.get(item.testCaseId);
            if (existingId) {
                const updateData = {};
                if (item.modelOutput !== undefined)
                    updateData.modelOutput = item.modelOutput;
                if (item.scores !== undefined)
                    updateData.scores = item.scores;
                if (item.aiFeedback !== undefined)
                    updateData.aiFeedback = item.aiFeedback;
                if (item.latencyMs !== undefined)
                    updateData.latencyMs = item.latencyMs;
                if (item.ocrLatencyMs !== undefined)
                    updateData.ocrLatencyMs = item.ocrLatencyMs;
                if (item.tokensInput !== undefined)
                    updateData.tokensInput = item.tokensInput;
                if (item.tokensOutput !== undefined)
                    updateData.tokensOutput = item.tokensOutput;
                if (item.passed !== undefined)
                    updateData.passed = item.passed;
                if (item.errorMessage !== undefined)
                    updateData.errorMessage = item.errorMessage;
                if (Object.keys(updateData).length > 0) {
                    updateOps.push(prisma.testCaseResult.update({
                        where: { id: existingId },
                        data: updateData,
                    }));
                }
            }
            else {
                createData.push({
                    evaluationId: run.evaluationId,
                    runId,
                    testCaseId: item.testCaseId,
                    modelOutput: item.modelOutput,
                    scores: item.scores || {},
                    aiFeedback: item.aiFeedback || {},
                    latencyMs: item.latencyMs || 0,
                    ocrLatencyMs: item.ocrLatencyMs || 0,
                    tokensInput: item.tokensInput || 0,
                    tokensOutput: item.tokensOutput || 0,
                    passed: item.passed || false,
                    errorMessage: item.errorMessage,
                });
            }
        }
        const ops = [];
        if (updateOps.length > 0)
            ops.push(...updateOps);
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
            const completedCases = await prisma.testCaseResult.count({ where: { runId } });
            const passedCases = await prisma.testCaseResult.count({ where: { runId, passed: true } });
            const existingRunResults = (run.results || {});
            const config = run.runConfig;
            const configTestCaseIds = Array.isArray(config?.testCaseIds) ? config.testCaseIds : [];
            const totalCases = typeof existingRunResults.totalCases === 'number'
                ? existingRunResults.totalCases
                : configTestCaseIds.length > 0
                    ? configTestCaseIds.length
                    : completedCases;
            const rate = totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0;
            const nextResults = {
                ...existingRunResults,
                totalCases,
                completedCases,
                passedCases,
                summary: `Total ${totalCases}, Passed ${passedCases}, Rate ${rate}%`,
            };
            await runsRepository.update(runId, { results: nextResults });
        }
        catch (e) {
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
//# sourceMappingURL=evaluations.service.js.map