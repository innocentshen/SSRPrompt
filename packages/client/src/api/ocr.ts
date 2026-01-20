import { apiClient } from './client';
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

    const response = await fetch(`${API_BASE_URL}/ocr/test`, {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(),
      },
      body: form,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }

    return data.data as OcrTestResult;
  },
};
