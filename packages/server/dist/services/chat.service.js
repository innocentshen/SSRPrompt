import { prisma } from '../config/database.js';
import { decrypt, isEncrypted } from '../utils/crypto.js';
import { AppError } from '@ssrprompt/shared';
function normalizeProviderErrorMessage(provider, status, message) {
    const normalized = message?.trim() || '';
    if (!normalized)
        return normalized;
    // OpenRouter returns this message when auth is missing/invalid (it also supports cookie auth for the web app).
    if (status === 401 && /cookie auth credentials/i.test(normalized)) {
        const label = provider.type === 'openrouter' ? 'OpenRouter' : provider.type;
        return `${label} authentication failed: API key is missing or invalid (cookie auth is not supported). Please configure the provider API key in Settings.`;
    }
    return normalized;
}
function normalizeTopP(value) {
    if (typeof value !== 'number' || Number.isNaN(value))
        return undefined;
    if (value < 0 || value > 1)
        return undefined;
    return value;
}
function normalizeBaseUrl(value) {
    return value.trim().replace(/\/+$/, '');
}
function normalizeGeminiBaseUrl(baseUrl) {
    const cleanBaseUrl = normalizeBaseUrl(baseUrl || 'https://generativelanguage.googleapis.com');
    if (cleanBaseUrl.endsWith('/v1beta/openai')) {
        return `${cleanBaseUrl.replace(/\/v1beta\/openai$/, '')}/v1beta`;
    }
    if (cleanBaseUrl.endsWith('/v1beta') || cleanBaseUrl.endsWith('/v1')) {
        return cleanBaseUrl;
    }
    return `${cleanBaseUrl}/v1beta`;
}
function normalizeGeminiModelId(modelId) {
    const trimmed = modelId.trim();
    if (!trimmed)
        return trimmed;
    return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed;
}
function buildGeminiApiUrl(provider, modelId, stream) {
    const baseUrl = normalizeGeminiBaseUrl(provider.baseUrl);
    const normalizedModelId = normalizeGeminiModelId(modelId);
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    const path = `/models/${encodeURIComponent(normalizedModelId)}:${action}`;
    return stream ? `${baseUrl}${path}?alt=sse` : `${baseUrl}${path}`;
}
function shouldRetryWithoutTopP(status, message, topP) {
    if (topP !== 0)
        return false;
    if (status < 400 || status >= 500)
        return false;
    const normalized = (message || '').toLowerCase();
    const mentionsTopP = normalized.includes('top_p') || normalized.includes('top p') || normalized.includes('topp');
    if (!mentionsTopP)
        return false;
    return (normalized.includes('(0, 1]') ||
        normalized.includes('must be in') ||
        normalized.includes('greater than 0') ||
        normalized.includes('> 0') ||
        normalized.includes('between 0 and 1'));
}
/**
 * Get model with decrypted API key
 */
export async function getModelWithProvider(userId, modelId) {
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
    }
    else if (!model.provider.enabled) {
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
        }
        catch {
            throw new AppError(400, 'PROVIDER_ERROR', 'Provider API key cannot be decrypted. Please re-enter the API key in Settings.');
        }
    }
    return { model, provider: model.provider, apiKey };
}
/**
 * Build provider-specific API URL
 */
export function buildApiUrl(provider, modelId, stream) {
    switch (provider.type) {
        case 'openai':
            if (provider.baseUrl) {
                return `${provider.baseUrl}/chat/completions`;
            }
            return 'https://api.openai.com/v1/chat/completions';
        case 'anthropic':
            if (provider.baseUrl) {
                return `${provider.baseUrl}/chat/completions`;
            }
            return 'https://api.anthropic.com/v1/messages';
        case 'gemini':
            if (!modelId) {
                throw new AppError(500, 'PROVIDER_ERROR', 'Gemini URL requires model id');
            }
            return buildGeminiApiUrl(provider, modelId, stream ?? true);
        case 'openrouter':
            if (provider.baseUrl) {
                return `${provider.baseUrl}/chat/completions`;
            }
            return 'https://openrouter.ai/api/v1/chat/completions';
        default:
            if (provider.baseUrl) {
                return `${provider.baseUrl}/chat/completions`;
            }
            throw new AppError(400, 'PROVIDER_ERROR', `Unknown provider type: ${provider.type}`);
    }
}
/**
 * Build request headers for provider
 */
