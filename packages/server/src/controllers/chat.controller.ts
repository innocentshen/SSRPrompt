import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  getModelWithProvider,
  streamChatCompletion,
  chatCompletion,
  type ChatMessage,
} from '../services/chat.service.js';
import type { Model, Provider, Prisma } from '@prisma/client';
import { tracesRepository } from '../repositories/traces.repository.js';
import { AppError, type OcrProvider } from '@ssrprompt/shared';
import { prisma } from '../config/database.js';
import { filesService } from '../services/files.service.js';
import { ocrService } from '../services/ocr.service.js';
import { providersService } from '../services/providers.service.js';

function normalizeThinkingText(value: string): string {
  return value
    .replace(/<\/?(?:think|thinking|thought|reasoning|seed:think)>/gi, '')
    .replace(/\[\/?THINKING\]/gi, '')
    .replace(/^\s*[:\uFF1A]\s*/, '')
    .trim();
}

type JsonSchemaResponseFormat = {
  type: 'json_schema';
  json_schema?: { schema?: { type?: string } };
};

function isJsonSchemaResponseFormat(value: unknown): value is JsonSchemaResponseFormat {
  if (!value || typeof value !== 'object') return false;
  return (value as { type?: unknown }).type === 'json_schema';
}

function extractBalancedJson(source: string, startIndex: number): string | null {
  const open = source[startIndex];
  if (open !== '{' && open !== '[') return null;

  const stack: Array<'{' | '['> = [open];
  let inString = false;
  let escaped = false;

  for (let i = startIndex + 1; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
      continue;
    }

    if (ch === '}' || ch === ']') {
      const last = stack.pop();
      if (!last) return null;
      if ((last === '{' && ch !== '}') || (last === '[' && ch !== ']')) return null;

      if (stack.length === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function normalizeStructuredJsonOutput(content: string, responseFormat: JsonSchemaResponseFormat): string {
  const trimmed = content.trim();
  if (!trimmed) return content;

  // Already valid JSON; keep as-is (but trim).
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // continue
  }

  const rootType = responseFormat.json_schema?.schema?.type;
  const preferredStart = rootType === 'array' ? '[' : '{';

  let startIndex = content.indexOf(preferredStart);
  if (startIndex === -1) {
    const objIndex = content.indexOf('{');
    const arrIndex = content.indexOf('[');
    if (objIndex === -1 && arrIndex === -1) return content;
    startIndex =
      objIndex === -1 ? arrIndex : arrIndex === -1 ? objIndex : Math.min(objIndex, arrIndex);
  }

  const candidate = extractBalancedJson(content, startIndex);
  if (!candidate) return content;

  try {
    const parsed = JSON.parse(candidate);
    return JSON.stringify(parsed);
  } catch {
    return candidate.trim();
  }
}

// Content part schema for vision and files
const ContentPartSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('image_url'),
    image_url: z.object({
      url: z.string(),
    }),
  }),
  z.object({
    type: z.literal('file'),
    file: z.object({
      filename: z.string(),
      file_data: z.string(),  // data:application/pdf;base64,...
    }),
  }),
  z.object({
    type: z.literal('file_ref'),
    file_ref: z.object({
      fileId: z.string().uuid(),
    }),
  }),
]);

// Chat message schema
const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.union([z.string(), z.array(ContentPartSchema)]),
});

const TraceMessageMetaSchema = z.object({
  modelId: z.string().uuid().optional(),
  thinking: z.string().optional(),
});

// Chat completion request schema
const ChatCompletionSchema = z.object({
  modelId: z.string().uuid(),
  messages: z.array(ChatMessageSchema).min(1),
  traceMessageMeta: z.array(TraceMessageMetaSchema).optional(),
  promptId: z.string().uuid().optional(),
  chatRunId: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().positive().optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  stream: z.boolean().optional().default(true),
  saveTrace: z.boolean().optional().default(true),
  reasoning: z.object({
    enabled: z.boolean(),
    effort: z.enum(['default', 'none', 'low', 'medium', 'high']).optional(),
  }).optional(),
  responseFormat: z.record(z.unknown()).optional(),
  isEvalCase: z.boolean().optional().default(false),
  fileProcessing: z.enum(['auto', 'vision', 'ocr', 'none']).optional(),
  ocrProvider: z.enum(['paddle', 'paddle_vl', 'paddle_vl_1_5', 'datalab', 'mineru']).optional(),
});

