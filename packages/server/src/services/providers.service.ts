import { Provider } from '@prisma/client';
import { providersRepository } from '../repositories/index.js';
import { CreateProviderInput, UpdateProviderInput, TestConnectionInput, DiscoverProviderModelsInput, AppError } from '@ssrprompt/shared';

interface DiscoveredModel {
  id: string;
  name: string;
  owned_by?: string;
  maxContextLength?: number;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/#$/, '').replace(/\/$/, '');
}

function pickPrimaryApiKey(value: string): string {
  return value.split(',')[0]?.trim() ?? '';
}

function buildOpenAICompatibleModelsUrl(baseUrl: string): string {
  const cleanBaseUrl = normalizeBaseUrl(baseUrl);
  return cleanBaseUrl.endsWith('/v1') ? `${cleanBaseUrl}/models` : `${cleanBaseUrl}/v1/models`;
}

function buildGeminiModelsUrl(baseUrl: string, apiKey: string): string {
  const cleanBaseUrl = normalizeBaseUrl(baseUrl);
  const encodedKey = encodeURIComponent(apiKey);

  if (cleanBaseUrl.endsWith('/v1beta/openai')) {
    return `${cleanBaseUrl.replace(/\/v1beta\/openai$/, '/v1beta')}/models?key=${encodedKey}`;
  }

  return cleanBaseUrl.endsWith('/v1beta')
    ? `${cleanBaseUrl}/models?key=${encodedKey}`
    : `${cleanBaseUrl}/v1beta/models?key=${encodedKey}`;
}

async function parseErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `Provider API error: ${response.statusText}`;

  try {
    const json = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return json.error?.message || json.message || `Provider API error: ${response.statusText}`;
  } catch {
    return text.slice(0, 500) || `Provider API error: ${response.statusText}`;
  }
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

export class ProvidersService {
  /**
   * Get all providers for a user
   */
  async findAll(userId: string): Promise<Provider[]> {
    return providersRepository.findAll(userId);
  }

  /**
   * Get provider by ID
   */
  async findById(userId: string, id: string): Promise<Provider | null> {
    return providersRepository.findById(userId, id);
  }

  /**
   * Get provider with models
   */
  async findWithModels(userId: string, id: string) {
    return providersRepository.findWithModels(userId, id);
  }

  /**
   * Create a new provider
   */
  async create(userId: string, data: CreateProviderInput): Promise<Provider> {
    return providersRepository.create(userId, {
      name: data.name,
      type: data.type,
      apiKey: data.apiKey,
      baseUrl: data.baseUrl,
      enabled: data.enabled ?? false,
    });
  }

  /**
   * Update a provider
   */
  async update(userId: string, id: string, data: UpdateProviderInput): Promise<Provider> {
    return providersRepository.update(userId, id, data);
  }

  /**
   * Delete a provider and all its models
   */
  async delete(userId: string, id: string): Promise<Provider> {
    // Models are deleted automatically via Prisma cascade
    return providersRepository.delete(userId, id);
  }

