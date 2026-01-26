import type { OcrProvider } from '../types';

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

function extractErrorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  if (!('error' in record)) return undefined;

  const unwrap = (maybeError: unknown): string | undefined => {
    if (typeof maybeError === 'string') return maybeError;
    if (!maybeError || typeof maybeError !== 'object') return undefined;

    const obj = maybeError as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;

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
    const response = await fetch(`${API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ ...options, stream: true }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let fullThinking = '';
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
              callbacks.onComplete?.({ content: fullContent, thinking: fullThinking || undefined, usage: lastUsage });
              return;
            }

            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch (parseError) {
              console.error('Failed to parse SSE JSON:', parseError);
              continue;
            }

            const errorMessage = extractErrorMessage(parsed);
            if (errorMessage) {
              throw new Error(errorMessage);
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
            if (delta?.reasoning) {
              fullThinking += delta.reasoning;
              callbacks.onThinkingToken?.(delta.reasoning);
              await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
            }

            // Handle reasoning_content delta (alternative format)
            if (delta?.reasoning_content) {
              fullThinking += delta.reasoning_content;
              callbacks.onThinkingToken?.(delta.reasoning_content);
              await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
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
    callbacks.onComplete?.({ content: fullContent, thinking: fullThinking || undefined, usage: lastUsage });
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

  const response = await fetch(`${API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify({ ...options, stream: false }),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data;
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