export function buildHeaders(provider, apiKey) {
    const headers = {
        'Content-Type': 'application/json',
    };
    switch (provider.type) {
        case 'anthropic':
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
            break;
        case 'gemini':
            headers['x-goog-api-key'] = apiKey;
            break;
        default:
            headers['Authorization'] = `Bearer ${apiKey}`;
    }
    return headers;
}
/**
 * Transform messages for Anthropic format
 */
function transformForAnthropic(messages) {
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
function parseDataUrl(value) {
    const match = value.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/i);
    if (!match)
        return null;
    return {
        mimeType: match[1],
        data: match[2].replace(/\s/g, ''),
    };
}
function extractTextContent(content) {
    if (typeof content === 'string')
        return content;
    return content
        .filter((part) => part.type === 'text' && typeof part.text === 'string' && part.text.length > 0)
        .map((part) => part.text)
        .join('\n');
}
function toGeminiParts(content) {
    if (typeof content === 'string') {
        return content.length > 0 ? [{ text: content }] : [];
    }
    const parts = [];
    for (const part of content) {
        if (part.type === 'text' && part.text) {
            parts.push({ text: part.text });
            continue;
        }
        if (part.type === 'image_url' && part.image_url?.url) {
            const parsed = parseDataUrl(part.image_url.url);
            if (parsed) {
                parts.push({
                    inline_data: {
                        mime_type: parsed.mimeType,
                        data: parsed.data,
                    },
                });
            }
            else {
                parts.push({ text: part.image_url.url });
            }
            continue;
        }
        if (part.type === 'file' && part.file?.file_data) {
            const parsed = parseDataUrl(part.file.file_data);
            if (parsed) {
                parts.push({
                    inline_data: {
                        mime_type: parsed.mimeType,
                        data: parsed.data,
                    },
                });
            }
            else if (part.file.filename) {
                parts.push({ text: part.file.filename });
            }
        }
    }
    return parts;
}
function transformForGemini(messages) {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const systemText = systemMessages
        .map((m) => extractTextContent(m.content))
        .filter(Boolean)
        .join('\n\n');
    const contents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => {
        const role = m.role === 'assistant' ? 'model' : 'user';
        return {
            role,
            parts: toGeminiParts(m.content),
        };
    })
        .filter((m) => m.parts.length > 0);
    if (contents.length === 0) {
        contents.push({
            role: 'user',
            parts: [{ text: '' }],
        });
    }
    return {
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        contents,
    };
}
function extractGeminiResponseSchema(responseFormat) {
    if (!responseFormat || typeof responseFormat !== 'object')
        return undefined;
    const format = responseFormat;
    if (format.type !== 'json_schema')
        return undefined;
    if (!format.json_schema?.schema || typeof format.json_schema.schema !== 'object')
        return undefined;
    return format.json_schema.schema;
}
function buildGeminiGenerationConfig(modelId, options, topP) {
    const generationConfig = {};
    if (typeof options.temperature === 'number')
        generationConfig.temperature = options.temperature;
    if (typeof topP === 'number')
        generationConfig.topP = topP;
    if (typeof options.max_tokens === 'number')
        generationConfig.maxOutputTokens = options.max_tokens;
    if (typeof options.frequency_penalty === 'number')
        generationConfig.frequencyPenalty = options.frequency_penalty;
    if (typeof options.presence_penalty === 'number')
        generationConfig.presencePenalty = options.presence_penalty;
    const lowerModelId = modelId.toLowerCase();
    const isGemini3 = lowerModelId.includes('gemini-3');
    const isGemini3Flash = isGemini3 && lowerModelId.includes('flash');
    const isGemini3Pro31 = isGemini3 &&
        (lowerModelId.includes('3.1-pro') || lowerModelId.includes('3-1-pro') || lowerModelId.includes('3_1_pro'));
    const isGemini3Pro = isGemini3 && !isGemini3Pro31 && lowerModelId.includes('pro');
    // Product decision:
    // - Default effort => low (and include thoughts)
    // - none => keep model output but do not return thought text
    const requestedEffort = options.reasoning?.enabled === false
        ? 'none'
        : (options.reasoning?.effort ?? 'default');
    const effectiveEffort = requestedEffort === 'default' ? 'low' : requestedEffort;
    const includeThoughts = requestedEffort !== 'none';
    if (isGemini3) {
        let thinkingLevel;
        if (effectiveEffort === 'none') {
            thinkingLevel = isGemini3Flash ? 'minimal' : 'low';
        }
        else if (effectiveEffort === 'medium' && isGemini3Pro) {
            // Gemini 3 Pro does not support medium.
            thinkingLevel = 'low';
        }
        else if (effectiveEffort === 'low' || effectiveEffort === 'medium' || effectiveEffort === 'high') {
            thinkingLevel = effectiveEffort;
        }
        else {
            thinkingLevel = 'low';
        }
        generationConfig.thinkingConfig = {
            includeThoughts,
            thinkingLevel,
        };
    }
    else {
        const thinkingBudget = effectiveEffort === 'none'
            ? 0
            : effectiveEffort === 'low'
                ? 1024
                : effectiveEffort === 'medium'
                    ? 4096
                    : 8192;
        generationConfig.thinkingConfig = {
            includeThoughts,
            thinkingBudget,
        };
    }
    const responseSchema = extractGeminiResponseSchema(options.responseFormat);
    if (responseSchema) {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseJsonSchema = responseSchema;
    }
    return generationConfig;
}
/**
 * Build reasoning parameters for different providers
 */
