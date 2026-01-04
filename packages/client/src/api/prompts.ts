import apiClient from './client';
import type {
  Prompt,
  PromptListItem,
  PromptVersion,
  CreatePromptDto,
  UpdatePromptDto,
} from '@ssrprompt/shared';

/**
 * Prompts API
 */
export const promptsApi = {
  /**
   * Get all prompts (list view)
   */
  list: () => apiClient.get<PromptListItem[]>('/prompts'),

  /**
   * Get prompt by ID with full details
   */
  getById: (id: string) => apiClient.get<Prompt>(`/prompts/${id}`),

  /**
   * Create a new prompt
   */
  create: (data: CreatePromptDto) => apiClient.post<Prompt>('/prompts', data),

  /**
   * Update a prompt
   */
  update: (id: string, data: UpdatePromptDto) => apiClient.put<Prompt>(`/prompts/${id}`, data),

  /**
   * Delete a prompt
   */
  delete: (id: string) => apiClient.delete<void>(`/prompts/${id}`),

  /**
   * Update prompt order
   */
  updateOrder: (id: string, orderIndex: number) =>
    apiClient.put<Prompt>(`/prompts/${id}/order`, { orderIndex }),

  /**
   * Batch update order for multiple prompts
   */
  batchUpdateOrder: (updates: { id: string; orderIndex: number }[]) =>
    apiClient.put<{ success: boolean }>('/prompts/batch-order', updates),

  /**
   * Get versions for a prompt
   */
  getVersions: (promptId: string) =>
    apiClient.get<PromptVersion[]>(`/prompts/${promptId}/versions`),

  /**
   * Create a new version
   */
  createVersion: (promptId: string, content: string, commitMessage?: string) =>
    apiClient.post<PromptVersion>(`/prompts/${promptId}/versions`, {
      content,
      commitMessage,
    }),

  /**
   * Get a specific version
   */
  getVersion: (promptId: string, version: number) =>
    apiClient.get<PromptVersion>(`/prompts/${promptId}/versions/${version}`),
};
