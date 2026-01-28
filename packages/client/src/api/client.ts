/**
 * API Client for SSRPrompt
 * Handles all HTTP requests to the backend
 */

import {
  getFetchExceptionCode,
  getFetchExceptionMessage,
  getLocalizedErrorMessage,
  normalizeErrorCode,
} from '../lib/error-messages';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Token refresh callback type
 */
type TokenRefresher = () => Promise<boolean>;

/**
 * API Error class
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public requestId?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * API Client singleton
 */
class ApiClient {
  private baseUrl: string;
  private tokenRefresher: TokenRefresher | null = null;
  private isRefreshing = false;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Register a token refresh callback
   */
  setTokenRefresher(refresher: TokenRefresher): void {
    this.tokenRefresher = refresher;
  }

  /**
   * Get stored auth token
   */
  private getToken(): string | null {
    return localStorage.getItem('auth_token');
  }

  /**
   * Set auth token
   */
  setToken(token: string): void {
    localStorage.setItem('auth_token', token);
  }

  /**
   * Clear auth token
   */
  clearToken(): void {
    localStorage.removeItem('auth_token');
  }

  /**
   * Check if user is in demo mode
   */
  isDemoMode(): boolean {
    const token = this.getToken();
    if (!token) return false;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.tenantType === 'demo';
    } catch {
      return false;
    }
  }

  /**
   * Build URL with query parameters
   */
  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  /**
   * Get headers for requests
   */
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  /**
   * Try to refresh the token
   */
  private async tryRefreshToken(): Promise<boolean> {
    if (!this.tokenRefresher) {
      return false;
    }

    // Prevent multiple concurrent refresh attempts
    if (this.isRefreshing) {
      return this.refreshPromise || Promise.resolve(false);
    }

    this.isRefreshing = true;
    this.refreshPromise = this.tokenRefresher()
      .finally(() => {
        this.isRefreshing = false;
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  /**
   * Handle API response
   */
  private async handleResponse<T>(response: Response, skipRefresh = false): Promise<T> {
    if (response.status === 204) {
      return undefined as T;
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
      const error = payload?.error ?? {};
      const requestId = requestIdFromHeader || (typeof error.requestId === 'string' ? error.requestId : undefined);
      const code = normalizeErrorCode(error.code, response.status);
      const message = getLocalizedErrorMessage({
        code,
        status: response.status,
        fallbackMessage: typeof error.message === 'string' ? error.message : undefined,
      });

      // Handle 401 - try to refresh token (unless skipped)
      if (response.status === 401 && !skipRefresh) {
        const refreshed = await this.tryRefreshToken();
        if (refreshed) {
          throw new ApiError(response.status, 'RETRY_NEEDED', 'Token refreshed, please retry');
        }
      }

      throw new ApiError(response.status, code, message, error.details, requestId);
    }

    const okPayload = data as { data?: unknown };
    return okPayload.data as T;
  }

  /**
   * Handle API response and return the raw JSON payload (useful for endpoints that include `meta`)
   */
  private async handleResponseRaw<T>(response: Response, skipRefresh = false): Promise<T> {
    if (response.status === 204) {
      return undefined as T;
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
      const error = payload?.error ?? {};
      const requestId = requestIdFromHeader || (typeof error.requestId === 'string' ? error.requestId : undefined);
      const code = normalizeErrorCode(error.code, response.status);
      const message = getLocalizedErrorMessage({
        code,
        status: response.status,
        fallbackMessage: typeof error.message === 'string' ? error.message : undefined,
      });

      // Handle 401 - try to refresh token (unless skipped)
      if (response.status === 401 && !skipRefresh) {
        const refreshed = await this.tryRefreshToken();
        if (refreshed) {
          throw new ApiError(response.status, 'RETRY_NEEDED', 'Token refreshed, please retry');
        }
      }

      throw new ApiError(response.status, code, message, error.details, requestId);
    }

    return data as T;
  }

  /**
   * Initialize demo session
   */
  async initDemoSession(): Promise<{ token: string; userId: string }> {
    const data = await this.get<{ token: string; userId: string }>('/auth/demo-token');
    if (data?.token) {
      this.setToken(data.token);
      return data;
    }

    const message = getLocalizedErrorMessage({ code: 'INIT_FAILED' });
    throw new ApiError(500, 'INIT_FAILED', message);
  }

  /**
   * Make a request with retry logic
   */
  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { params, ...fetchOptions } = options;

    // Skip token refresh for auth endpoints to prevent infinite loops
    const skipRefresh = path.startsWith('/auth/');

    let response: Response;
    try {
      response = await fetch(this.buildUrl(path, params), {
        ...fetchOptions,
        headers: this.getHeaders(),
      });
    } catch (error) {
      // Preserve AbortError semantics (typically not user-facing).
      if (getFetchExceptionCode(error) === 'REQUEST_ABORTED') {
        throw error;
      }
      throw new ApiError(0, 'NETWORK_ERROR', getFetchExceptionMessage(error));
    }

    try {
      return await this.handleResponse<T>(response, skipRefresh);
    } catch (error) {
      // Retry once if token was refreshed
      if (error instanceof ApiError && error.code === 'RETRY_NEEDED') {
        let retryResponse: Response;
        try {
          retryResponse = await fetch(this.buildUrl(path, params), {
            ...fetchOptions,
            headers: this.getHeaders(),
          });
        } catch (retryError) {
          if (getFetchExceptionCode(retryError) === 'REQUEST_ABORTED') {
            throw retryError;
          }
          throw new ApiError(0, 'NETWORK_ERROR', getFetchExceptionMessage(retryError));
        }
        return this.handleResponse<T>(retryResponse, true); // Don't refresh on retry
      }
      throw error;
    }
  }

  private async requestRaw<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { params, ...fetchOptions } = options;

    // Skip token refresh for auth endpoints to prevent infinite loops
    const skipRefresh = path.startsWith('/auth/');

    let response: Response;
    try {
      response = await fetch(this.buildUrl(path, params), {
        ...fetchOptions,
        headers: this.getHeaders(),
      });
    } catch (error) {
      if (getFetchExceptionCode(error) === 'REQUEST_ABORTED') {
        throw error;
      }
      throw new ApiError(0, 'NETWORK_ERROR', getFetchExceptionMessage(error));
    }

    try {
      return await this.handleResponseRaw<T>(response, skipRefresh);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'RETRY_NEEDED') {
        let retryResponse: Response;
        try {
          retryResponse = await fetch(this.buildUrl(path, params), {
            ...fetchOptions,
            headers: this.getHeaders(),
          });
        } catch (retryError) {
          if (getFetchExceptionCode(retryError) === 'REQUEST_ABORTED') {
            throw retryError;
          }
          throw new ApiError(0, 'NETWORK_ERROR', getFetchExceptionMessage(retryError));
        }
        return this.handleResponseRaw<T>(retryResponse, true);
      }
      throw error;
    }
  }

  /**
   * GET request
   */
  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  async getRaw<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.requestRaw<T>(path, { ...options, method: 'GET' });
  }

  /**
   * POST request
   */
  async post<T>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async postRaw<T>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.requestRaw<T>(path, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * PUT request
   */
  async put<T>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async putRaw<T>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.requestRaw<T>(path, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * DELETE request
   */
  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  async deleteRaw<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.requestRaw<T>(path, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
export default apiClient;
