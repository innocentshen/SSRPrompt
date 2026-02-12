import apiClient from './client';
import type { CreatePromptApiKeyDto, CreatePromptApiKeyResult, PromptApiKey } from '@ssrprompt/shared';

export const promptApiKeysApi = {
  list: () => apiClient.get<PromptApiKey[]>('/prompt-api-keys'),

  create: (data: CreatePromptApiKeyDto) =>
    apiClient.post<CreatePromptApiKeyResult>('/prompt-api-keys', data),

  revoke: (id: string) =>
    apiClient.post<PromptApiKey>(`/prompt-api-keys/${id}/revoke`),
};
