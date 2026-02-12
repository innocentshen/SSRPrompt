import apiClient from './client';
import type {
  Trace,
  TraceListItem,
  PaginatedResponse,
  CreateTraceDto,
  TraceSource,
} from '@ssrprompt/shared';

export interface TraceQueryParams {
  page?: number;
  limit?: number;
  promptId?: string;
  status?: 'success' | 'error';
  source?: TraceSource;
}

export interface UsageStats {
  totalTraces: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  averageLatency: number;
}

/**
 * Traces API
 */
export const tracesApi = {
  /**
   * Get traces with pagination
   */
  list: async (params?: TraceQueryParams): Promise<PaginatedResponse<TraceListItem>> => {
    const result = await apiClient.getRaw<{
      data: TraceListItem[];
      meta: { total: number; page: number; limit: number; totalPages: number };
    }>('/traces', { params: params as Record<string, string | number | boolean | undefined> });

    return {
      data: result.data,
      total: result.meta.total,
      page: result.meta.page,
      limit: result.meta.limit,
      totalPages: result.meta.totalPages,
    };
  },

  /**
   * Get trace by ID with full details
   */
  getById: (id: string) => apiClient.get<Trace>(`/traces/${id}`),

  /**
   * Create a new trace
   */
  create: (data: CreateTraceDto) => apiClient.post<Trace>('/traces', data),

  /**
   * Delete a trace
   */
  delete: (id: string) => apiClient.delete<void>(`/traces/${id}`),

  /**
   * Delete all traces for a prompt
   */
  deleteByPrompt: (promptId: string | null) =>
    apiClient.delete<{ deleted: number }>(`/traces/by-prompt/${promptId ?? 'null'}`),

  /**
   * Get usage statistics
   */
  getUsageStats: () => apiClient.get<UsageStats>('/stats/usage'),
};