function buildReasoningParams(provider, modelId, reasoning) {
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
        return {}; // Anthropic handles this differently
    }
    return {};
}
/**
 * Build request body for provider
 */
export function buildRequestBody(provider, model, messages, options) {
    const topP = normalizeTopP(options.top_p);
    if (provider.type === 'anthropic') {
        const { system, messages: transformedMessages } = transformForAnthropic(messages);
        return {
            model: model.modelId,
            messages: transformedMessages,
            system,
            max_tokens: options.max_tokens || 8000,
            temperature: options.temperature,
            top_p: topP,
            stream: options.stream ?? true,
        };
    }
    if (provider.type === 'gemini') {
        const { systemInstruction, contents } = transformForGemini(messages);
        const generationConfig = buildGeminiGenerationConfig(model.modelId, options, topP);
        return {
            contents,
            ...(systemInstruction ? { systemInstruction } : {}),
            ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
        };
    }
    // OpenAI-compatible format (OpenAI, OpenRouter, Custom)
    const body = {
        model: model.modelId,
        messages,
        temperature: options.temperature,
        top_p: topP,
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
function mapGeminiFinishReason(reason) {
    if (!reason)
        return null;
    switch (reason) {
        case 'STOP':
            return 'stop';
        case 'MAX_TOKENS':
            return 'length';
        case 'SAFETY':
            return 'content_filter';
        default:
            return reason.toLowerCase();
    }
}
function extractGeminiDelta(candidate) {
    const parts = candidate?.content?.parts || [];
    let content = '';
    let reasoning = '';
    for (const part of parts) {
        if (!part.text)
            continue;
        if (part.thought === true) {
            reasoning += part.text;
        }
        else {
            content += part.text;
        }
    }
    return {
        ...(content ? { content } : {}),
        ...(reasoning ? { reasoning } : {}),
    };
}
function extractGeminiUsage(parsed) {
    const usage = parsed.usageMetadata || parsed.usage_metadata;
    if (!usage)
        return undefined;
    const promptTokens = (parsed.usageMetadata?.promptTokenCount ?? parsed.usage_metadata?.prompt_token_count ?? 0);
    const completionTokens = (parsed.usageMetadata?.candidatesTokenCount ?? parsed.usage_metadata?.candidates_token_count ?? 0);
    const totalTokens = (parsed.usageMetadata?.totalTokenCount ?? parsed.usage_metadata?.total_token_count ?? (promptTokens + completionTokens));
    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
    };
}
/**
 * Parse SSE data from different providers
 */
export function parseSSEChunk(provider, data) {
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
        if (provider.type === 'gemini') {
            const gemini = parsed;
            const candidate = gemini.candidates?.[0];
            const delta = extractGeminiDelta(candidate);
            const finishReason = mapGeminiFinishReason(candidate?.finishReason || candidate?.finish_reason);
            const usage = extractGeminiUsage(gemini);
            if (!delta.content && !delta.reasoning && !finishReason && !usage) {
                return null;
            }
            return {
                id: gemini.responseId || '0',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: gemini.modelVersion || '',
                choices: [
                    {
                        index: 0,
                        delta,
                        finish_reason: finishReason,
                    },
                ],
                ...(usage ? { usage } : {}),
            };
        }
        // OpenAI-compatible format
        return parsed;
    }
    catch {
        return null;
    }
}
/**
 * Stream response from LLM provider
 */
