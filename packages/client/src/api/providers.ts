import apiClient from './client';
import type { Provider, Model, CreateProviderDto, UpdateProviderDto, CreateModelDto, UpdateModelDto } from '@ssrprompt/shared';

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
