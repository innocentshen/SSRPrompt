import { tracesRepository } from '../repositories/traces.repository.js';
import { prisma } from '../config/database.js';
import { filesService } from './files.service.js';
function normalizeBase64(value) {
    const comma = value.indexOf(',');
    if (value.startsWith('data:') && comma !== -1) {
        return value.slice(comma + 1);
    }
    return value;
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
function isStoredAttachments(value) {
    if (!Array.isArray(value) || value.length === 0)
        return false;
    return value.every((item) => {
        if (!item || typeof item !== 'object')
            return false;
        const record = item;
        return typeof record.fileId === 'string' && typeof record.name === 'string' && typeof record.type === 'string';
    });
}
export class TracesService {
    /**
     * Get traces with pagination
     */
    async findPaginated(userId, query) {
        return tracesRepository.findPaginated(userId, {
            page: query.page,
            limit: query.limit,
            promptId: query.promptId,
            status: query.status,
            source: query.source,
        });
    }
    /**
     * Get trace by ID with full details
     */
    async findById(userId, id) {
        const trace = await tracesRepository.findById(userId, id);
        if (!trace)
            return null;
        const rawAttachments = trace.attachments;
        if (!rawAttachments || isStoredAttachments(rawAttachments) || !isLegacyBase64Attachments(rawAttachments)) {
            return trace;
        }
        const migrated = [];
        for (const attachment of rawAttachments) {
            const buffer = Buffer.from(normalizeBase64(attachment.base64), 'base64');
            const stored = await filesService.upload(userId, {
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
        const currentMetadata = trace.metadata && typeof trace.metadata === 'object'
            ? trace.metadata
            : {};
        await prisma.trace.update({
            where: { id: trace.id },
            data: {
                attachments: migrated,
                metadata: {
                    ...currentMetadata,
                    files: migrated.map((a) => ({ fileId: a.fileId, name: a.name, type: a.type, size: a.size })),
                },
            },
        });
        return tracesRepository.findById(userId, id);
    }
    /**
     * Create a new trace
     */
    async create(userId, data) {
        return tracesRepository.create(userId, {
            prompt: data.promptId ? { connect: { id: data.promptId } } : undefined,
            model: data.modelId ? { connect: { id: data.modelId } } : undefined,
            input: data.input,
            source: data.source ?? 'feature',
            output: data.output,
            tokensInput: data.tokensInput ?? 0,
            tokensOutput: data.tokensOutput ?? 0,
            latencyMs: data.latencyMs ?? 0,
            status: data.status ?? 'success',
            errorMessage: data.errorMessage,
            metadata: (data.metadata ?? {}),
            attachments: data.attachments,
            thinkingContent: data.thinkingContent,
            thinkingTimeMs: data.thinkingTimeMs,
        });
    }
    /**
     * Delete a trace
     */
    async delete(userId, id) {
        return tracesRepository.delete(userId, id);
    }
    /**
     * Delete traces by prompt ID
     */
    async deleteByPrompt(userId, promptId) {
        return tracesRepository.deleteByPrompt(userId, promptId);
    }
    /**
     * Get usage statistics
     */
    async getUsageStats(userId) {
        return tracesRepository.getUsageStats(userId);
    }
}
export const tracesService = new TracesService();
//# sourceMappingURL=traces.service.js.map