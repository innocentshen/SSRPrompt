import { prisma } from '../config/database.js';
import { decrypt, isEncrypted } from '../utils/crypto.js';
import { AppError } from '@ssrprompt/shared';
import type { Model, Provider } from '@prisma/client';

function normalizeProviderErrorMessage(provider: Provider, status: number, message: string): string {
  const normalized = message?.trim() || '';
  if (!normalized) return normalized;

  // OpenRouter returns this message when auth is missing/invalid (it also supports cookie auth for the web app).
  if (status === 401 && /cookie auth credentials/i.test(normalized)) {
    const label = provider.type === 'openrouter' ? 'OpenRouter' : provider.type;
    return `${label} authentication failed: API key is missing or invalid (cookie auth is not supported). Please configure the provider API key in Settings.`;
  }

  return normalized;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ContentPart {
  type: 'text' | 'image_url' | 'file';
  text?: string;
  image_url?: {
    url: string;
  };
  file?: {
    filename: string;
    file_data: string;  // data:application/pdf;base64,...
  };
}

export interface ChatCompletionOptions {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
  reasoning?: {
    enabled: boolean;
    effort?: 'default' | 'none' | 'low' | 'medium' | 'high';
  };
  responseFormat?: object;
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
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Get model with decrypted API key
 */
export async function getModelWithProvider(
  userId: string,
  modelId: string
): Promise<{ model: Model; provider: Provider; apiKey: string }> {
  const model = await prisma.model.findUnique({
    where: { id: modelId },
    include: { provider: true },
  });

  if (!model || !model.provider) {
    throw new AppError(404, 'NOT_FOUND', 'Model not found');
  }

  // Verify provider belongs to user
  if (model.provider.userId !== userId && !model.provider.isSystem) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied to this model');
  }

  // Enabled state:
  // - For user-owned providers: `provider.enabled` is per-user.
  // - For system providers: `provider.enabled` is the global master switch; users can opt out via UserProviderSetting.
  if (model.provider.isSystem) {
    if (!model.provider.enabled) {
      throw new AppError(400, 'PROVIDER_ERROR', 'Provider is not enabled');
    }

    const setting = await prisma.userProviderSetting.findUnique({
      where: { userId_providerId: { userId, providerId: model.provider.id } },
      select: { enabled: true },
    });

    if (setting && !setting.enabled) {
      throw new AppError(400, 'PROVIDER_ERROR', 'Provider is not enabled');
    }
  } else if (!model.provider.enabled) {
    throw new AppError(400, 'PROVIDER_ERROR', 'Provider is not enabled');
  }

  // Decrypt API key
  const rawApiKey = model.provider.apiKey?.trim() || '';
  if (!rawApiKey || rawApiKey === '***decryption-failed***' || (rawApiKey.endsWith('...') && rawApiKey.length <= 20)) {
    throw new AppError(400, 'PROVIDER_ERROR', 'Provider API key is not configured. Please set it in Settings.');
  }

  let apiKey = rawApiKey;
  if (isEncrypted(rawApiKey)) {
    try {
      apiKey = decrypt(rawApiKey);
    } catch {
      throw new AppError(
        400,
        'PROVIDER_ERROR',
        'Provider API key cannot be decrypted. Please re-enter the API key in Settings.'
      );
    }
  }

  return { model, provider: model.provider, apiKey };
}

/**
 * Build provider-specific API URL
 */
export function buildApiUrl(provider: Provider): string {
  if (provider.baseUrl) {
    return `${provider.baseUrl}/chat/completions`;
  }

  switch (provider.type) {
    case 'openai':
      return 'https://api.openai.com/v1/chat/completions';
    case 'anthropic':
      return 'https://api.anthropic.com/v1/messages';
    case 'gemini':
      return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1/chat/completions';
    default:
      throw new AppError(400, 'PROVIDER_ERROR', `Unknown provider type: ${provider.type}`);
  }
}

/**
 * Build request headers for provider
 */
export function buildHeaders(provider: Provider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  switch (provider.type) {
    case 'anthropic':
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      break;
    case 'gemini':
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;
    default:
      headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

/**
 * Transform messages for Anthropic format
 */
function transformForAnthropic(messages: ChatMessage[]): {
  system?: string;
  messages: Array<{ role: string; content: string | ContentPart[] }>;
} {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const otherMessages = messages.filter((m) => m.role !== 'system');

  return {
    system: systemMessages.length > 0
      ? systemMessages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
      : undefined,
    messages: otherMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };
}

/**
 * Build reasoning parameters for different providers
 */
function buildReasoningParams(
  provider: Provider,
  modelId: string,
  reasoning?: ChatCompletionOptions['reasoning']
): Record<string, unknown> {
  if (!reasoning?.enabled || reasoning.effort === 'none' || reasoning.effort === 'default') {
    return {};
  }

  const lowerModelId = modelId.toLowerCase();

  // OpenRouter uses reasoning.effort format
  if (provider.type === 'openrouter') {
    return {
      reasoning: {
        effort: reasoning.effort,
      },
    };
  }

  // Gemini models
  if (provider.type === 'gemini' || lowerModelId.includes('gemini')) {
    return {
      reasoning: {
        effort: reasoning.effort,
      },
    };
  }

  // Anthropic extended thinking
  if (provider.type === 'anthropic' || lowerModelId.includes('claude')) {
    // Anthropic uses thinking parameter
    return {};  // Anthropic handles this differently
  }

  return {};
}

/**
 * Build request body for provider
 */
export function buildRequestBody(
  provider: Provider,
  model: Model,
  messages: ChatMessage[],
  options: ChatCompletionOptions
): Record<string, unknown> {
  if (provider.type === 'anthropic') {
    const { system, messages: transformedMessages } = transformForAnthropic(messages);
    return {
      model: model.modelId,
      messages: transformedMessages,
      system,
      max_tokens: options.max_tokens || 8000,
      temperature: options.temperature,
      top_p: options.top_p,
      stream: options.stream ?? true,
    };
  }

  // OpenAI-compatible format (OpenAI, OpenRouter, Gemini, Custom)
  const body: Record<string, unknown> = {
    model: model.modelId,
    messages,
    temperature: options.temperature,
    top_p: options.top_p,
    max_tokens: options.max_tokens,
    frequency_penalty: options.frequency_penalty,
    presence_penalty: options.presence_penalty,
    stream: options.stream ?? true,
  };

  // Add stream_options for usage tracking
  if (options.stream !== false) {
    body.stream_options = { include_usage: true };
  }

  // Add reasoning parameters
  const reasoningParams = buildReasoningParams(provider, model.modelId, options.reasoning);
  Object.assign(body, reasoningParams);

  // Add response format if specified
  if (options.responseFormat) {
    body.response_format = options.responseFormat;
  }

  return body;
}

/**
 * Parse SSE data from different providers
 */
export function parseSSEChunk(provider: Provider, data: string): StreamChunk | null {
  if (data === '[DONE]') {
    return null;
  }

  try {
    const parsed = JSON.parse(data);

    // Anthropic format
    if (provider.type === 'anthropic') {
      if (parsed.type === 'content_block_delta') {
        return {
          id: parsed.index?.toString() || '0',
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: '',
          choices: [
            {
              index: 0,
              delta: {
                content: parsed.delta?.text || '',
              },
              finish_reason: null,
            },
          ],
        };
      }
      if (parsed.type === 'message_stop') {
        return {
          id: '0',
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: '',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
            },
          ],
        };
      }
      if (parsed.type === 'message_delta' && parsed.usage) {
        return {
          id: '0',
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: '',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: parsed.delta?.stop_reason || null,
            },
          ],
          usage: {
            prompt_tokens: parsed.usage.input_tokens || 0,
            completion_tokens: parsed.usage.output_tokens || 0,
            total_tokens: (parsed.usage.input_tokens || 0) + (parsed.usage.output_tokens || 0),
          },
        };
      }
      return null;
    }

    // OpenAI-compatible format
    return parsed as StreamChunk;
  } catch {
    return null;
  }
}

