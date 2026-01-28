import type { OcrProvider } from '../types';
import { ApiError } from './client';
import {
  getFetchExceptionCode,
  getFetchExceptionMessage,
  getLocalizedErrorMessage,
  normalizeErrorCode,
} from '../lib/error-messages';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ContentPart {
  type: 'text' | 'image_url' | 'file' | 'file_ref';
  text?: string;
  image_url?: {
    url: string;
  };
  file?: {
    filename: string;
    file_data: string;  // data:application/pdf;base64,...
  };
  file_ref?: {
    fileId: string;
  };
}

export interface ReasoningOptions {
  enabled: boolean;
  effort?: 'default' | 'none' | 'low' | 'medium' | 'high';
}

export interface TraceMessageMeta {
  modelId?: string;
  thinking?: string;
}

export interface ChatCompletionOptions {
  modelId: string;
  messages: ChatMessage[];
  traceMessageMeta?: TraceMessageMeta[];
  promptId?: string;
  chatRunId?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
  saveTrace?: boolean;
  reasoning?: ReasoningOptions;
  responseFormat?: object;
  isEvalCase?: boolean;
  fileProcessing?: 'auto' | 'vision' | 'ocr' | 'none';
  ocrProvider?: OcrProvider;
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      reasoning?: string;
      reasoning_content?: string;
      reasoning_details?: Array<{ type: string; text?: string }>;
    };
    message?: {
      reasoning_details?: Array<{ type: string; text?: string }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function createThinkingTagStripper() {
  const tokens = [
    '<think>',
    '</think>',
    '<thinking>',
    '</thinking>',
    '<thought>',
    '</thought>',
    '<reasoning>',
    '</reasoning>',
    '<seed:think>',
    '</seed:think>',
  ];
  const tokensLower = tokens.map((t) => t.toLowerCase());

  let carry = '';

  const feed = (chunk: string): string => {
    if (!chunk) return '';
    const input = carry + chunk;
    let out = '';

    let i = 0;
    while (i < input.length) {
      // Full-token match
      let matched = false;
      for (let t = 0; t < tokens.length; t++) {
        const token = tokens[t];
        const tokenLen = token.length;
        if (
          i + tokenLen <= input.length &&
          input.slice(i, i + tokenLen).toLowerCase() === tokensLower[t]
        ) {
          matched = true;
          i += tokenLen;
          break;
        }
      }
      if (matched) continue;

      // If the remaining suffix could be the start of a token, buffer it for the next chunk.
      const suffix = input.slice(i);
      const maybeTokenPrefix = tokensLower.some((token) => token.startsWith(suffix.toLowerCase()));
      if (maybeTokenPrefix) break;

      out += input[i];
      i += 1;
    }

    carry = input.slice(i);
    return out;
  };

  const flush = (): string => {
    const out = carry;
    carry = '';
    return out;
  };

  return { feed, flush };
}

type JsonSchemaResponseFormat = {
  type: 'json_schema';
  json_schema?: {
    schema?: {
      type?: string;
    };
  };
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

export interface ChatCompletionResult {
  content: string;
  thinking?: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  latencyMs: number;
  ocrLatencyMs?: number;
  ocrProvider?: OcrProvider;
  ocrFileIds?: string[];
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onThinkingToken?: (token: string) => void;
  onComplete?: (result: { content: string; thinking?: string; usage?: StreamChunk['usage'] }) => void;
  onError?: (error: Error) => void;
  onAbort?: () => void;
}

type ExtractedApiError = { code?: string; message?: string; details?: unknown; requestId?: string };

function extractApiError(value: unknown): ExtractedApiError | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  if (!('error' in record)) return undefined;

  const unwrap = (maybeError: unknown): ExtractedApiError | undefined => {
    if (typeof maybeError === 'string') return { message: maybeError };
    if (!maybeError || typeof maybeError !== 'object') return undefined;

    const obj = maybeError as Record<string, unknown>;
    const code = typeof obj.code === 'string' ? obj.code : undefined;
    const message = typeof obj.message === 'string' ? obj.message : undefined;
    const details = obj.details;
    const requestId = typeof obj.requestId === 'string' ? obj.requestId : undefined;

    if (code || message || details || requestId) {
      return { code, message, details, requestId };
    }

    // Some endpoints double-wrap errors (e.g. { error: { error: { message } } })
    if ('error' in obj) return unwrap(obj.error);

    return undefined;
  };

  return unwrap(record.error);
}

/**
 * Stream chat completion with SSE - enhanced version with thinking support
 */
export async function streamChatCompletionEnhanced(
  options: ChatCompletionOptions,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const token = localStorage.getItem('auth_token');

  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ ...options, stream: true }),
        signal,
      });
    } catch (error) {
      if (getFetchExceptionCode(error) === 'REQUEST_ABORTED') throw error;
      throw new ApiError(0, 'NETWORK_ERROR', getFetchExceptionMessage(error));
    }

    if (!response.ok) {
      const requestIdFromHeader = response.headers.get('X-Request-Id') || undefined;
      const rawText = await response.text().catch(() => '');

      let data: unknown;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        const code = 'INVALID_RESPONSE';
        const message = getLocalizedErrorMessage({ code, status: response.status });
        throw new ApiError(response.status, code, message, { body: rawText }, requestIdFromHeader);
      }

      const payload = data as { error?: { code?: unknown; message?: unknown; details?: unknown; requestId?: unknown } };
      const errorPayload = payload?.error ?? {};
      const requestId = requestIdFromHeader || (typeof errorPayload.requestId === 'string' ? errorPayload.requestId : undefined);
      const code = normalizeErrorCode(errorPayload.code, response.status);
      const message = getLocalizedErrorMessage({
        code,
        status: response.status,
        fallbackMessage: typeof errorPayload.message === 'string' ? errorPayload.message : undefined,
      });

      throw new ApiError(response.status, code, message, errorPayload.details, requestId);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      const code = 'INVALID_RESPONSE';
      const message = getLocalizedErrorMessage({ code, status: response.status });
      throw new ApiError(response.status, code, message);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let fullThinking = '';
    const thinkingStripper = createThinkingTagStripper();
    let lastUsage: StreamChunk['usage'] | undefined;
    let reasoningDetails: Array<{ type: string; text?: string }> = [];

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);

            if (data === '[DONE]') {
              // Extract thinking from reasoning_details if not already captured
              if (!fullThinking && reasoningDetails.length > 0) {
                fullThinking = reasoningDetails
                  .filter((item) => item.type === 'reasoning.text' && item.text)
                  .map((item) => item.text)
                  .join('\n\n');
              }
              fullThinking += thinkingStripper.flush();
              const normalizedThinking = fullThinking.trim();
              const normalizedContent = isJsonSchemaResponseFormat(options.responseFormat)
                ? normalizeStructuredJsonOutput(fullContent, options.responseFormat)
                : fullContent;
              callbacks.onComplete?.({
                content: normalizedContent,
                thinking: normalizedThinking ? normalizedThinking : undefined,
                usage: lastUsage,
              });
              return;
            }

            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch (parseError) {
              console.error('Failed to parse SSE JSON:', parseError);
              continue;
            }

            const streamError = extractApiError(parsed);
            if (streamError && (streamError.code || streamError.message)) {
              const code = normalizeErrorCode(streamError.code, undefined);
              const message = getLocalizedErrorMessage({ code, fallbackMessage: streamError.message });
              throw new ApiError(0, code, message, streamError.details, streamError.requestId);
            }

            const chunk = parsed as StreamChunk;

            const choice = chunk.choices?.[0];
            const delta = choice?.delta;

            // Handle content delta
            if (delta?.content) {
              fullContent += delta.content;
              callbacks.onToken(delta.content);
              // Yield to allow UI updates
              await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
            }

            // Handle reasoning delta (OpenRouter format)
            // Handle reasoning delta (provider-dependent).
            // Some providers may emit both `reasoning` and `reasoning_content` with the same value.
            const deltaReasoningDetails = delta?.reasoning_details ?? [];
            const reasoningParts = [
              delta?.reasoning_content,
              delta?.reasoning,
              ...deltaReasoningDetails
                .filter((item) => item?.type === 'reasoning.text' && typeof item.text === 'string' && item.text.length > 0)
                .map((item) => item.text as string),
            ].filter((value): value is string => typeof value === 'string' && value.length > 0);
            if (reasoningParts.length > 0) {
              const uniqueReasoningParts = [...new Set(reasoningParts)];
              for (const part of uniqueReasoningParts) {
                const cleaned = thinkingStripper.feed(part);
                if (!cleaned) continue;
                fullThinking += cleaned;
                callbacks.onThinkingToken?.(cleaned);
                await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
              }
            }

            // Capture reasoning_details from final message
            if (choice?.message?.reasoning_details) {
              reasoningDetails = choice.message.reasoning_details;
            }

            // Capture usage
            if (chunk.usage) {
              lastUsage = chunk.usage;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Extract thinking from reasoning_details if not already captured
    if (!fullThinking && reasoningDetails.length > 0) {
      fullThinking = reasoningDetails
        .filter((item) => item.type === 'reasoning.text' && item.text)
        .map((item) => item.text)
        .join('\n\n');
    }
    fullThinking += thinkingStripper.flush();
    const normalizedThinking = fullThinking.trim();
    const normalizedContent = isJsonSchemaResponseFormat(options.responseFormat)
      ? normalizeStructuredJsonOutput(fullContent, options.responseFormat)
      : fullContent;
    callbacks.onComplete?.({
      content: normalizedContent,
      thinking: normalizedThinking ? normalizedThinking : undefined,
      usage: lastUsage,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      callbacks.onAbort?.();
      return;
    }
    callbacks.onError?.(error as Error);
    // When a callback is provided, treat it as the primary error handling path.
    if (callbacks.onError) return;
    throw error;
  }
}