type IncomingChatMessage = z.infer<typeof ChatMessageSchema>;

type TraceAttachment = { fileId: string; name: string; type: string; size: number };

interface ExpandedMessages {
  messages: ChatMessage[];
  inputContent: string;
  attachments: TraceAttachment[];
  ocrLatencyMs: number;
  ocrProvider?: OcrProvider;
  ocrFileIds: string[];
}

const DEFAULT_MAX_CONTEXT_LENGTH = 8000;
const MODEL_CONTEXT_TTL_MS = 6 * 60 * 60 * 1000;
const modelContextCache = new Map<string, { value: number; checkedAt: number }>();

async function resolveModelMaxContextLength(
  userId: string,
  model: Model,
  provider: Provider,
  origin?: string
): Promise<number> {
  const cached = modelContextCache.get(model.id);
  const now = Date.now();

  if (cached && cached.value === model.maxContextLength && now - cached.checkedAt < MODEL_CONTEXT_TTL_MS) {
    return cached.value;
  }

  if (model.maxContextLength !== DEFAULT_MAX_CONTEXT_LENGTH) {
    modelContextCache.set(model.id, { value: model.maxContextLength, checkedAt: now });
    return model.maxContextLength;
  }

  if (provider.type !== 'openrouter' && provider.type !== 'gemini') {
    modelContextCache.set(model.id, { value: model.maxContextLength, checkedAt: now });
    return model.maxContextLength;
  }

  try {
    const discovered = await providersService.discoverModels(userId, provider.id, { type: provider.type }, origin);
    const match = discovered.find((item) => item.id === model.modelId);
    if (match?.maxContextLength && match.maxContextLength >= 256) {
      await prisma.model.update({
        where: { id: model.id },
        data: { maxContextLength: match.maxContextLength },
      });
      modelContextCache.set(model.id, { value: match.maxContextLength, checkedAt: now });
      return match.maxContextLength;
    }
  } catch (error) {
    console.error('Failed to refresh model context length:', error);
  }

  modelContextCache.set(model.id, { value: model.maxContextLength, checkedAt: now });
  return model.maxContextLength;
}

/**
 * Extract textual input content for trace storage.
 */
function extractMessageText(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;

  const parts = message.content as Array<{ type: string; text?: string }>;
  const textParts = parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string' && p.text.length > 0)
    .map((p) => p.text)
    .join('\n');

  return textParts || '[含附件内容]';
}

function extractInputContent(messages: ChatMessage[]): string {
  return messages.map(extractMessageText).join('\n');
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

type RawContentPart = z.infer<typeof ContentPartSchema>;

async function expandMessages(
  userId: string,
  messages: IncomingChatMessage[],
  mode: 'vision' | 'ocr',
  options?: { ocrProvider?: OcrProvider }
): Promise<ExpandedMessages> {
  const attachments: TraceAttachment[] = [];
  const seenFileIds = new Set<string>();
  const ocrTextByFileId = new Map<string, string>();
  const ocrFileIds = new Set<string>();
  let ocrLatencyMs = 0;
  let ocrProvider: OcrProvider | undefined;

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
          attachments.push({
            fileId,
            name: meta.originalName,
            type: meta.mimeType,
            size: meta.size,
          });
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
            ocrFileIds.add(fileId);
            if (!ocrProvider) {
              ocrProvider = result.provider;
            }
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
            originalName: `image_${attachments.length + 1}.${extensionFromMimeType(dataUrl.mimeType)}`,
            mimeType: dataUrl.mimeType,
            size: buffer.length,
            buffer,
          });

          if (!seenFileIds.has(stored.id)) {
            attachments.push({
              fileId: stored.id,
              name: stored.originalName,
              type: stored.mimeType,
              size: stored.size,
            });
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
            attachments.push({
              fileId: stored.id,
              name: stored.originalName,
              type: stored.mimeType,
              size: stored.size,
            });
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

  return {
    messages: expanded,
    inputContent: extractInputContent(expanded),
    attachments,
    ocrLatencyMs,
    ocrProvider,
    ocrFileIds: Array.from(ocrFileIds),
  };
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

function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  // Conservative heuristic: count CJK chars as 1 token; other chars as 1 token per ~4 chars.
  const cjkMatches = text.match(/[\u4E00-\u9FFF]/g);
  const cjk = cjkMatches ? cjkMatches.length : 0;
  const other = Math.max(0, text.length - cjk);
  return Math.ceil(cjk + other / 4);
}