  /**
   * Test connection to a provider API
   */
  async testConnection(data: TestConnectionInput): Promise<TestConnectionResult> {
    const startTime = Date.now();

    try {
      const { type, apiKey, baseUrl } = data;

      // Build test URL based on provider type
      let testUrl: string;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      switch (type) {
        case 'openai':
          testUrl = baseUrl ? `${baseUrl}/models` : 'https://api.openai.com/v1/models';
          headers['Authorization'] = `Bearer ${apiKey}`;
          break;
        case 'anthropic':
          testUrl = baseUrl ? `${baseUrl}/messages` : 'https://api.anthropic.com/v1/messages';
          headers['x-api-key'] = apiKey;
          headers['anthropic-version'] = '2023-06-01';
          break;
        case 'gemini':
          testUrl = baseUrl
            ? `${baseUrl}/models`
            : `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
          if (!baseUrl) {
            delete headers['Content-Type'];
          } else {
            headers['Authorization'] = `Bearer ${apiKey}`;
          }
          break;
        case 'openrouter':
          // /models is public and doesn't validate API keys; use /credits to verify auth without spending tokens.
          testUrl = baseUrl ? `${baseUrl}/credits` : 'https://openrouter.ai/api/v1/credits';
          headers['Authorization'] = `Bearer ${apiKey}`;
          break;
        case 'custom':
          if (!baseUrl) {
            throw new AppError(400, 'VALIDATION_ERROR', 'Base URL is required for custom providers');
          }
          testUrl = `${baseUrl}/models`;
          headers['Authorization'] = `Bearer ${apiKey}`;
          break;
        default:
          throw new AppError(400, 'VALIDATION_ERROR', `Unsupported provider type: ${type}`);
      }

      // Make test request
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        let response: Response;

        if (type === 'anthropic') {
          response = await fetch(testUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: 'claude-3-haiku-20240307',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'Hi' }],
            }),
            signal: controller.signal,
          });
        } else {
          response = await fetch(testUrl, {
            method: 'GET',
            headers: type === 'gemini' && !baseUrl ? undefined : headers,
            signal: controller.signal,
          });
        }

        clearTimeout(timeout);
        const latencyMs = Date.now() - startTime;

        if (response.ok) {
          return {
            success: true,
            message: 'Connection successful',
            latencyMs,
          };
        }

        const errorBody = await response.text();
        let errorMessage = `API returned ${response.status}`;

        try {
          const errorJson = JSON.parse(errorBody);
          errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch {
          // Use default error message
        }

        if (type === 'openrouter' && response.status === 401 && /cookie auth credentials/i.test(errorMessage)) {
          errorMessage = 'OpenRouter authentication failed: API key is missing or invalid.';
        }

        return {
          success: false,
          message: errorMessage,
          latencyMs,
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      if (error instanceof AppError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('abort')) {
        return {
          success: false,
          message: 'Connection timeout (10s)',
          latencyMs,
        };
      }

      return {
        success: false,
        message: `Connection failed: ${errorMessage}`,
        latencyMs,
      };
    }
  }

  /**
   * Discover models supported by a provider (remote model list).
   * Uses saved provider credentials by default, but allows temporary overrides from the UI.
   */
  async discoverModels(
    userId: string,
    providerId: string,
    input: DiscoverProviderModelsInput,
    requestOrigin?: string
  ): Promise<DiscoveredModel[]> {
    const provider = await providersRepository.findById(userId, providerId);

    if (!provider) {
      throw new AppError(404, 'NOT_FOUND', 'Provider not found');
    }

    const effectiveType = input.type ?? provider.type;
    const rawApiKey = (input.apiKey ?? provider.apiKey ?? '').trim();
    const isLikelyMasked =
      rawApiKey === '***decryption-failed***' || (rawApiKey.endsWith('...') && rawApiKey.length <= 20);
    const apiKey = isLikelyMasked ? '' : pickPrimaryApiKey(rawApiKey);

    const baseUrlOverride = Object.prototype.hasOwnProperty.call(input, 'baseUrl') ? input.baseUrl : undefined;
    const effectiveBaseUrl =
      baseUrlOverride === undefined ? provider.baseUrl : baseUrlOverride;

    let url: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (effectiveType === 'openai') {
      if (!apiKey) {
        throw new AppError(400, 'PROVIDER_ERROR', 'Provider API key is not configured. Please set it in Settings.');
      }
      url = effectiveBaseUrl
        ? buildOpenAICompatibleModelsUrl(effectiveBaseUrl)
        : 'https://api.openai.com/v1/models';
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (effectiveType === 'openrouter') {
      url = effectiveBaseUrl
        ? buildOpenAICompatibleModelsUrl(effectiveBaseUrl)
        : 'https://openrouter.ai/api/v1/models';

      // /models is public for OpenRouter, but include auth if available.
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      if (requestOrigin) {
        headers['HTTP-Referer'] = requestOrigin;
      }
      headers['X-Title'] = 'SSRPrompt';
    } else if (effectiveType === 'custom') {
      if (!effectiveBaseUrl) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Base URL is required for custom providers');
      }
      url = buildOpenAICompatibleModelsUrl(effectiveBaseUrl);
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    } else if (effectiveType === 'gemini') {
      if (!apiKey) {
        throw new AppError(400, 'PROVIDER_ERROR', 'Provider API key is not configured. Please set it in Settings.');
      }
      url = effectiveBaseUrl
        ? buildGeminiModelsUrl(effectiveBaseUrl, apiKey)
        : `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      // Gemini uses query param for model listing; do not send Authorization header.
      delete headers['Content-Type'];
    } else {
      throw new AppError(400, 'VALIDATION_ERROR', `Unsupported provider type: ${effectiveType}`);
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: effectiveType === 'gemini' ? undefined : headers,
    });

    if (!response.ok) {
      const message = await parseErrorMessage(response);
      throw new AppError(response.status, 'PROVIDER_ERROR', message);
    }

    const data = (await response.json().catch(() => ({}))) as { models?: unknown[]; data?: unknown[] };

    if (effectiveType === 'gemini') {
      return (data.models || [])
        .map((m: unknown) => {
          const model = m as {
            name?: string;
            displayName?: string;
            inputTokenLimit?: number;
            input_token_limit?: number;
          };
          const id = model.name?.replace('models/', '') || model.name || '';
          const maxContextLength =
            typeof model.inputTokenLimit === 'number'
              ? model.inputTokenLimit
              : typeof model.input_token_limit === 'number'
                ? model.input_token_limit
                : undefined;
          return {
            id,
            name: model.displayName || id,
            owned_by: 'google',
            maxContextLength,
          };
        })
        .filter((m) => m.id && m.name);
    }

    return (data.data || [])
      .map((m: unknown) => {
        const model = m as { id?: string; owned_by?: string; context_length?: number; contextLength?: number };
        const maxContextLength =
          typeof model.context_length === 'number'
            ? model.context_length
            : typeof model.contextLength === 'number'
              ? model.contextLength
              : undefined;
        return {
          id: model.id || '',
          name: model.id || '',
          owned_by: model.owned_by,
          maxContextLength,
        };
      })
      .filter((m) => m.id);
  }
}

export const providersService = new ProvidersService();
