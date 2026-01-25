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
  const data = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const error = (data as { error?: { message?: unknown } }).error;
    const message = error && typeof error.message === 'string' ? error.message : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export const filesApi = {
  async upload(file: File): Promise<UploadedFile> {
    const form = new FormData();
    form.append('file', file);

    const response = await fetch(`${API_BASE_URL}/files`, {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(),
      },
      body: form,
    });

    const data = await parseJsonOrThrow(response);
    return data.data as UploadedFile;
  },

  async getMeta(fileId: string): Promise<UploadedFile> {
    const response = await fetch(`${API_BASE_URL}/files/${fileId}/meta`, {
      headers: { Authorization: getAuthHeader() },
    });
    const data = await parseJsonOrThrow(response);
    return data.data as UploadedFile;
  },

  async downloadBlob(fileId: string, options?: { signal?: AbortSignal }): Promise<Blob> {
    const response = await fetch(`${API_BASE_URL}/files/${fileId}`, {
      headers: { Authorization: getAuthHeader() },
      signal: options?.signal,
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        message = data?.error?.message || message;
      } catch {
        // ignore
      }
      throw new Error(message);
    }

    return response.blob();
  },
};

