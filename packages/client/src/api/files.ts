import { ApiError } from './client';
import {
  getFetchExceptionCode,
  getFetchExceptionMessage,
  getLocalizedErrorMessage,
  normalizeErrorCode,
} from '../lib/error-messages';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

export interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
}

function getAuthHeader(): string {
  const token = localStorage.getItem('auth_token');
  return token ? `Bearer ${token}` : '';
}

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const requestIdFromHeader = response.headers.get('X-Request-Id') || undefined;
  const rawText = await response.text().catch(() => '');

  let data: Record<string, unknown>;
  try {
    data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    const code = 'INVALID_RESPONSE';
    const message = getLocalizedErrorMessage({ code, status: response.status });
    throw new ApiError(response.status, code, message, { body: rawText }, requestIdFromHeader);
  }

  if (!response.ok) {
    const error = (data as { error?: { code?: unknown; message?: unknown; details?: unknown; requestId?: unknown } }).error ?? {};
    const requestId = requestIdFromHeader || (typeof error.requestId === 'string' ? error.requestId : undefined);
    const code = normalizeErrorCode(error.code, response.status);
    const message = getLocalizedErrorMessage({
      code,
      status: response.status,
      fallbackMessage: typeof error.message === 'string' ? error.message : undefined,
    });
    throw new ApiError(response.status, code, message, error.details, requestId);
  }

  return data;
}

export const filesApi = {
  async upload(file: File): Promise<UploadedFile> {
    const form = new FormData();
    form.append('file', file);

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/files`, {
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

    const data = await parseJsonOrThrow(response);
    return data.data as UploadedFile;
  },

  async getMeta(fileId: string): Promise<UploadedFile> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/files/${fileId}/meta`, {
        headers: { Authorization: getAuthHeader() },
      });
    } catch (error) {
      if (getFetchExceptionCode(error) === 'REQUEST_ABORTED') throw error;
      throw new ApiError(0, 'NETWORK_ERROR', getFetchExceptionMessage(error));
    }
    const data = await parseJsonOrThrow(response);
    return data.data as UploadedFile;
  },

  async downloadBlob(fileId: string, options?: { signal?: AbortSignal }): Promise<Blob> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/files/${fileId}`, {
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

