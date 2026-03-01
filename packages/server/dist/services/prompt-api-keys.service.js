import { createHash, randomBytes } from 'crypto';
import { AppError, } from '@ssrprompt/shared';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
const API_KEY_PREFIX = 'spk_';
const API_KEY_PREFIX_VISIBLE_LENGTH = 12;
function toDateOrNull(value) {
    if (!value)
        return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid datetime format');
    }
    return parsed;
}
function ensureFutureDate(date) {
    if (!date)
        return;
    if (date.getTime() <= Date.now()) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Expiry must be in the future');
    }
}
function hashPromptApiKey(apiKey) {
    return createHash('sha256')
        .update(`${env.JWT_SECRET}:${apiKey.trim()}`)
        .digest('hex');
}
function generatePromptApiKeyPlain() {
    return `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
}
function mapPromptApiKey(row) {
    return {
        id: row.id,
        userId: row.userId,
        name: row.name,
        keyPrefix: row.keyPrefix,
        keyLast4: row.keyLast4,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
        revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
export class PromptApiKeysService {
    async list(userId) {
        const rows = await prisma.promptApiKey.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map(mapPromptApiKey);
    }
    async create(userId, input) {
        const name = input.name.trim();
        if (!name) {
            throw new AppError(400, 'VALIDATION_ERROR', 'Name is required');
        }
        const expiresAt = toDateOrNull(input.expiresAt ?? null);
        ensureFutureDate(expiresAt);
        for (let attempt = 0; attempt < 3; attempt++) {
            const apiKey = generatePromptApiKeyPlain();
            const keyHash = hashPromptApiKey(apiKey);
            const keyPrefix = apiKey.slice(0, API_KEY_PREFIX_VISIBLE_LENGTH);
            const keyLast4 = apiKey.slice(-4);
            try {
                const created = await prisma.promptApiKey.create({
                    data: {
                        userId,
                        name,
                        keyHash,
                        keyPrefix,
                        keyLast4,
                        expiresAt,
                    },
                });
                return {
                    key: mapPromptApiKey(created),
                    apiKey,
                };
            }
            catch (error) {
                const maybeCode = error.code;
                if (maybeCode === 'P2002') {
                    continue;
                }
                throw error;
            }
        }
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to generate unique API key');
    }
    async revoke(userId, id) {
        const existing = await prisma.promptApiKey.findFirst({
            where: { id, userId },
        });
        if (!existing) {
            throw new AppError(404, 'NOT_FOUND', 'Prompt API key not found');
        }
        const revoked = await prisma.promptApiKey.update({
            where: { id },
            data: {
                revokedAt: existing.revokedAt ?? new Date(),
            },
        });
        return mapPromptApiKey(revoked);
    }
    async authenticate(apiKeyRaw) {
        const apiKey = apiKeyRaw.trim();
        if (!apiKey) {
            throw new AppError(401, 'UNAUTHORIZED', 'Invalid API key');
        }
        const keyHash = hashPromptApiKey(apiKey);
        const row = await prisma.promptApiKey.findUnique({
            where: { keyHash },
        });
        if (!row) {
            throw new AppError(401, 'UNAUTHORIZED', 'Invalid API key');
        }
        if (row.revokedAt) {
            throw new AppError(401, 'UNAUTHORIZED', 'API key revoked');
        }
        if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
            throw new AppError(401, 'UNAUTHORIZED', 'API key expired');
        }
        await prisma.promptApiKey
            .update({
            where: { id: row.id },
            data: { lastUsedAt: new Date() },
        })
            .catch((error) => {
            console.error('Failed to update prompt API key last_used_at:', error);
        });
        return {
            keyId: row.id,
            userId: row.userId,
        };
    }
}
export const promptApiKeysService = new PromptApiKeysService();
//# sourceMappingURL=prompt-api-keys.service.js.map