export async function* streamChatCompletion(provider, model, apiKey, messages, options, signal) {
    const url = buildApiUrl(provider, model.modelId, true);
    const headers = buildHeaders(provider, apiKey);
    const request = async (omitTopP = false) => {
        const requestOptions = omitTopP
            ? { ...options, top_p: undefined, stream: true }
            : { ...options, stream: true };
        const body = buildRequestBody(provider, model, messages, requestOptions);
        return fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
        });
    };
    let response = await request();
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const rawMessage = errorData.error?.message || `Provider API error: ${response.statusText}`;
        const message = normalizeProviderErrorMessage(provider, response.status, rawMessage);
        if (shouldRetryWithoutTopP(response.status, message, options.top_p)) {
            response = await request(true);
            if (!response.ok) {
                const retryErrorData = await response.json().catch(() => ({}));
                const retryRawMessage = retryErrorData.error?.message || `Provider API error: ${response.statusText}`;
                const retryMessage = normalizeProviderErrorMessage(provider, response.status, retryRawMessage);
                throw new AppError(response.status, 'PROVIDER_ERROR', retryMessage, retryErrorData);
            }
        }
        else {
            throw new AppError(response.status, 'PROVIDER_ERROR', message, errorData);
        }
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
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(':'))
                    continue;
                if (trimmed.startsWith('data: ')) {
                    const data = trimmed.slice(6);
                    const chunk = parseSSEChunk(provider, data);
                    if (chunk) {
                        yield chunk;
                    }
                }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
/**
 * Non-streaming chat completion
 */
export async function chatCompletion(provider, model, apiKey, messages, options, signal) {
    const url = buildApiUrl(provider, model.modelId, false);
    const headers = buildHeaders(provider, apiKey);
    const request = async (omitTopP = false) => {
        const requestOptions = omitTopP
            ? { ...options, top_p: undefined, stream: false }
            : { ...options, stream: false };
        const body = buildRequestBody(provider, model, messages, requestOptions);
        return fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
        });
    };
    let response = await request();
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const rawMessage = errorData.error?.message || `Provider API error: ${response.statusText}`;
        const message = normalizeProviderErrorMessage(provider, response.status, rawMessage);
        if (shouldRetryWithoutTopP(response.status, message, options.top_p)) {
            response = await request(true);
            if (!response.ok) {
                const retryErrorData = await response.json().catch(() => ({}));
                const retryRawMessage = retryErrorData.error?.message || `Provider API error: ${response.statusText}`;
                const retryMessage = normalizeProviderErrorMessage(provider, response.status, retryRawMessage);
                throw new AppError(response.status, 'PROVIDER_ERROR', retryMessage, retryErrorData);
            }
        }
        else {
            throw new AppError(response.status, 'PROVIDER_ERROR', message, errorData);
        }
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
    if (provider.type === 'gemini') {
        const parsed = data;
        const delta = extractGeminiDelta(parsed.candidates?.[0]);
        const usage = extractGeminiUsage(parsed) || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        return {
            content: delta.content || '',
            ...(delta.reasoning ? { thinking: delta.reasoning } : {}),
            usage,
        };
    }
    // OpenAI-compatible format
    return {
        content: data.choices?.[0]?.message?.content || '',
        usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
}
//# sourceMappingURL=chat.service.js.map