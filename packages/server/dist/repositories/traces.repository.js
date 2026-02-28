import { TenantRepository } from './base.repository.js';
import { prisma } from '../config/database.js';
import { transformResponse } from '../utils/transform.js';
import { ForbiddenError } from '@ssrprompt/shared';
export class TracesRepository extends TenantRepository {
    constructor() {
        super(...arguments);
        Object.defineProperty(this, "delegate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: prisma.trace
        });
        Object.defineProperty(this, "entityName", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'Trace'
        });
    }
    /**
     * Find traces for a user with pagination (list view - exclude large fields)
     */
    async findPaginated(userId, options = {}) {
        const page = options.page ?? 1;
        const limit = Math.min(options.limit ?? 50, 100);
        const skip = (page - 1) * limit;
        const where = {
            userId,
            ...(options.promptId && { promptId: options.promptId }),
            ...(options.status && { status: options.status }),
        };
        const [traces, total] = await Promise.all([
            this.delegate.findMany({
                where,
                select: {
                    id: true,
                    userId: true,
                    promptId: true,
                    modelId: true,
                    input: true, // Include input for preview
                    tokensInput: true,
                    tokensOutput: true,
                    latencyMs: true,
                    status: true,
                    createdAt: true,
                    // Exclude large fields: output, thinkingContent, attachments
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.delegate.count({ where }),
        ]);
        return {
            data: traces.map(transformResponse),
            total,
            page,
            limit,
        };
    }
    /**
     * Find trace by ID with full details
     */
    async findById(userId, id) {
        const trace = await this.delegate.findUnique({
            where: { id },
            include: {
                prompt: { select: { id: true, name: true } },
                model: { select: { id: true, name: true, modelId: true } },
            },
        });
        if (!trace)
            return null;
        if (trace.userId !== userId) {
            throw new ForbiddenError('Access denied to Trace');
        }
        return transformResponse(trace);
    }
    /**
     * Create a trace
     */
    async create(userId, data) {
        const trace = await this.delegate.create({
            data: { ...data, user: { connect: { id: userId } } },
        });
        return transformResponse(trace);
    }
    /**
     * Delete traces by prompt ID
     */
    async deleteByPrompt(userId, promptId) {
        const result = await this.delegate.deleteMany({
            where: {
                userId,
                promptId: promptId ?? null,
            },
        });
        return result.count;
    }
    /**
     * Get usage statistics for a user
     */
    async getUsageStats(userId) {
        const stats = await this.delegate.aggregate({
            where: { userId },
            _count: { id: true },
            _sum: {
                tokensInput: true,
                tokensOutput: true,
            },
            _avg: {
                latencyMs: true,
            },
        });
        return {
            totalTraces: stats._count.id,
            totalTokensInput: stats._sum.tokensInput ?? 0,
            totalTokensOutput: stats._sum.tokensOutput ?? 0,
            averageLatency: Math.round(stats._avg.latencyMs ?? 0),
        };
    }
}
export const tracesRepository = new TracesRepository();
//# sourceMappingURL=traces.repository.js.map