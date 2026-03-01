import { Trace, Prisma } from '@prisma/client';
import { TenantRepository } from './base.repository.js';
import { prisma } from '../config/database.js';
type TraceDelegate = typeof prisma.trace;
export declare class TracesRepository extends TenantRepository<Trace, Prisma.TraceCreateInput, Prisma.TraceUpdateInput, TraceDelegate> {
    protected delegate: Prisma.TraceDelegate<import("@prisma/client/runtime/library").DefaultArgs>;
    protected entityName: string;
    /**
     * Find traces for a user with pagination (list view - exclude large fields)
     */
    findPaginated(userId: string, options?: {
        page?: number;
        limit?: number;
        promptId?: string;
        status?: 'success' | 'error';
        source?: 'feature' | 'api';
    }): Promise<{
        data: Partial<Trace>[];
        total: number;
        page: number;
        limit: number;
    }>;
    /**
     * Find trace by ID with full details
     */
    findById(userId: string, id: string): Promise<Trace | null>;
    /**
     * Create a trace
     */
    create(userId: string, data: Omit<Prisma.TraceCreateInput, 'userId' | 'user'>): Promise<Trace>;
    /**
     * Delete traces by prompt ID
     */
    deleteByPrompt(userId: string, promptId: string | null): Promise<number>;
    /**
     * Get usage statistics for a user
     */
    getUsageStats(userId: string): Promise<{
        totalTraces: number;
        totalTokensInput: number;
        totalTokensOutput: number;
        averageLatency: number;
    }>;
}
export declare const tracesRepository: TracesRepository;
export {};
//# sourceMappingURL=traces.repository.d.ts.map