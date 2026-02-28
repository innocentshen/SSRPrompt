import type { Trace } from '@prisma/client';
import { CreateTraceInput, TraceQueryInput } from '@ssrprompt/shared';
export declare class TracesService {
    /**
     * Get traces with pagination
     */
    findPaginated(userId: string, query: TraceQueryInput): Promise<{
        data: Partial<Trace>[];
        total: number;
        page: number;
        limit: number;
    }>;
    /**
     * Get trace by ID with full details
     */
    findById(userId: string, id: string): Promise<Trace | null>;
    /**
     * Create a new trace
     */
    create(userId: string, data: CreateTraceInput): Promise<Trace>;
    /**
     * Delete a trace
     */
    delete(userId: string, id: string): Promise<Trace>;
    /**
     * Delete traces by prompt ID
     */
    deleteByPrompt(userId: string, promptId: string | null): Promise<number>;
    /**
     * Get usage statistics
     */
    getUsageStats(userId: string): Promise<{
        totalTraces: number;
        totalTokensInput: number;
        totalTokensOutput: number;
        averageLatency: number;
    }>;
}
export declare const tracesService: TracesService;
//# sourceMappingURL=traces.service.d.ts.map