/**
 * Stream chat completion with SSE - legacy version for backward compatibility
 */
export async function streamChatCompletion(
  options: ChatCompletionOptions,
  onChunk: (content: string, chunk: StreamChunk) => void,
  onComplete?: (usage?: StreamChunk['usage']) => void,
  onError?: (error: Error) => void,
  signal?: AbortSignal
): Promise<void> {
  return streamChatCompletionEnhanced(
    options,
    {
      onToken: (token) => onChunk(token, {} as StreamChunk),
      onComplete: (result) => onComplete?.(result.usage),
      onError,
    },
    signal
  );
}

/**
 * Non-streaming chat completion
 */
export async function chatCompletion(options: ChatCompletionOptions, signal?: AbortSignal): Promise<ChatCompletionResult> {
  const token = localStorage.getItem('auth_token');

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ ...options, stream: false }),
      signal,
    });
  } catch (error) {
    if (getFetchExceptionCode(error) === 'REQUEST_ABORTED') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', getFetchExceptionMessage(error));
  }

  if (!response.ok) {
    const requestIdFromHeader = response.headers.get('X-Request-Id') || undefined;
    const rawText = await response.text().catch(() => '');

    let data: unknown;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      const code = 'INVALID_RESPONSE';
      const message = getLocalizedErrorMessage({ code, status: response.status });
      throw new ApiError(response.status, code, message, { body: rawText }, requestIdFromHeader);
    }

    const payload = data as { error?: { code?: unknown; message?: unknown; details?: unknown; requestId?: unknown } };
    const errorPayload = payload?.error ?? {};
    const requestId = requestIdFromHeader || (typeof errorPayload.requestId === 'string' ? errorPayload.requestId : undefined);
    const code = normalizeErrorCode(errorPayload.code, response.status);
    const message = getLocalizedErrorMessage({
      code,
      status: response.status,
      fallbackMessage: typeof errorPayload.message === 'string' ? errorPayload.message : undefined,
    });
    throw new ApiError(response.status, code, message, errorPayload.details, requestId);
  }

  const rawText = await response.text().catch(() => '');
  let data: unknown;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    const code = 'INVALID_RESPONSE';
    const message = getLocalizedErrorMessage({ code, status: response.status });
    throw new ApiError(response.status, code, message, { body: rawText });
  }

  const okPayload = data as { data?: unknown };
  return okPayload.data as ChatCompletionResult;
}

/**
 * Chat API with convenience methods
 */
export const chatApi = {
  /**
   * Stream chat completion (legacy)
   */
  stream: streamChatCompletion,

  /**
   * Stream chat completion with thinking support
   */
  streamWithCallbacks: streamChatCompletionEnhanced,

  /**
   * Non-streaming chat completion
   */
  complete: chatCompletion,

  /**
   * Create an abort controller for cancelling requests
   */
  createAbortController: () => new AbortController(),
};