/**
 * Stream response from LLM provider
 */
export async function* streamChatCompletion(
  provider: Provider,
  model: Model,
  apiKey: string,
  messages: ChatMessage[],
  options: ChatCompletionOptions,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk, void, unknown> {
  const url = buildApiUrl(provider);
  const headers = buildHeaders(provider, apiKey);
  const body = buildRequestBody(provider, model, messages, { ...options, stream: true });

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const rawMessage = errorData.error?.message || `Provider API error: ${response.statusText}`;
    const message = normalizeProviderErrorMessage(provider, response.status, rawMessage);
    throw new AppError(
      response.status,
      'PROVIDER_ERROR',
      message,
      errorData
    );
  }

  if (!response.body) {
    throw new AppError(500, 'PROVIDER_ERROR', 'No response body from provider');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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
          const chunk = parseSSEChunk(provider, data);
          if (chunk) {
            yield chunk;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Non-streaming chat completion
 */
export async function chatCompletion(
  provider: Provider,
  model: Model,
  apiKey: string,
  messages: ChatMessage[],
  options: ChatCompletionOptions,
  signal?: AbortSignal
): Promise<{
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}> {
  const url = buildApiUrl(provider);
  const headers = buildHeaders(provider, apiKey);
  const body = buildRequestBody(provider, model, messages, { ...options, stream: false });

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const rawMessage = errorData.error?.message || `Provider API error: ${response.statusText}`;
    const message = normalizeProviderErrorMessage(provider, response.status, rawMessage);
    throw new AppError(
      response.status,
      'PROVIDER_ERROR',
      message,
      errorData
    );
  }

  const data = await response.json();

  // Anthropic format
  if (provider.type === 'anthropic') {
    return {
      content: data.content?.[0]?.text || '',
      usage: {
        prompt_tokens: data.usage?.input_tokens || 0,
        completion_tokens: data.usage?.output_tokens || 0,
        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
    };
  }

  // OpenAI-compatible format
  return {
    content: data.choices?.[0]?.message?.content || '',
    usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
