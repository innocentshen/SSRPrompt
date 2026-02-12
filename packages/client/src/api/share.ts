import apiClient, { ApiError } from './client';
import {
  getFetchExceptionCode,
  getFetchExceptionMessage,
  getLocalizedErrorMessage,
  normalizeErrorCode,
} from '../lib/error-messages';
import type {
  CreateShareLinkDto,
  ListShareLinksQueryDto,
  ShareAccessLogPage,
  ShareEvaluationDetail,
  ShareLink,
  ShareLinkPage,
  SharePromptDetail,
  UpdateShareLinkDto,
} from '@ssrprompt/shared';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

function getAuthHeader(): string {
  const token = localStorage.getItem('auth_token');
  return token ? `Bearer ${token}` : '';
}

export const shareApi = {
  createLink: (data: CreateShareLinkDto) => apiClient.post<ShareLink>('/share-links', data),

  listLinks: (params?: ListShareLinksQueryDto) =>
    apiClient.get<ShareLinkPage>('/share-links', {
      params: {
        resourceType: params?.resourceType,
        includeRevoked: params?.includeRevoked,
        page: params?.page,
        pageSize: params?.pageSize,
      },
    }),

  updateLink: (id: string, data: UpdateShareLinkDto) =>
    apiClient.put<ShareLink>(`/share-links/${id}`, data),

  revokeLink: (id: string) => apiClient.post<ShareLink>(`/share-links/${id}/revoke`),

  listAccessLogs: (id: string, options?: { page?: number; limit?: number }) =>
    apiClient.get<ShareAccessLogPage>(`/share-links/${id}/logs`, {
      params: {
        page: options?.page,
        limit: options?.limit,
      },
    }),

  verifyPassword: (token: string, password: string) =>
    apiClient.post<{ success: boolean }>(`/share/${token}/verify-password`, { password }),

  getSharedPrompt: (token: string) => apiClient.get<SharePromptDetail>(`/share/p/${token}`),

  getSharedEvaluation: (token: string) => apiClient.get<ShareEvaluationDetail>(`/share/e/${token}`),

  copySharedPrompt: (token: string, name?: string) =>
    apiClient.post(`/share/p/${token}/copy`, name ? { name } : {}),

  copySharedEvaluation: (token: string, name?: string) =>
    apiClient.post(`/share/e/${token}/copy`, name ? { name } : {}),

  async downloadSharedEvaluationAttachmentBlob(
    token: string,
    fileId: string,
    options?: { signal?: AbortSignal }
  ): Promise<Blob> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/share/e/${token}/files/${fileId}`, {
        headers: { Authorization: getAuthHeader() },
        signal: options?.signal,
      });
    } catch (error) {
      if (getFetchExceptionCode(error) === 'REQUEST_ABORTED') throw error;
      throw new ApiError(0, 'NETWORK_ERROR', getFetchExceptionMessage(error));
    }

    if (!response.ok) {
      const requestIdFromHeader = response.headers.get('X-Request-Id') || undefined;
      const rawText = await response.text().catch(() => '');

      let data: unknown;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        const code = 'INVALID_RESPONSE';
        const message = getLocalizedErrorMessage({ code, status: response.status });
        throw new ApiError(response.status, code, message, { body: rawText }, requestIdFromHeader);
      }

      const payload = data as { error?: { code?: unknown; message?: unknown; details?: unknown; requestId?: unknown } };
      const errorPayload = payload?.error ?? {};
      const requestId = requestIdFromHeader || (typeof errorPayload.requestId === 'string' ? errorPayload.requestId : undefined);
      const code = normalizeErrorCode(errorPayload.code, response.status);
      const message = getLocalizedErrorMessage({
        code,
        status: response.status,
        fallbackMessage: typeof errorPayload.message === 'string' ? errorPayload.message : undefined,
      });

      throw new ApiError(response.status, code, message, errorPayload.details, requestId);
    }

    return response.blob();
  },
};

