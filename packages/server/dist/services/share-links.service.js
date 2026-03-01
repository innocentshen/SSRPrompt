import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { AppError, } from '@ssrprompt/shared';
import { prisma } from '../config/database.js';
import { promptsRepository, promptVersionsRepository } from '../repositories/prompts.repository.js';
import { evaluationsRepository } from '../repositories/evaluations.repository.js';
import { filesService } from './files.service.js';
import { evaluationsService } from './evaluations.service.js';
import { transformResponse } from '../utils/transform.js';
const PASSWORD_HASH_ROUNDS = 12;
const PASSWORD_GRANT_TTL_DAYS = 30;
function generateShareToken() {
    return randomBytes(24).toString('base64url');
}
function toDateOrNull(value) {
    if (!value)
        return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid datetime format');
    }
    return date;
}
function ensureFutureDate(date) {
    if (!date)
        return;
    if (date.getTime() <= Date.now()) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Expiry must be in the future');
    }
}
function mapShareLink(link) {
    return {
        id: link.id,
        userId: link.userId,
        resourceType: link.resourceType === 'prompt' ? 'prompt' : 'evaluation',
        resourceId: link.resourceId,
        token: link.token,
        hasPassword: !!link.passwordHash,
        allowCopy: link.allowCopy,
        expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
        revokedAt: link.revokedAt ? link.revokedAt.toISOString() : null,
        accessCount: link.accessCount,
        lastAccessedAt: link.lastAccessedAt ? link.lastAccessedAt.toISOString() : null,
        createdAt: link.createdAt.toISOString(),
        updatedAt: link.updatedAt.toISOString(),
        resourceName: link.resourceName ?? null,
    };
}
function mapShareAccessLog(log) {
    return {
        id: log.id,
        shareLinkId: log.shareLinkId,
        accessorUserId: log.accessorUserId,
        action: log.action,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt.toISOString(),
    };
}
function isStoredAttachments(value) {
    if (!Array.isArray(value) || value.length === 0)
        return false;
    return value.every((item) => {
        if (!item || typeof item !== 'object')
            return false;
        const record = item;
        return (typeof record.fileId === 'string' &&
            typeof record.name === 'string' &&
            typeof record.type === 'string');
    });
}
function isLegacyBase64Attachments(value) {
    if (!Array.isArray(value) || value.length === 0)
        return false;
    return value.every((item) => {
        if (!item || typeof item !== 'object')
            return false;
        const record = item;
        return (typeof record.name === 'string' &&
            typeof record.type === 'string' &&
            typeof record.base64 === 'string' &&
            record.base64.length > 0);
    });
}
function normalizeBase64(value) {
    const commaIndex = value.indexOf(',');
    if (value.startsWith('data:') && commaIndex !== -1) {
        return value.slice(commaIndex + 1);
    }
    return value;
}
async function materializeAttachmentsForUser(fromUserId, toUserId, rawAttachments) {
    if (!rawAttachments || !Array.isArray(rawAttachments) || rawAttachments.length === 0)
        return [];
    if (isStoredAttachments(rawAttachments)) {
        if (fromUserId === toUserId)
            return rawAttachments;
        const cloned = await Promise.all(rawAttachments.map(async (attachment) => {
            try {
                const { meta, buffer } = await filesService.downloadBuffer(fromUserId, attachment.fileId);
                const stored = await filesService.upload(toUserId, {
                    originalName: attachment.name || meta.originalName,
                    mimeType: attachment.type || meta.mimeType,
                    size: buffer.length,
                    buffer,
                });
                return {
                    fileId: stored.id,
                    name: stored.originalName,
                    type: stored.mimeType,
                    size: stored.size,
                };
            }
            catch {
                return null;
            }
        }));
        return cloned.filter((item) => item !== null);
    }
    if (isLegacyBase64Attachments(rawAttachments)) {
        const migrated = [];
        for (const attachment of rawAttachments) {
            const buffer = Buffer.from(normalizeBase64(attachment.base64), 'base64');
            const stored = await filesService.upload(toUserId, {
                originalName: attachment.name,
                mimeType: attachment.type,
                size: buffer.length,
                buffer,
            });
            migrated.push({
                fileId: stored.id,
                name: stored.originalName,
                type: stored.mimeType,
                size: stored.size,
            });
        }
        return migrated;
    }
    return [];
}
function toPublicModelInfo(model) {
    if (!model)
        return null;
    return {
        providerType: model.provider.type,
        modelId: model.modelId,
        name: model.name,
    };
}
export class ShareLinksService {
    async assertShareResourceOwner(userId, resourceType, resourceId) {
        if (resourceType === 'prompt') {
            const prompt = await prisma.prompt.findFirst({
                where: { id: resourceId, userId },
                select: { id: true },
            });
            if (!prompt)
                throw new AppError(404, 'NOT_FOUND', 'Prompt not found');
            return;
        }
        const evaluation = await prisma.evaluation.findFirst({
            where: { id: resourceId, userId },
            select: { id: true },
        });
        if (!evaluation)
            throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
    }
    async resolveResourceName(userId, resourceType, resourceId) {
        if (resourceType === 'prompt') {
            const prompt = await prisma.prompt.findFirst({
                where: { id: resourceId, userId },
                select: { name: true },
            });
            return prompt?.name ?? null;
        }
        const evaluation = await prisma.evaluation.findFirst({
            where: { id: resourceId, userId },
            select: { name: true },
        });
        return evaluation?.name ?? null;
    }
    async loadLinkByToken(token, expectedType) {
        const link = await prisma.shareLink.findUnique({ where: { token } });
        if (!link) {
            throw new AppError(404, 'NOT_FOUND', 'Share link not found');
        }
        if (expectedType && link.resourceType !== expectedType) {
            throw new AppError(404, 'NOT_FOUND', 'Share link not found');
        }
        if (link.revokedAt) {
            throw new AppError(410, 'SHARE_LINK_REVOKED', 'This share link has been revoked');
        }
        if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
            throw new AppError(410, 'SHARE_LINK_EXPIRED', 'This share link has expired');
        }
        return link;
    }
    async assertPasswordGranted(link, userId) {
        if (!link.passwordHash)
            return;
        const grant = await prisma.shareLinkPasswordGrant.findUnique({
            where: {
                shareLinkId_userId: {
                    shareLinkId: link.id,
                    userId,
                },
            },
            select: { id: true, expiresAt: true },
        });
        if (!grant) {
            throw new AppError(401, 'SHARE_PASSWORD_REQUIRED', 'Password is required');
        }
        if (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) {
            await prisma.shareLinkPasswordGrant.delete({ where: { id: grant.id } }).catch(() => undefined);
            throw new AppError(401, 'SHARE_PASSWORD_REQUIRED', 'Password is required');
        }
    }
    async recordAccess(linkId, action, accessorUserId, context) {
        const isCounted = action === 'view' || action === 'copy' || action === 'download_attachment';
        await prisma.$transaction([
            prisma.shareLinkAccessLog.create({
                data: {
                    shareLinkId: linkId,
                    accessorUserId,
                    action: action,
                    ipAddress: context.ipAddress,
                    userAgent: context.userAgent,
                },
            }),
            ...(isCounted
                ? [
                    prisma.shareLink.update({
                        where: { id: linkId },
                        data: {
                            accessCount: { increment: 1 },
                            lastAccessedAt: new Date(),
                        },
                    }),
                ]
                : []),
        ]);
    }
    async create(userId, input) {
        const resourceType = input.resourceType;
        await this.assertShareResourceOwner(userId, resourceType, input.resourceId);
        const expiresAt = input.expiresAt !== undefined ? toDateOrNull(input.expiresAt) : undefined;
        ensureFutureDate(expiresAt);
        const passwordHash = input.password !== undefined
            ? input.password && input.password.trim().length > 0
                ? await bcrypt.hash(input.password.trim(), PASSWORD_HASH_ROUNDS)
                : null
            : undefined;
        const existing = await prisma.shareLink.findFirst({
            where: {
                userId,
                resourceType,
                resourceId: input.resourceId,
                revokedAt: null,
            },
            orderBy: { createdAt: 'desc' },
        });
        let shareLink;
        if (existing) {
            shareLink = await prisma.shareLink.update({
                where: { id: existing.id },
                data: {
                    ...(input.allowCopy !== undefined ? { allowCopy: input.allowCopy } : {}),
                    ...(expiresAt !== undefined ? { expiresAt } : {}),
                    ...(passwordHash !== undefined ? { passwordHash } : {}),
                },
            });
            if (passwordHash !== undefined) {
                await prisma.shareLinkPasswordGrant.deleteMany({ where: { shareLinkId: existing.id } });
            }
        }
        else {
            shareLink = await prisma.shareLink.create({
                data: {
                    userId,
                    resourceType,
                    resourceId: input.resourceId,
                    token: generateShareToken(),
                    passwordHash: passwordHash ?? null,
                    allowCopy: input.allowCopy ?? true,
                    expiresAt: expiresAt ?? null,
                },
            });
        }
        const resourceName = await this.resolveResourceName(userId, resourceType, input.resourceId);
        return mapShareLink({ ...shareLink, resourceName });
    }
    async list(userId, query) {
        const page = query.page || 1;
        const limit = query.pageSize || 20;
        const skip = (page - 1) * limit;
        const where = {
            userId,
            ...(query.resourceType ? { resourceType: query.resourceType } : {}),
            ...(query.includeRevoked ? {} : { revokedAt: null }),
        };
        const [total, links] = await Promise.all([
            prisma.shareLink.count({ where }),
            prisma.shareLink.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
        ]);
        const promptIds = links
            .filter((link) => link.resourceType === 'prompt')
            .map((link) => link.resourceId);
        const evaluationIds = links
            .filter((link) => link.resourceType === 'evaluation')
            .map((link) => link.resourceId);
        const [promptRows, evaluationRows] = await Promise.all([
            promptIds.length > 0
                ? prisma.prompt.findMany({
                    where: { id: { in: promptIds }, userId },
                    select: { id: true, name: true },
                })
                : Promise.resolve([]),
            evaluationIds.length > 0
                ? prisma.evaluation.findMany({
                    where: { id: { in: evaluationIds }, userId },
                    select: { id: true, name: true },
                })
                : Promise.resolve([]),
        ]);
        const names = new Map();
        for (const prompt of promptRows) {
            names.set(prompt.id, prompt.name);
        }
        for (const evaluation of evaluationRows) {
            names.set(evaluation.id, evaluation.name);
        }
        const data = links.map((link) => mapShareLink({
            ...link,
            resourceName: names.get(link.resourceId) ?? null,
        }));
        return {
            data,
            total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        };
    }
    async update(userId, shareLinkId, input) {
        const link = await prisma.shareLink.findFirst({
            where: { id: shareLinkId, userId },
        });
        if (!link)
            throw new AppError(404, 'NOT_FOUND', 'Share link not found');
        const expiresAt = input.expiresAt !== undefined ? toDateOrNull(input.expiresAt) : undefined;
        ensureFutureDate(expiresAt ?? null);
        let passwordHashUpdate;
        if (input.clearPassword) {
            passwordHashUpdate = null;
        }
        else if (input.password !== undefined) {
            const trimmed = input.password?.trim() || '';
            passwordHashUpdate = trimmed.length > 0 ? await bcrypt.hash(trimmed, PASSWORD_HASH_ROUNDS) : null;
        }
        const updated = await prisma.shareLink.update({
            where: { id: shareLinkId },
            data: {
                ...(expiresAt !== undefined ? { expiresAt } : {}),
                ...(input.allowCopy !== undefined ? { allowCopy: input.allowCopy } : {}),
                ...(passwordHashUpdate !== undefined ? { passwordHash: passwordHashUpdate } : {}),
            },
        });
        if (passwordHashUpdate !== undefined) {
            await prisma.shareLinkPasswordGrant.deleteMany({ where: { shareLinkId } });
        }
        const resourceName = await this.resolveResourceName(updated.userId, updated.resourceType, updated.resourceId);
        return mapShareLink({ ...updated, resourceName });
    }
    async revoke(userId, shareLinkId) {
        const link = await prisma.shareLink.findFirst({
            where: { id: shareLinkId, userId },
        });
        if (!link)
            throw new AppError(404, 'NOT_FOUND', 'Share link not found');
        const updated = await prisma.shareLink.update({
            where: { id: shareLinkId },
            data: { revokedAt: new Date() },
        });
        await prisma.shareLinkPasswordGrant.deleteMany({ where: { shareLinkId } });
        const resourceName = await this.resolveResourceName(updated.userId, updated.resourceType, updated.resourceId);
        return mapShareLink({ ...updated, resourceName });
    }
    async listAccessLogs(userId, shareLinkId, page = 1, limit = 20) {
        const link = await prisma.shareLink.findFirst({
            where: { id: shareLinkId, userId },
            select: { id: true },
        });
        if (!link)
            throw new AppError(404, 'NOT_FOUND', 'Share link not found');
        const skip = (page - 1) * limit;
        const [total, logs] = await Promise.all([
            prisma.shareLinkAccessLog.count({ where: { shareLinkId } }),
            prisma.shareLinkAccessLog.findMany({
                where: { shareLinkId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
        ]);
        return {
            data: logs.map(mapShareAccessLog),
            total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        };
    }
    async verifyPassword(userId, token, password, context) {
        const link = await this.loadLinkByToken(token);
        if (!link.passwordHash) {
            return;
        }
        const ok = await bcrypt.compare(password, link.passwordHash);
        if (!ok) {
            await this.recordAccess(link.id, 'password_failure', userId, context);
            throw new AppError(401, 'SHARE_PASSWORD_INVALID', 'Invalid share password');
        }
        const now = new Date();
        const expiresAt = new Date(now);
        expiresAt.setDate(expiresAt.getDate() + PASSWORD_GRANT_TTL_DAYS);
        const finalExpiresAt = link.expiresAt && link.expiresAt.getTime() < expiresAt.getTime() ? link.expiresAt : expiresAt;
        await prisma.shareLinkPasswordGrant.upsert({
            where: {
                shareLinkId_userId: {
                    shareLinkId: link.id,
                    userId,
                },
            },
            update: {
                grantedAt: now,
                expiresAt: finalExpiresAt,
            },
            create: {
                shareLinkId: link.id,
                userId,
                grantedAt: now,
                expiresAt: finalExpiresAt,
            },
        });
        await this.recordAccess(link.id, 'password_success', userId, context);
    }
    async getSharedPrompt(userId, token, context) {
        const link = await this.loadLinkByToken(token, 'prompt');
        await this.assertPasswordGranted(link, userId);
        const prompt = await prisma.prompt.findFirst({
            where: { id: link.resourceId, userId: link.userId },
            select: {
                id: true,
                name: true,
                description: true,
                content: true,
                variables: true,
                messages: true,
                config: true,
                currentVersion: true,
                updatedAt: true,
                user: { select: { id: true, name: true, avatar: true } },
                defaultModel: {
                    select: {
                        name: true,
                        modelId: true,
                        provider: { select: { type: true } },
                    },
                },
            },
        });
        if (!prompt) {
            throw new AppError(404, 'NOT_FOUND', 'Prompt not found');
        }
        await this.recordAccess(link.id, 'view', userId, context);
        const promptContent = {
            id: prompt.id,
            name: prompt.name,
            description: prompt.description,
            content: prompt.content,
            variables: (prompt.variables ?? []),
            messages: (prompt.messages ?? []),
            config: (prompt.config ?? {}),
            currentVersion: prompt.currentVersion,
            defaultModel: toPublicModelInfo(prompt.defaultModel),
            author: {
                id: prompt.user.id,
                name: prompt.user.name,
                avatar: prompt.user.avatar,
            },
            updatedAt: prompt.updatedAt.toISOString(),
        };
        return {
            shareLink: mapShareLink(link),
            prompt: promptContent,
            canCopy: link.allowCopy,
        };
    }
    async getSharedEvaluation(userId, token, context) {
        const link = await this.loadLinkByToken(token, 'evaluation');
        await this.assertPasswordGranted(link, userId);
        const rawEvaluation = await evaluationsService.findById(link.userId, link.resourceId);
        if (!rawEvaluation) {
            throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
        }
        await this.recordAccess(link.id, 'view', userId, context);
        const evaluation = rawEvaluation;
        const content = {
            id: evaluation.id,
            name: evaluation.name,
            status: evaluation.status,
            config: evaluation.config,
            prompt: evaluation.prompt ?? null,
            model: toPublicModelInfo(evaluation.model ?? null),
            judgeModel: toPublicModelInfo(evaluation.judgeModel ?? null),
            testCases: evaluation.testCases ?? [],
            criteria: evaluation.criteria ?? [],
            createdAt: evaluation.createdAt,
            completedAt: evaluation.completedAt ?? null,
        };
        return {
            shareLink: mapShareLink(link),
            evaluation: content,
            canCopy: link.allowCopy,
        };
    }
    async copySharedPrompt(userId, token, name, context) {
        const link = await this.loadLinkByToken(token, 'prompt');
        await this.assertPasswordGranted(link, userId);
        if (!link.allowCopy) {
            throw new AppError(403, 'FORBIDDEN', 'Copy is disabled for this share link');
        }
        const source = await prisma.prompt.findFirst({
            where: { id: link.resourceId, userId: link.userId },
            select: {
                id: true,
                name: true,
                description: true,
                content: true,
                variables: true,
                messages: true,
                config: true,
            },
        });
        if (!source) {
            throw new AppError(404, 'NOT_FOUND', 'Prompt not found');
        }
        const copied = await promptsRepository.create(userId, {
            name: name?.trim() || `${source.name} (Copy)`,
            description: source.description,
            content: source.content,
            variables: source.variables ?? [],
            messages: source.messages ?? [],
            config: source.config ?? {},
            defaultModel: undefined,
            isPublic: false,
        });
        await promptVersionsRepository.createVersion(copied.id, 1, {
            content: source.content ?? '',
            commitMessage: `Copied from share link ${link.id}`,
            variables: source.variables ?? [],
            messages: source.messages ?? [],
            config: source.config ?? {},
            defaultModelId: null,
            isPublic: false,
            publishedAt: null,
        });
        if (context) {
            await this.recordAccess(link.id, 'copy', userId, context);
        }
        return copied;
    }
    async copySharedEvaluation(userId, token, name, context) {
        const link = await this.loadLinkByToken(token, 'evaluation');
        await this.assertPasswordGranted(link, userId);
        if (!link.allowCopy) {
            throw new AppError(403, 'FORBIDDEN', 'Copy is disabled for this share link');
        }
        const source = await prisma.evaluation.findFirst({
            where: { id: link.resourceId, userId: link.userId },
            include: {
                testCases: { orderBy: { orderIndex: 'asc' } },
                criteria: { orderBy: { createdAt: 'asc' } },
            },
        });
        if (!source) {
            throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
        }
        const sourceConfig = source.config && typeof source.config === 'object' && !Array.isArray(source.config)
            ? source.config
            : {};
        const copiedConfig = {
            ...sourceConfig,
            inherited_from_prompt: false,
        };
        const copiedTestCases = await Promise.all((source.testCases ?? []).map(async (testCase) => {
            const attachments = await materializeAttachmentsForUser(source.userId, userId, testCase.attachments);
            return {
                name: testCase.name,
                inputText: testCase.inputText,
                inputVariables: (testCase.inputVariables ?? {}),
                attachments: attachments,
                expectedOutput: testCase.expectedOutput,
                notes: testCase.notes,
                orderIndex: testCase.orderIndex,
            };
        }));
        const copiedCriteria = (source.criteria ?? []).map((criterion) => ({
            name: criterion.name,
            description: criterion.description ?? undefined,
            prompt: criterion.prompt ?? undefined,
            weight: criterion.weight,
            enabled: criterion.enabled,
        }));
        const copied = await evaluationsRepository.createWithRelations(userId, {
            name: name?.trim() || `${source.name} (Copy)`,
            config: copiedConfig,
            results: {},
            status: 'pending',
            isPublic: false,
            shareAttachments: false,
        }, copiedTestCases, copiedCriteria);
        if (context) {
            await this.recordAccess(link.id, 'copy', userId, context);
        }
        return transformResponse(copied);
    }
    async downloadSharedEvaluationAttachment(userId, token, fileId, range, context) {
        const link = await this.loadLinkByToken(token, 'evaluation');
        await this.assertPasswordGranted(link, userId);
        const evaluation = await prisma.evaluation.findFirst({
            where: { id: link.resourceId, userId: link.userId },
            select: {
                id: true,
                userId: true,
                testCases: {
                    select: { attachments: true },
                },
            },
        });
        if (!evaluation) {
            throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
        }
        const allowedFileIds = new Set();
        for (const testCase of evaluation.testCases) {
            const rawAttachments = testCase.attachments;
            if (!isStoredAttachments(rawAttachments))
                continue;
            for (const attachment of rawAttachments) {
                allowedFileIds.add(attachment.fileId);
            }
        }
        if (!allowedFileIds.has(fileId)) {
            throw new AppError(404, 'NOT_FOUND', 'File not found');
        }
        await this.recordAccess(link.id, 'download_attachment', userId, context);
        return filesService.download(evaluation.userId, fileId, range);
    }
}
export const shareLinksService = new ShareLinksService();
//# sourceMappingURL=share-links.service.js.map