function estimateTokensFromMessages(messages: ChatMessage[]): number {
  let tokens = 0;
  for (const msg of messages) {
    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else {
      for (const part of msg.content as Array<{ type: string; text?: string }>) {
        if (part.type === 'text' && typeof part.text === 'string') text += part.text + '\n';
      }
    }

    // Per-message overhead (role tags, separators, etc.)
    tokens += 4 + estimateTokensFromText(text);
  }
  return tokens;
}

export const chatController = {
  /**
   * POST /chat/completions - Chat completion with streaming
   */
  async completions(req: Request, res: Response): Promise<void> {
    const data = ChatCompletionSchema.parse(req.body);
    const userId = req.user!.userId;

    // Get model with decrypted API key
    const { model, provider, apiKey } = await getModelWithProvider(userId, data.modelId);
    const maxContextLength = await resolveModelMaxContextLength(userId, model, provider, req.headers.origin as string | undefined);

    const requestedFileProcessing = data.fileProcessing ?? 'auto';

    const messagesForModel =
      requestedFileProcessing === 'none'
        ? stripFileParts(data.messages)
        : data.messages;

    const wantsFiles = hasFileParts(messagesForModel);

    let mode: 'vision' | 'ocr' = 'vision';
    if (wantsFiles) {
      if (requestedFileProcessing === 'ocr') mode = 'ocr';
      else if (requestedFileProcessing === 'vision') mode = 'vision';
      else mode = model.supportsVision ? 'vision' : 'ocr';
    }

    if (wantsFiles && mode === 'ocr') {
      const ocrSettings = await ocrService.getSettings(userId);
      if (!ocrSettings.enabled) {
        throw new AppError(400, 'FILE_UPLOAD_NOT_ALLOWED', 'File upload requires OCR to be enabled');
      }
    }

    if (wantsFiles && mode === 'vision' && !model.supportsVision) {
      throw new AppError(
        400,
        'FILE_UPLOAD_NOT_ALLOWED',
        'This model does not support direct file inputs. Enable OCR to use attachments.'
      );
    }

    const expanded = await expandMessages(userId, messagesForModel, mode, { ocrProvider: data.ocrProvider });
    const ocrLatencyMs = expanded.ocrLatencyMs;
    const timingsMeta = ocrLatencyMs > 0 ? { timings: { ocrLatencyMs } } : {};
    const ocrMeta = expanded.ocrFileIds.length > 0
      ? {
          ...(expanded.ocrProvider ? { ocrProvider: expanded.ocrProvider } : {}),
          ocrFileIds: expanded.ocrFileIds,
        }
      : {};

    // Context budget check (no chunking). Estimate tokens conservatively.
    const estimatedTokens = estimateTokensFromMessages(expanded.messages);
    if (estimatedTokens > maxContextLength) {
      throw new AppError(400, 'CONTEXT_LIMIT_EXCEEDED', 'Context length exceeded', {
        estimatedTokens,
        maxContextLength,
      });
    }

    const startTime = Date.now();
    const abortController = new AbortController();

    // Listen for client disconnect
    req.on('close', () => {
      console.log('Client disconnected, aborting LLM request');
      abortController.abort();
    });

    const options = {
      temperature: data.temperature,
      top_p: data.top_p,
      max_tokens: data.max_tokens,
      frequency_penalty: data.frequency_penalty,
      presence_penalty: data.presence_penalty,
      reasoning: data.reasoning,
      responseFormat: data.responseFormat,
    };
    const modelParameters = Object.fromEntries(
      Object.entries({
        temperature: data.temperature,
        top_p: data.top_p,
        max_tokens: data.max_tokens,
        frequency_penalty: data.frequency_penalty,
        presence_penalty: data.presence_penalty,
        reasoning: data.reasoning,
        responseFormat: data.responseFormat,
      }).filter(([, value]) => value !== undefined)
    ) as Prisma.InputJsonObject;
    const paramsMeta = Object.keys(modelParameters).length > 0 ? { modelParameters } : {};
    const traceMessages = expanded.messages.map((m, idx) => {
      const meta = data.traceMessageMeta?.[idx];
      const modelId = meta && typeof meta.modelId === 'string' ? meta.modelId : undefined;
      const thinkingRaw = meta && typeof meta.thinking === 'string' ? meta.thinking.trim() : '';
      const thinking = m.role === 'assistant' && thinkingRaw ? thinkingRaw : undefined;
      return {
        role: m.role,
        content: extractMessageText(m),
        ...(modelId ? { modelId } : {}),
        ...(thinking ? { thinking } : {}),
      };
    });

    if (data.stream) {
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      let fullContent = '';
      let fullThinking = '';
      let thinkingStartedAt: number | null = null;
      let thinkingEndedAt: number | null = null;
      let reasoningDetails: Array<{ type: string; text?: string }> = [];
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      try {
        const stream = streamChatCompletion(
          provider,
          model,
          apiKey,
          expanded.messages,
          options,
          abortController.signal
        );

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;

          // Accumulate content
          const deltaContent = chunk.choices?.[0]?.delta?.content;
          if (deltaContent) {
            fullContent += deltaContent;
          }

          // Accumulate thinking (OpenRouter / Gemini / other OpenAI-compatible providers)
          const deltaReasoning = (chunk as unknown as {
            choices?: Array<{
              delta?: { reasoning?: string; reasoning_content?: string };
              message?: { reasoning_details?: Array<{ type: string; text?: string }> };
            }>;
          }).choices?.[0]?.delta?.reasoning
            ?? (chunk as unknown as {
              choices?: Array<{ delta?: { reasoning_content?: string } }>;
            }).choices?.[0]?.delta?.reasoning_content;

          if (deltaReasoning) {
            fullThinking += deltaReasoning;
            const now = Date.now();
            if (thinkingStartedAt === null) thinkingStartedAt = now;
            thinkingEndedAt = now;
          }

          const maybeDetails = (chunk as unknown as {
            choices?: Array<{ message?: { reasoning_details?: Array<{ type: string; text?: string }> } }>;
          }).choices?.[0]?.message?.reasoning_details;
          if (Array.isArray(maybeDetails) && maybeDetails.length > 0) {
            reasoningDetails = maybeDetails;
          }

          // Capture usage if present
          if (chunk.usage) {
            usage = chunk.usage;
          }

          // Send chunk to client
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        res.write('data: [DONE]\n\n');
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          console.log('LLM request aborted by client');
        } else {
          const appError = error instanceof AppError ? error : new AppError(
            500,
            'PROVIDER_ERROR',
            (error as Error).message
          );
          // Keep SSE error shape consistent with REST error responses: { error: { code, message, details } }
          const payload = appError.toJSON() as { error?: Record<string, unknown> };
          if (req.requestId) {
            payload.error = payload.error ?? {};
            payload.error.requestId = req.requestId;
          }
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
      } finally {
        const latencyMs = Date.now() - startTime;
        const normalizedOutput = isJsonSchemaResponseFormat(data.responseFormat)
          ? normalizeStructuredJsonOutput(fullContent, data.responseFormat)
          : fullContent;
        const rawThinking =
          fullThinking.trim() ||
          (reasoningDetails.length > 0
            ? reasoningDetails
                .filter((item) => item.type === 'reasoning.text' && item.text)
                .map((item) => item.text)
                .join('\n\n')
                .trim()
            : '');
        const extractedThinking = normalizeThinkingText(rawThinking);
        const thinkingTimeMs =
          thinkingStartedAt !== null && thinkingEndedAt !== null ? Math.max(0, thinkingEndedAt - thinkingStartedAt) : null;

        // Save trace if requested and not aborted
        if (data.saveTrace && !abortController.signal.aborted) {
          try {
            await tracesRepository.create(userId, {
              input: expanded.inputContent,
              output: normalizedOutput || null,
              thinkingContent: extractedThinking || undefined,
              thinkingTimeMs: thinkingTimeMs ?? undefined,
              tokensInput: usage.prompt_tokens,
              tokensOutput: usage.completion_tokens,
              latencyMs,
              status: normalizedOutput ? 'success' : 'error',
              prompt: data.promptId ? { connect: { id: data.promptId } } : undefined,
              model: { connect: { id: model.id } },
              attachments: expanded.attachments.length > 0 ? expanded.attachments : undefined,
              metadata: ({
                  ...(expanded.attachments.length > 0
                  ? {
                      files: expanded.attachments.map((a) => ({
                        fileId: a.fileId,
                        name: a.name,
                        type: a.type,
                        size: a.size,
                      })),
                    }
                   : {}),
                  ...(data.chatRunId ? { chatRunId: data.chatRunId } : {}),
                  messages: traceMessages,
                  ...timingsMeta,
                  ...ocrMeta,
                  ...paramsMeta,
                } satisfies Prisma.InputJsonObject),
            });
          } catch (traceError) {
            console.error('Failed to save trace:', traceError);
          }
        }

        res.end();
      }
    } else {
      // Non-streaming response
      try {
        const result = await chatCompletion(
          provider,
          model,
          apiKey,
          expanded.messages,
          options
        );

        const latencyMs = Date.now() - startTime;
        const normalizedOutput = isJsonSchemaResponseFormat(data.responseFormat)
          ? normalizeStructuredJsonOutput(result.content, data.responseFormat)
          : result.content;

        // Save trace if requested
        if (data.saveTrace) {
          try {
            await tracesRepository.create(userId, {
              input: expanded.inputContent,
              output: normalizedOutput,
              tokensInput: result.usage.prompt_tokens,
              tokensOutput: result.usage.completion_tokens,
              latencyMs,
              status: 'success',
              prompt: data.promptId ? { connect: { id: data.promptId } } : undefined,
              model: { connect: { id: model.id } },
              attachments: expanded.attachments.length > 0 ? expanded.attachments : undefined,
              metadata: (expanded.attachments.length > 0
                ? {
                    files: expanded.attachments.map((a) => ({
                      fileId: a.fileId,
                      name: a.name,
                      type: a.type,
                      size: a.size,
                    })),
                    ...(data.chatRunId ? { chatRunId: data.chatRunId } : {}),
                    messages: traceMessages,
                    ...timingsMeta,
                    ...ocrMeta,
                    ...paramsMeta,
                  }
                : {
                    ...(data.chatRunId ? { chatRunId: data.chatRunId } : {}),
                    messages: traceMessages,
                    ...timingsMeta,
                    ...ocrMeta,
                    ...paramsMeta,
                  }) satisfies Prisma.InputJsonObject,
            });
          } catch (traceError) {
            console.error('Failed to save trace:', traceError);
          }
        }

        res.json({
          data: {
            content: normalizedOutput,
            usage: result.usage,
            latencyMs,
            ocrLatencyMs,
            ocrProvider: expanded.ocrProvider,
            ocrFileIds: expanded.ocrFileIds,
          },
        });
      } catch (error) {
        const latencyMs = Date.now() - startTime;

        // Save error trace if requested
        if (data.saveTrace) {
          try {
            await tracesRepository.create(userId, {
              input: expanded.inputContent,
              output: null,
              latencyMs,
              status: 'error',
              errorMessage: (error as Error).message,
              prompt: data.promptId ? { connect: { id: data.promptId } } : undefined,
              model: { connect: { id: model.id } },
              attachments: expanded.attachments.length > 0 ? expanded.attachments : undefined,
              metadata: (expanded.attachments.length > 0
                ? {
                    files: expanded.attachments.map((a) => ({
                      fileId: a.fileId,
                      name: a.name,
                      type: a.type,
                      size: a.size,
                    })),
                    ...(data.chatRunId ? { chatRunId: data.chatRunId } : {}),
                    messages: traceMessages,
                    ...timingsMeta,
                    ...ocrMeta,
                    ...paramsMeta,
                  }
                : {
                    ...(data.chatRunId ? { chatRunId: data.chatRunId } : {}),
                    messages: traceMessages,
                    ...timingsMeta,
                    ...ocrMeta,
                    ...paramsMeta,
                  }) satisfies Prisma.InputJsonObject,
            });
          } catch (traceError) {
            console.error('Failed to save trace:', traceError);
          }
        }

        throw error;
      }
    }
  },
};
