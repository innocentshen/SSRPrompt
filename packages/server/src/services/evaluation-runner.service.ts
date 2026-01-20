import { prisma } from '../config/database.js';
import type { Prisma } from '@prisma/client';
import { AppError, type EvaluationConfig, type ModelParameters, type PromptConfig, type PromptMessage, type OcrProvider } from '@ssrprompt/shared';
import { chatCompletion, getModelWithProvider, type ChatMessage } from './chat.service.js';
import { filesService } from './files.service.js';
import { ocrService } from './ocr.service.js';

type StoredAttachment = { fileId: string; name: string; type: string; size: number };

type RawContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }
  | { type: 'file_ref'; file_ref: { fileId: string } };

type IncomingChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | RawContentPart[];
};

type PromptSnapshot = {
  content: string | null;
  messages: PromptMessage[];
  config: PromptConfig | null;
};

type RunResultPayload = {
  testCaseId: string;
  modelOutput?: string;
  scores?: Record<string, number>;
  aiFeedback?: Prisma.JsonObject;
  latencyMs?: number;
  ocrLatencyMs?: number;
  tokensInput?: number;
  tokensOutput?: number;
  passed?: boolean;
  errorMessage?: string | null;
};

type ExpandedMessages = {
  messages: ChatMessage[];
  ocrLatencyMs: number;
};

const DEFAULT_PROMPT_CONFIG: Required<Pick<PromptConfig, 'temperature' | 'top_p' | 'frequency_penalty' | 'presence_penalty' | 'max_tokens'>> = {
  temperature: 1,
  top_p: 0.7,
  frequency_penalty: 0,
  presence_penalty: 0,
  max_tokens: 4096,
};

const RUN_CONCURRENCY = Number(process.env.EVALUATION_RUN_CONCURRENCY || '2');
const CASE_CONCURRENCY = Number(process.env.EVALUATION_CASE_CONCURRENCY || '2');
const RESULT_BATCH_SIZE = Number(process.env.EVALUATION_RESULT_BATCH_SIZE || '10');

class RunAbortError extends Error {
  constructor(message = 'Run aborted') {
    super(message);
    this.name = 'RunAbortError';
  }
}

function parseMessagesFromContent(content: string | null | undefined): PromptMessage[] {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.filter((m) => m && typeof m === 'object' && 'role' in m && 'content' in m) as PromptMessage[];
    }
  } catch {
    return [];
  }
  return [];
}

function formatPromptMessages(messages: PromptMessage[]): string {
  return messages.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n');
}

function getPromptTemplate(prompt: PromptSnapshot | null): string {
  if (!prompt) return '';
  if (Array.isArray(prompt.messages) && prompt.messages.length > 0) {
    return formatPromptMessages(prompt.messages);
  }
  return prompt.content || '';
}

function buildPromptConfigWithDefaults(config?: PromptConfig | null): PromptConfig {
  return {
    temperature: config?.temperature ?? DEFAULT_PROMPT_CONFIG.temperature,
    top_p: config?.top_p ?? DEFAULT_PROMPT_CONFIG.top_p,
    frequency_penalty: config?.frequency_penalty ?? DEFAULT_PROMPT_CONFIG.frequency_penalty,
    presence_penalty: config?.presence_penalty ?? DEFAULT_PROMPT_CONFIG.presence_penalty,
    max_tokens: config?.max_tokens ?? DEFAULT_PROMPT_CONFIG.max_tokens,
    output_schema: config?.output_schema,
    reasoning: config?.reasoning,
  };
}

function resolveModelParameters(config: EvaluationConfig, prompt: PromptSnapshot | null): ModelParameters | undefined {
  if (config.inherited_from_prompt && prompt?.config) {
    return buildPromptConfigWithDefaults(prompt.config);
  }
  if (config.model_parameters) {
    return config.model_parameters;
  }
  if (prompt?.config) {
    return buildPromptConfigWithDefaults(prompt.config);
  }
  return undefined;
}

