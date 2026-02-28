export type TraceStatus = 'success' | 'error';
export type TraceSource = 'feature' | 'api';
export interface Trace {
    id: string;
    userId: string;
    promptId: string | null;
    modelId: string | null;
    source: TraceSource;
    input: string;
    output: string | null;
    tokensInput: number;
    tokensOutput: number;
    latencyMs: number;
    status: TraceStatus;
    errorMessage: string | null;
    metadata: Record<string, unknown>;
    attachments: FileAttachment[] | null;
    thinkingContent: string | null;
    thinkingTimeMs: number | null;
    createdAt: string;
}
export interface FileAttachment {
    fileId: string;
    name: string;
    type: string;
    size?: number;
}
export interface CreateTraceDto {
    promptId?: string;
    modelId?: string;
    source?: TraceSource;
    input: string;
    output?: string;
    tokensInput?: number;
    tokensOutput?: number;
    latencyMs?: number;
    status?: TraceStatus;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
    attachments?: FileAttachment[];
    thinkingContent?: string;
    thinkingTimeMs?: number;
}
export interface TraceListItem {
    id: string;
    userId: string;
    promptId: string | null;
    modelId: string | null;
    source: TraceSource;
    input: string;
    tokensInput: number;
    tokensOutput: number;
    latencyMs: number;
    status: TraceStatus;
    createdAt: string;
}
export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}
//# sourceMappingURL=trace.d.ts.map