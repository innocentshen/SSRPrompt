import apiClient from './client';
import type {
  Trace,
  TraceListItem,
  PaginatedResponse,
  CreateTraceDto,
} from '@ssrprompt/shared';

export interface TraceQueryParams {
  page?: number;
  limit?: number;
  promptId?: string;
  status?: 'success' | 'error';
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
    const response = await fetch(
      `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1'}/traces?${new URLSearchParams(
        Object.entries(params || {})
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      )}`,
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
        },
      }
    );

    const data = await response.json();
    return {
      data: data.data,
      total: data.meta.total,
      page: data.meta.page,
      limit: data.meta.limit,
      totalPages: data.meta.totalPages,
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
