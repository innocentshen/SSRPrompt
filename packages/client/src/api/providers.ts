import apiClient from './client';
import type { Provider, Model, CreateProviderDto, UpdateProviderDto, CreateModelDto, UpdateModelDto, ProviderType } from '@ssrprompt/shared';

export interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

export interface DiscoveredModel {
  id: string;
  name: string;
  owned_by?: string;
  maxContextLength?: number;
}

/**
 * Providers API
 */
export const providersApi = {
  /**
   * Get all providers
   */
  list: () => apiClient.get<Provider[]>('/providers'),

  /**
   * Get provider by ID with models
   */
  getById: (id: string) => apiClient.get<Provider & { models: Model[] }>(`/providers/${id}`),

  /**
   * Create a new provider
   */
  create: (data: CreateProviderDto) => apiClient.post<Provider>('/providers', data),

  /**
   * Update a provider
   */
  update: (id: string, data: UpdateProviderDto) => apiClient.put<Provider>(`/providers/${id}`, data),

  /**
   * Delete a provider
   */
  delete: (id: string) => apiClient.delete<void>(`/providers/${id}`),

  /**
   * Test connection to a provider
   */
  testConnection: (data: { type: ProviderType; apiKey: string; baseUrl?: string | null }) =>
    apiClient.post<TestConnectionResult>('/providers/test-connection', data),

  /**
   * Discover models available for a provider (uses saved key by default)
   */
  discoverModels: (
    providerId: string,
    data?: { type?: ProviderType; apiKey?: string; baseUrl?: string | null }
  ) => apiClient.post<DiscoveredModel[]>(`/providers/${providerId}/models/discover`, data),
};

/**
 * Models API
 */
export const modelsApi = {
  /**
   * Get all models for the user
   */
  list: () => apiClient.get<Model[]>('/models'),

  /**
   * Get models for a specific provider
   */
  listByProvider: (providerId: string) =>
    apiClient.get<Model[]>(`/providers/${providerId}/models`),

  /**
   * Get model by ID
   */
  getById: (id: string) => apiClient.get<Model>(`/models/${id}`),

  /**
   * Create a new model
   */
  create: (providerId: string, data: CreateModelDto) =>
    apiClient.post<Model>(`/providers/${providerId}/models`, data),

  /**
   * Update a model
   */
  update: (id: string, data: UpdateModelDto) => apiClient.put<Model>(`/models/${id}`, data),

  /**
   * Delete a model
   */
  delete: (id: string) => apiClient.delete<void>(`/models/${id}`),
};
