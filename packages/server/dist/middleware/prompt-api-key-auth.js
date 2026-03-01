import { UnauthorizedError } from '@ssrprompt/shared';
import { promptApiKeysService } from '../services/prompt-api-keys.service.js';
function firstHeaderValue(value) {
    if (!value)
        return null;
    if (Array.isArray(value)) {
        const first = value.find((item) => item && item.trim().length > 0);
        return first ? first.trim() : null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function extractApiKey(req) {
    const apiKeyHeader = firstHeaderValue(req.headers['x-api-key']);
    if (apiKeyHeader)
        return apiKeyHeader;
    const authHeader = firstHeaderValue(req.headers.authorization);
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        if (token.length > 0)
            return token;
    }
    return null;
}
export async function authenticatePromptApiKey(req, _res, next) {
    const apiKey = extractApiKey(req);
    if (!apiKey) {
        return next(new UnauthorizedError('Missing API key'));
    }
    try {
        const auth = await promptApiKeysService.authenticate(apiKey);
        req.promptApiKeyId = auth.keyId;
        req.user = {
            userId: auth.userId,
            tenantType: 'personal',
            isDemo: false,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
        };
        return next();
    }
    catch (error) {
        return next(error);
    }
}
//# sourceMappingURL=prompt-api-key-auth.js.map