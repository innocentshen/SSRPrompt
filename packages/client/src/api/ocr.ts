import { apiClient, ApiError } from './client';
import {
  getFetchExceptionCode,
  getFetchExceptionMessage,
  getLocalizedErrorMessage,
  normalizeErrorCode,
} from '../lib/error-messages';
import type {
  OcrProviderSettings,
  OcrTestResult,
  UpdateOcrProviderSettingsDto,
  OcrProvider,
  OcrCredentialSource,
  OcrSystemProviderSettings,
  UpdateOcrSystemProviderSettingsDto,
  OcrResultItem,
  OcrResultsRequest,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

function getAuthHeader(): string {
  const token = localStorage.getItem('auth_token');
  return token ? `Bearer ${token}` : '';
}

export const ocrApi = {
  getSettings: () => apiClient.get<OcrProviderSettings>('/ocr/settings'),

  updateSettings: (data: UpdateOcrProviderSettingsDto) =>
    apiClient.put<OcrProviderSettings>('/ocr/settings', data),

  getSystemSettings: () => apiClient.get<OcrSystemProviderSettings>('/ocr/system-settings'),

  updateSystemSettings: (data: UpdateOcrSystemProviderSettingsDto) =>
    apiClient.put<OcrSystemProviderSettings>('/ocr/system-settings', data),

  getResults: (data: OcrResultsRequest) => apiClient.post<OcrResultItem[]>('/ocr/results', data),

  async test(
    file: File,
    override?: Partial<{
      provider: OcrProvider;
      credentialSource: OcrCredentialSource;
      baseUrl: string | null;
      apiKey: string | null;
    }>
  ): Promise<OcrTestResult> {
    const form = new FormData();
    form.append('file', file);

    if (override?.provider) form.append('provider', override.provider);
    if (override?.credentialSource) form.append('credentialSource', override.credentialSource);
    if (override?.baseUrl) form.append('baseUrl', override.baseUrl);
    if (override?.apiKey) form.append('apiKey', override.apiKey);

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/ocr/test`, {
        method: 'POST',
        headers: {
          Authorization: getAuthHeader(),
        },
        body: form,
      });
    } catch (error) {
      if (getFetchExceptionCode(error) === 'REQUEST_ABORTED') throw error;
      throw new ApiError(0, 'NETWORK_ERROR', getFetchExceptionMessage(error));
    }

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

    if (!response.ok) {
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

    const okPayload = data as { data?: unknown };
    return okPayload.data as OcrTestResult;
  },
};
