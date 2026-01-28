import { Provider } from '@prisma/client';
import { prisma } from '../config/database.js';
import { providersRepository } from '../repositories/index.js';
import { CreateProviderInput, UpdateProviderInput, TestConnectionInput, DiscoverProviderModelsInput, AppError, ForbiddenError } from '@ssrprompt/shared';

interface DiscoveredModel {
  id: string;
  name: string;
  owned_by?: string;
  maxContextLength?: number;
}

const SYSTEM_USER_ID = 'default';
const SYSTEM_USER_EMAIL = 'default@system.local';

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
  private async ensureSystemUserExists() {
    await prisma.user.upsert({
      where: { id: SYSTEM_USER_ID },
      update: {
        email: SYSTEM_USER_EMAIL,
        name: 'System',
        status: 'active',
        emailVerified: true,
      },
      create: {
        id: SYSTEM_USER_ID,
        email: SYSTEM_USER_EMAIL,
        name: 'System',
        status: 'active',
        emailVerified: true,
      },
    });
  }

  /**
   * Get all providers for a user
   */
  async findAll(userId: string): Promise<Provider[]> {
    const providers = await providersRepository.findAll(userId);

    const systemProviderIds = providers.filter((p) => p.isSystem).map((p) => p.id);
    if (systemProviderIds.length === 0) return providers;

    const settings = await prisma.userProviderSetting.findMany({
      where: { userId, providerId: { in: systemProviderIds } },
      select: { providerId: true, enabled: true },
    });

    const enabledByProviderId = new Map(settings.map((s) => [s.providerId, s.enabled]));

    // For system providers, `provider.enabled` is the global master switch; user settings can only disable/enable per user.
    return providers.map((p) => {
      if (!p.isSystem) return p;
      const userEnabled = enabledByProviderId.get(p.id);
      const effectiveEnabled = p.enabled && (userEnabled ?? true);
      return { ...p, enabled: effectiveEnabled };
    });
  }

  /**
   * Get provider by ID
   */
  async findById(userId: string, id: string): Promise<Provider | null> {
    const provider = await providersRepository.findById(userId, id);
    if (!provider) return null;
    if (!provider.isSystem) return provider;
    if (!provider.enabled) return provider;

    const setting = await prisma.userProviderSetting.findUnique({
      where: { userId_providerId: { userId, providerId: provider.id } },
      select: { enabled: true },
    });

    return { ...provider, enabled: provider.enabled && (setting?.enabled ?? true) };
  }

  /**
   * Get provider with models
   */
  async findWithModels(userId: string, id: string) {
    const provider = await providersRepository.findWithModels(userId, id);
    if (!provider) return null;

    if (!provider.isSystem) return provider;
    if (!provider.enabled) return provider;

    const setting = await prisma.userProviderSetting.findUnique({
      where: { userId_providerId: { userId, providerId: provider.id } },
      select: { enabled: true },
    });

    return { ...provider, enabled: provider.enabled && (setting?.enabled ?? true) };
  }

  /**
   * Create a new provider
   */
  async create(userId: string, data: CreateProviderInput, isAdmin: boolean = false): Promise<Provider> {
    if ((data.isSystem ?? false) && isAdmin) {
      await this.ensureSystemUserExists();
    }

    return providersRepository.create(
      userId,
      {
        name: data.name,
        type: data.type,
        apiKey: data.apiKey,
        baseUrl: data.baseUrl,
        enabled: data.enabled ?? false,
        isSystem: data.isSystem ?? false,
      },
      isAdmin
    );
  }

  /**
   * Update a provider
   */
  async update(userId: string, id: string, data: UpdateProviderInput, isAdmin: boolean = false): Promise<Provider> {
    const provider = await providersRepository.findById(userId, id);
    if (!provider) {
      throw new AppError(404, 'NOT_FOUND', 'Provider not found');
    }

    // For system providers, non-admin users can only toggle enabled/disabled for themselves.
    if (provider.isSystem && !isAdmin) {
      const nameChanged = typeof data.name !== 'undefined' && data.name !== provider.name;
      const typeChanged = typeof data.type !== 'undefined' && data.type !== provider.type;
      const baseUrlChanged =
        typeof data.baseUrl !== 'undefined' && (data.baseUrl ?? null) !== (provider.baseUrl ?? null);
      const apiKeyChanging = typeof data.apiKey !== 'undefined';
      const systemFlagChanging = typeof data.isSystem !== 'undefined';

      const hasOtherChanges = nameChanged || typeChanged || baseUrlChanged || apiKeyChanging || systemFlagChanging;

      if (hasOtherChanges) {
        throw new ForbiddenError('Only administrators can modify system provider configuration');
      }

      // If enabled isn't provided, treat as no-op (keep existing effective state).
      if (typeof data.enabled !== 'boolean') {
        const setting = await prisma.userProviderSetting.findUnique({
          where: { userId_providerId: { userId, providerId: provider.id } },
          select: { enabled: true },
        });
        const effectiveEnabled = provider.enabled && (setting?.enabled ?? true);
        return { ...provider, enabled: effectiveEnabled };
      }

      await prisma.userProviderSetting.upsert({
        where: { userId_providerId: { userId, providerId: provider.id } },
        update: { enabled: data.enabled },
        create: { userId, providerId: provider.id, enabled: data.enabled },
      });

      return { ...provider, enabled: provider.enabled && data.enabled };
    }

    if (isAdmin && typeof data.isSystem === 'boolean' && data.isSystem !== provider.isSystem) {
      if (data.isSystem) {
        await this.ensureSystemUserExists();
      }

      return providersRepository.update(
        userId,
        id,
        {
          ...data,
          user: { connect: { id: data.isSystem ? SYSTEM_USER_ID : userId } },
        },
        isAdmin
      );
    }

    return providersRepository.update(userId, id, data, isAdmin);
  }

  /**
   * Delete a provider and all its models
   */
  async delete(userId: string, id: string, isAdmin: boolean = false): Promise<Provider> {
    // Models are deleted automatically via Prisma cascade
    return providersRepository.delete(userId, id, isAdmin);
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
