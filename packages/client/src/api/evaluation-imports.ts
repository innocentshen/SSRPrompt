import { ApiError } from './client';
import {
  getFetchExceptionCode,
  getFetchExceptionMessage,
  getLocalizedErrorMessage,
  normalizeErrorCode,
} from '../lib/error-messages';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

export type EvaluationImportMode = 'create' | 'append' | 'overwrite';

export type EvaluationImportJob = {
  id: string;
  userId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  mode: EvaluationImportMode;
  sourceZipFileId: string;
  targetEvaluationId: string | null;
  resultEvaluationId: string | null;
  progress: Record<string, unknown>;
  errors: unknown[];
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

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

async function parseBlobOrThrow(response: Response): Promise<Blob> {
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
}

export const evaluationImportsApi = {
  async createZip(file: File, options: { mode: EvaluationImportMode; targetEvaluationId?: string }): Promise<{ jobId: string }> {
    const form = new FormData();
    form.append('file', file);
    form.append('mode', options.mode);
    if (options.targetEvaluationId) {
      form.append('targetEvaluationId', options.targetEvaluationId);
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/evaluation-imports/zip`, {
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
    return data.data as { jobId: string };
  },

  async getJob(jobId: string): Promise<EvaluationImportJob> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/evaluation-imports/${jobId}`, {
        headers: { Authorization: getAuthHeader() },
      });
    } catch (error) {
      if (getFetchExceptionCode(error) === 'REQUEST_ABORTED') throw error;
      throw new ApiError(0, 'NETWORK_ERROR', getFetchExceptionMessage(error));
    }

    const data = await parseJsonOrThrow(response);
    return data.data as EvaluationImportJob;
  },

  async downloadTemplateZip(options?: { signal?: AbortSignal; lang?: string }): Promise<Blob> {
    const query = options?.lang ? `?lang=${encodeURIComponent(options.lang)}` : '';

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/evaluation-imports/template${query}`, {
        headers: { Authorization: getAuthHeader() },
        signal: options?.signal,
      });
    } catch (error) {
      if (getFetchExceptionCode(error) === 'REQUEST_ABORTED') throw error;
      throw new ApiError(0, 'NETWORK_ERROR', getFetchExceptionMessage(error));
    }

    return parseBlobOrThrow(response);
  },

  async exportEvaluationZip(
    evaluationId: string,
    options?: { includeAttachments?: boolean; signal?: AbortSignal; lang?: string }
  ): Promise<Blob> {
    const includeAttachments = options?.includeAttachments !== false ? '1' : '0';
    const queryLang = options?.lang ? `&lang=${encodeURIComponent(options.lang)}` : '';

    let response: Response;
    try {
      response = await fetch(
        `${API_BASE_URL}/evaluation-imports/export/${evaluationId}?includeAttachments=${includeAttachments}${queryLang}`,
        {
          headers: { Authorization: getAuthHeader() },
          signal: options?.signal,
        }
      );
    } catch (error) {
      if (getFetchExceptionCode(error) === 'REQUEST_ABORTED') throw error;
      throw new ApiError(0, 'NETWORK_ERROR', getFetchExceptionMessage(error));
    }

    return parseBlobOrThrow(response);
  },
};