function buildFinalPromptForTestCase(prompt: PromptSnapshot | null, testCase: { inputText: string; inputVariables: Record<string, unknown> }): string {
  let systemPrompt = getPromptTemplate(prompt);
  let userMessage = '';
  const vars = (testCase.inputVariables || {}) as Record<string, string>;

  for (const [key, value] of Object.entries(vars)) {
    systemPrompt = systemPrompt.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }

  if (systemPrompt.includes('{{input}}')) {
    systemPrompt = systemPrompt.replace(/{{input}}/g, testCase.inputText || '');
  } else {
    userMessage = testCase.inputText || '';
  }

  return userMessage ? `${systemPrompt}\n\n${userMessage}`.trim() : systemPrompt;
}

function buildJudgePrompt(
  criterionPrompt: string | null | undefined,
  testCase: { inputText: string; expectedOutput: string | null },
  modelOutput: string
): string {
  let evalPrompt = criterionPrompt || '';
  evalPrompt = evalPrompt.replace(/{{input}}/g, testCase.inputText || '');
  evalPrompt = evalPrompt.replace(/{{output}}/g, modelOutput || '');
  if (testCase.expectedOutput) {
    evalPrompt = evalPrompt.replace(/{{#expected}}[\s\S]*?{{\/expected}}/g,
      evalPrompt.match(/{{#expected}}([\s\S]*?){{\/expected}}/)?.[1]?.replace(/{{expected}}/g, testCase.expectedOutput) || ''
    );
    evalPrompt = evalPrompt.replace(/{{expected}}/g, testCase.expectedOutput);
  } else {
    evalPrompt = evalPrompt.replace(/{{#expected}}[\s\S]*?{{\/expected}}/g, '');
  }
  return evalPrompt;
}

function computeWeightedPass(
  scores: Record<string, number>,
  criteria: Array<{ name: string; weight: number }>,
  threshold: number
): boolean {
  const scoreNames = Object.keys(scores);
  if (scoreNames.length === 0) return true;
  const weightMap = new Map(criteria.map((c) => [c.name, c.weight]));
  const totalWeight = scoreNames.reduce((sum, name) => sum + (weightMap.get(name) ?? 1), 0);
  const weighted = scoreNames.reduce((sum, name) => sum + scores[name] * (weightMap.get(name) ?? 1), 0);
  const avgScore = totalWeight > 0 ? weighted / totalWeight : 0;
  return avgScore >= threshold;
}

function parseAttachments(value: unknown): StoredAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item as StoredAttachment)
    .filter((item) => item && typeof item.fileId === 'string' && typeof item.name === 'string' && typeof item.type === 'string');
}

function hasFileParts(messages: IncomingChatMessage[]): boolean {
  for (const message of messages) {
    if (typeof message.content === 'string') continue;
    for (const part of message.content as RawContentPart[]) {
      if (part.type === 'file_ref' || part.type === 'file' || part.type === 'image_url') return true;
    }
  }
  return false;
}

function stripFileParts(messages: IncomingChatMessage[]): IncomingChatMessage[] {
  return messages.map((message) => {
    if (typeof message.content === 'string') return message;
    const parts = message.content as RawContentPart[];
    const textParts = parts.filter((p) => p.type === 'text');
    if (textParts.length === 0) {
      return { role: message.role, content: '' };
    }
    return { role: message.role, content: textParts };
  });
}

function parseDataUrl(value: string): { mimeType: string; base64: string } | null {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType.startsWith('image/')) return mimeType.split('/')[1] || 'png';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'application/json') return 'json';
  if (mimeType === 'text/markdown') return 'md';
  if (mimeType === 'text/plain') return 'txt';
  return 'bin';
}

function isTextMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    ['application/json', 'application/xml', 'text/csv', 'text/yaml', 'application/x-yaml'].includes(mimeType)
  );
}

function buildTextFileBlock(filename: string, content: string): string {
  return `[File: ${filename}]\n\`\`\`\n${content}\n\`\`\``;
}

async function expandMessages(
  userId: string,
  messages: IncomingChatMessage[],
  mode: 'vision' | 'ocr',
  options?: { ocrProvider?: OcrProvider }
): Promise<ExpandedMessages> {
  const seenFileIds = new Set<string>();
  const ocrTextByFileId = new Map<string, string>();
  let ocrLatencyMs = 0;
  const expanded: ChatMessage[] = [];

  for (const message of messages) {
    if (typeof message.content === 'string') {
      expanded.push({ role: message.role, content: message.content });
      continue;
    }

    const parts = message.content as RawContentPart[];
    const newParts: Exclude<ChatMessage['content'], string> = [];

    for (const part of parts) {
      if (part.type === 'file_ref') {
        const fileId = part.file_ref.fileId;
        const { meta, buffer } = await filesService.downloadBuffer(userId, fileId);

        if (!seenFileIds.has(fileId)) {
          seenFileIds.add(fileId);
        }

        if (mode === 'ocr' && (meta.mimeType.startsWith('image/') || meta.mimeType === 'application/pdf')) {
          let text = ocrTextByFileId.get(fileId);
          if (text === undefined) {
            const ocrStart = Date.now();
            const result = await ocrService.extractForFile(
              userId,
              fileId,
              options?.ocrProvider ? { provider: options.ocrProvider } : undefined
            );
            ocrLatencyMs += Date.now() - ocrStart;
            text = result.fullText || '';
            ocrTextByFileId.set(fileId, text);
          }

          newParts.push({
            type: 'text',
            text: buildTextFileBlock(meta.originalName, text || '[OCR output is empty]'),
          });
        } else if (meta.mimeType.startsWith('image/')) {
          newParts.push({
            type: 'image_url',
            image_url: { url: `data:${meta.mimeType};base64,${buffer.toString('base64')}` },
          });
        } else if (meta.mimeType === 'application/pdf') {
          newParts.push({
            type: 'file',
            file: {
              filename: meta.originalName,
              file_data: `data:${meta.mimeType};base64,${buffer.toString('base64')}`,
            },
          });
        } else if (isTextMimeType(meta.mimeType)) {
          newParts.push({
            type: 'text',
            text: buildTextFileBlock(meta.originalName, buffer.toString('utf-8')),
          });
        } else {
          newParts.push({
            type: 'text',
            text: `[File: ${meta.originalName}] (unsupported file type: ${meta.mimeType})`,
          });
        }

        continue;
      }

      if (part.type === 'image_url') {
        const dataUrl = parseDataUrl(part.image_url.url);
        if (dataUrl) {
          const buffer = Buffer.from(dataUrl.base64, 'base64');
          const stored = await filesService.upload(userId, {
            originalName: `image_${seenFileIds.size + 1}.${extensionFromMimeType(dataUrl.mimeType)}`,
            mimeType: dataUrl.mimeType,
            size: buffer.length,
            buffer,
          });
          if (!seenFileIds.has(stored.id)) {
            seenFileIds.add(stored.id);
          }
        }

        newParts.push(part);
        continue;
      }

      if (part.type === 'file') {
        const dataUrl = parseDataUrl(part.file.file_data);
        if (dataUrl) {
          const buffer = Buffer.from(dataUrl.base64, 'base64');
          const stored = await filesService.upload(userId, {
            originalName: part.file.filename,
            mimeType: dataUrl.mimeType,
            size: buffer.length,
            buffer,
          });
          if (!seenFileIds.has(stored.id)) {
            seenFileIds.add(stored.id);
          }
        }

        newParts.push(part);
        continue;
      }

      newParts.push(part);
    }

    expanded.push({ role: message.role, content: newParts });
  }

  return { messages: expanded, ocrLatencyMs };
}

async function resolvePromptSnapshot(
  promptId: string | null | undefined,
  promptVersion: number | null
): Promise<PromptSnapshot | null> {
  if (!promptId) return null;
  if (promptVersion) {
    const version = await prisma.promptVersion.findUnique({
      where: { promptId_version: { promptId, version: promptVersion } },
    });
    if (version) {
      const storedMessages = Array.isArray(version.messages)
        ? (version.messages as unknown as PromptMessage[])
        : null;
      const messages = storedMessages || parseMessagesFromContent(version.content);
      return {
        content: version.content,
        messages,
        config: (version.config as PromptConfig) || null,
      };
    }
  }

  const prompt = await prisma.prompt.findUnique({
    where: { id: promptId },
    select: { content: true, messages: true, config: true },
  });
  if (!prompt) return null;
  const storedMessages = Array.isArray(prompt.messages)
    ? (prompt.messages as unknown as PromptMessage[])
    : null;
  return {
    content: prompt.content,
    messages: storedMessages || parseMessagesFromContent(prompt.content),
    config: (prompt.config as PromptConfig) || null,
  };
}

type RunExecutionOptions = {
  userId?: string;
  signal?: AbortSignal;
};

export async function executeEvaluationRun(runId: string, options: RunExecutionOptions = {}): Promise<void> {
  const run = await prisma.evaluationRun.findUnique({
    where: { id: runId },
    include: {
      evaluation: {
        include: {
          testCases: { orderBy: { orderIndex: 'asc' } },
          criteria: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });

  if (!run || !run.evaluation) {
    throw new AppError(404, 'NOT_FOUND', 'Run not found');
  }

  const resolvedUserId = options.userId ?? run.evaluation.userId;
  if (run.evaluation.userId !== resolvedUserId) {
    throw new AppError(403, 'FORBIDDEN', 'Not authorized');
  }

  if (run.status === 'completed' || run.status === 'failed') {
    return;
  }

  const evaluation = run.evaluation;
  const userId = resolvedUserId;
  const evalConfig = (evaluation.config || {}) as EvaluationConfig;
  const runConfig = (run.runConfig || {}) as Record<string, unknown>;
  const promptSnapshot = await resolvePromptSnapshot(
    (runConfig.promptId as string | null | undefined) ?? evaluation.promptId,
    (runConfig.promptVersion as number | null | undefined) ?? null
  );

  const modelId = evaluation.modelId;
  if (!modelId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Model not set for evaluation');
  }

  const { model, provider, apiKey } = await getModelWithProvider(userId, modelId);
  const judgeModelId = evaluation.judgeModelId;
  let judge: { model: typeof model; provider: typeof provider; apiKey: string } | null = null;
  if (judgeModelId) {
    try {
      judge = await getModelWithProvider(userId, judgeModelId);
    } catch (error) {
      console.error('Failed to load judge model for evaluation run:', error);
      judge = null;
    }
  }
  const enabledCriteria = evaluation.criteria.filter((c) => c.enabled);

  const resolvedModelParams = run.modelParameters as ModelParameters | null;
  const modelParams = resolvedModelParams ?? resolveModelParameters(evalConfig, promptSnapshot);

  const fileProcessing = (runConfig.fileProcessing as string | undefined) || evalConfig.file_processing || 'auto';
  const ocrProvider = (runConfig.ocrProvider as string | undefined) || evalConfig.ocr_provider;

  const runTestCaseIds =
    (Array.isArray(runConfig.testCaseIds) ? (runConfig.testCaseIds as string[]) : null) ||
    evaluation.testCases.map((tc) => tc.id);

  const testCases = evaluation.testCases.filter((tc) => runTestCaseIds.includes(tc.id));
  if (testCases.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'No test cases to run');
  }

  const hasBinaryAttachments = testCases.some((tc) =>
    parseAttachments(tc.attachments).some((file) => file.type.startsWith('image/') || file.type === 'application/pdf')
  );

  const resolvedFileMode = (() => {
    if (!hasBinaryAttachments) return 'none';
    if (fileProcessing === 'none') return 'none';
    if (fileProcessing === 'vision') return 'vision';
    if (fileProcessing === 'ocr') return 'ocr';
    return model.supportsVision ? 'vision' : 'ocr';
  })();

  let resolvedOcrProvider: OcrProvider | null = null;
  if (hasBinaryAttachments && resolvedFileMode === 'ocr') {
    const preferred = (ocrProvider as OcrProvider | undefined) ?? null;
    if (preferred) {
      resolvedOcrProvider = preferred;
    } else {
      const settings = await ocrService.getSettings(userId);
      resolvedOcrProvider = settings.provider;
    }

    const currentResolved = (runConfig.ocrProviderResolved as OcrProvider | undefined) ?? null;
    if (resolvedOcrProvider && currentResolved !== resolvedOcrProvider) {
      const nextRunConfig = { ...runConfig, ocrProviderResolved: resolvedOcrProvider };
      await prisma.evaluationRun.update({
        where: { id: runId },
        data: { runConfig: nextRunConfig as any },
      });
      runConfig.ocrProviderResolved = resolvedOcrProvider as any;
    }
  }

  const effectiveOcrProvider = (ocrProvider as OcrProvider | undefined) ?? resolvedOcrProvider ?? undefined;

  const caseConcurrency =
    Number.isFinite(CASE_CONCURRENCY) && CASE_CONCURRENCY > 0 ? CASE_CONCURRENCY : 1;
  const passThreshold = evalConfig.pass_threshold ?? 0.6;

  await prisma.evaluationRun.update({
    where: { id: runId },
    data: { status: 'running', errorMessage: null, completedAt: null, results: { totalCases: testCases.length, completedCases: 0 } },
  });
  await prisma.evaluation.update({
    where: { id: evaluation.id },
    data: { status: 'running', completedAt: null },
  });

  const resultsBatch: RunResultPayload[] = [];
  const allScores: Record<string, number[]> = {};
  let completedCases = 0;
  let totalTokensInput = 0;
  let totalTokensOutput = 0;
  let llmTimeMs = 0;
  let ocrTimeMs = 0;
  let flushInFlight: Promise<void> | null = null;
  const progressUpdateIntervalMs = Math.max(0, Number(process.env.EVALUATION_PROGRESS_UPDATE_INTERVAL_MS || '1000'));
  const progressUpdateBatchSize = Math.max(1, Number(process.env.EVALUATION_PROGRESS_UPDATE_BATCH_SIZE || '1'));
  let pendingProgressUpdates = 0;
  let lastProgressUpdate = 0;
  let progressUpdateInFlight: Promise<void> | null = null;

  const updateProgress = async (force = false) => {
    if (!force) {
      const now = Date.now();
      if (
        pendingProgressUpdates < progressUpdateBatchSize &&
        now - lastProgressUpdate < progressUpdateIntervalMs
      ) {
        return;
      }
    }

    if (progressUpdateInFlight) return;

    progressUpdateInFlight = (async () => {
      await prisma.evaluationRun.update({
        where: { id: runId },
        data: { results: { totalCases: testCases.length, completedCases } },
      });
    })();

    try {
      await progressUpdateInFlight;
    } catch (error) {
      console.error('Failed to update run progress:', error);
    } finally {
      lastProgressUpdate = Date.now();
      pendingProgressUpdates = 0;
      progressUpdateInFlight = null;
    }
  };

  const markCaseComplete = async () => {
    completedCases += 1;
    pendingProgressUpdates += 1;
    await updateProgress();
  };

  const flushResults = async () => {
    if (resultsBatch.length === 0) return;
    if (flushInFlight) {
      await flushInFlight;
      if (resultsBatch.length === 0) return;
    }

    const batch = resultsBatch.splice(0, resultsBatch.length);
    flushInFlight = (async () => {
      await prisma.testCaseResult.createMany({
        data: batch.map((item) => ({
          evaluationId: evaluation.id,
          runId,
          testCaseId: item.testCaseId,
          modelOutput: item.modelOutput,
          scores: (item.scores as Record<string, number>) || {},
          aiFeedback: (item.aiFeedback ?? {}) as Prisma.JsonObject,
          latencyMs: item.latencyMs || 0,
          ocrLatencyMs: item.ocrLatencyMs || 0,
          tokensInput: item.tokensInput || 0,
          tokensOutput: item.tokensOutput || 0,
          passed: item.passed || false,
          errorMessage: item.errorMessage || null,
        })),
      });
    })();

    try {
      await flushInFlight;
    } finally {
      flushInFlight = null;
    }
  };

  const enqueueResult = async (payload: RunResultPayload) => {
    resultsBatch.push(payload);
    await markCaseComplete();
    if (resultsBatch.length >= RESULT_BATCH_SIZE) {
      await flushResults();
    }
  };

  const signal = options.signal;
  const abortCheckIntervalMs = Math.max(0, Number(process.env.EVALUATION_ABORT_CHECK_INTERVAL_MS || '2000'));
  let lastAbortCheck = 0;

  const ensureNotAborted = async () => {
    if (signal?.aborted) {
      throw new RunAbortError();
    }
    if (abortCheckIntervalMs <= 0) return;
    const now = Date.now();
    if (now - lastAbortCheck < abortCheckIntervalMs) return;
    lastAbortCheck = now;
    const current = await prisma.evaluationRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (!current || current.status === 'failed') {
      throw new RunAbortError();
    }
  };

  const executeTestCase = async (testCase: typeof evaluation.testCases[number]) => {
    await ensureNotAborted();

    const finalPrompt = buildFinalPromptForTestCase(promptSnapshot, {
      inputText: testCase.inputText || '',
      inputVariables: (testCase.inputVariables || {}) as Record<string, unknown>,
    });

    const attachments = parseAttachments(testCase.attachments);
    const includeFiles = fileProcessing !== 'none' && (fileProcessing !== 'vision' || model.supportsVision);
    let userContent: string | RawContentPart[] = finalPrompt;

    if (attachments.length > 0 && includeFiles) {
      const contentParts: RawContentPart[] = [{ type: 'text', text: finalPrompt }];
      for (const file of attachments) {
        contentParts.push({ type: 'file_ref', file_ref: { fileId: file.fileId } });
      }
      userContent = contentParts;
    }

    let messages: IncomingChatMessage[] = [{ role: 'user', content: userContent }];
    if (fileProcessing === 'none') {
      messages = stripFileParts(messages);
    }

    let testOcrLatencyMs = 0;
    let modelMessages: ChatMessage[] = messages as ChatMessage[];

    if (hasFileParts(messages)) {
      let mode: 'vision' | 'ocr' = 'vision';
      if (fileProcessing === 'ocr') mode = 'ocr';
      else if (fileProcessing === 'vision') mode = 'vision';
      else mode = model.supportsVision ? 'vision' : 'ocr';

      if (mode === 'ocr') {
        const settings = await ocrService.getSettings(userId);
        if (!settings.enabled) {
          throw new AppError(400, 'FILE_UPLOAD_NOT_ALLOWED', 'File upload requires OCR to be enabled');
        }
      }

      if (mode === 'vision' && !model.supportsVision) {
        throw new AppError(400, 'FILE_UPLOAD_NOT_ALLOWED', 'This model does not support direct file inputs');
      }

      const expanded = await expandMessages(userId, messages, mode, { ocrProvider: effectiveOcrProvider });
      modelMessages = expanded.messages;
      testOcrLatencyMs = expanded.ocrLatencyMs;
      if (testOcrLatencyMs > 0) {
        ocrTimeMs += testOcrLatencyMs;
      }
    }

    const start = Date.now();
    const response = await chatCompletion(
      provider,
      model,
      apiKey,
      modelMessages,
      {
        temperature: modelParams?.temperature,
        top_p: modelParams?.top_p,
        max_tokens: modelParams?.max_tokens,
        frequency_penalty: modelParams?.frequency_penalty,
        presence_penalty: modelParams?.presence_penalty,
      },
      signal
    );
    const latencyMs = Date.now() - start;
    llmTimeMs += latencyMs;
    totalTokensInput += response.usage.prompt_tokens;
    totalTokensOutput += response.usage.completion_tokens;

    const scores: Record<string, number> = {};
    const aiFeedback: Prisma.JsonObject = {};

    if (enabledCriteria.length > 0 && judge) {
      for (const criterion of enabledCriteria) {
        try {
          await ensureNotAborted();
          const evalPrompt = buildJudgePrompt(criterion.prompt, testCase, response.content);
          const evalResponse = await chatCompletion(
            judge.provider,
            judge.model,
            judge.apiKey,
            [{ role: 'user', content: evalPrompt }],
            {},
            signal
          );

          const jsonMatch = evalResponse.content.match(/\{[\s\S]*?"score"[\s\S]*?\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const score = Math.min(1, Math.max(0, (parsed.score || 0) / 10));
            scores[criterion.name] = score;
          aiFeedback[criterion.name] = parsed.reason || '';
            if (!allScores[criterion.name]) allScores[criterion.name] = [];
            allScores[criterion.name].push(score);
          }
        } catch (error) {
          if (error instanceof RunAbortError) throw error;
          scores[criterion.name] = 0;
          aiFeedback[criterion.name] = 'Evaluation failed';
        }
      }
    }

    const criteriaWeights = enabledCriteria.map((c) => {
      const weightValue = Number(c.weight);
      return { name: c.name, weight: Number.isFinite(weightValue) ? weightValue : 1 };
    });
    const passed = computeWeightedPass(scores, criteriaWeights, passThreshold);

    await enqueueResult({
      testCaseId: testCase.id,
      modelOutput: response.content,
      scores,
      aiFeedback,
      latencyMs,
      ocrLatencyMs: testOcrLatencyMs,
      tokensInput: response.usage.prompt_tokens,
      tokensOutput: response.usage.completion_tokens,
      passed,
      errorMessage: null,
    });
  };

  try {
    const workerCount = Math.max(1, Math.min(caseConcurrency, testCases.length));
    if (workerCount > 1) {
      const queue = [...testCases];
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (queue.length > 0) {
            await ensureNotAborted();
            const testCase = queue.shift();
            if (!testCase) return;
            try {
              await executeTestCase(testCase);
            } catch (error) {
              if (error instanceof RunAbortError) throw error;
              await enqueueResult({
                testCaseId: testCase.id,
                modelOutput: '',
                scores: {},
                aiFeedback: {},
                latencyMs: 0,
                ocrLatencyMs: 0,
                tokensInput: 0,
                tokensOutput: 0,
                passed: false,
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
        })
      );
    } else {
      for (const testCase of testCases) {
        await ensureNotAborted();
        try {
          await executeTestCase(testCase);
        } catch (error) {
          if (error instanceof RunAbortError) throw error;
          await enqueueResult({
            testCaseId: testCase.id,
            modelOutput: '',
            scores: {},
            aiFeedback: {},
            latencyMs: 0,
            ocrLatencyMs: 0,
            tokensInput: 0,
            tokensOutput: 0,
            passed: false,
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    await flushResults();
    await updateProgress(true);

    const overallScores: Record<string, number> = {};
    for (const [name, list] of Object.entries(allScores)) {
      overallScores[name] = list.reduce((a, b) => a + b, 0) / list.length;
    }

    const passedCases = await prisma.testCaseResult.count({
      where: { runId, passed: true },
    });

    const evalResults = {
      scores: overallScores,
      totalCases: testCases.length,
      completedCases,
      passedCases,
      llmTimeMs,
      ocrTimeMs,
      summary: `Total ${testCases.length}, Passed ${passedCases}, Rate ${Math.round((passedCases / testCases.length) * 100)}%`,
    };

    await prisma.evaluationRun.update({
      where: { id: runId },
      data: {
        status: 'completed',
        results: evalResults,
        totalTokensInput,
        totalTokensOutput,
        completedAt: new Date(),
      },
    });

    await prisma.evaluation.update({
      where: { id: evaluation.id },
      data: {
        status: 'completed',
        results: evalResults,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    try {
      await flushResults();
    } catch (flushError) {
      console.error('Failed to flush results after run error:', flushError);
    }
    const message = error instanceof RunAbortError ? 'Run aborted' : (error as Error).message;
    await prisma.evaluationRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        errorMessage: message,
        completedAt: new Date(),
      },
    });
    await prisma.evaluation.update({
      where: { id: evaluation.id },
      data: { status: 'failed', completedAt: new Date() },
    });
    if (!(error instanceof RunAbortError)) {
      throw error;
    }
  }
}

type RunJob = {
  userId: string;
  runId: string;
  resolve: () => void;
  reject: (error: Error) => void;
};

class EvaluationRunQueue {
  private readonly pending: RunJob[] = [];
  private readonly active = new Map<string, AbortController>();
  private readonly maxConcurrent = Number.isFinite(RUN_CONCURRENCY) && RUN_CONCURRENCY > 0 ? RUN_CONCURRENCY : 1;

  enqueue(userId: string, runId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.push({ userId, runId, resolve, reject });
      this.process();
    });
  }

  abort(runId: string): boolean {
    const controller = this.active.get(runId);
    if (controller) {
      controller.abort();
      return true;
    }
    const pendingIndex = this.pending.findIndex((job) => job.runId === runId);
    if (pendingIndex >= 0) {
      this.pending.splice(pendingIndex, 1);
      return true;
    }
    return false;
  }

  private process() {
    while (this.active.size < this.maxConcurrent && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) return;
      const controller = new AbortController();
      this.active.set(job.runId, controller);
      executeEvaluationRun(job.runId, { userId: job.userId, signal: controller.signal })
        .then(() => job.resolve())
        .catch((error) => job.reject(error as Error))
        .finally(() => {
          this.active.delete(job.runId);
          this.process();
        });
    }
  }
}

export const evaluationRunner = new EvaluationRunQueue();
