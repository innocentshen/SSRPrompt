/**
 * API Client for SSRPrompt
 * Handles all HTTP requests to the backend
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * API Error class
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
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

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
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
   * Handle API response
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return undefined as T;
    }

    const data = await response.json();

    if (!response.ok) {
      const error = data.error || { code: 'UNKNOWN_ERROR', message: 'Request failed' };

      // Handle token expiration - auto refresh for demo mode
      if (response.status === 401 && error.code === 'TOKEN_EXPIRED' && this.isDemoMode()) {
        await this.refreshDemoToken();
        throw new ApiError(response.status, 'RETRY_NEEDED', 'Token refreshed, please retry');
      }

      throw new ApiError(response.status, error.code, error.message, error.details);
    }

    return data.data;
  }

  /**
   * Refresh demo token
   */
  private async refreshDemoToken(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/auth/demo-token`);
    const data = await response.json();

    if (data.data?.token) {
      this.setToken(data.data.token);
    }
  }

  /**
   * Initialize demo session
   */
  async initDemoSession(): Promise<{ token: string; userId: string }> {
    const response = await fetch(`${this.baseUrl}/auth/demo-token`);
    const data = await response.json();

    if (data.data?.token) {
      this.setToken(data.data.token);
      return data.data;
    }

    throw new ApiError(500, 'INIT_FAILED', 'Failed to initialize demo session');
  }

  /**
   * Make a request with retry logic
   */
  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { params, ...fetchOptions } = options;

    const response = await fetch(this.buildUrl(path, params), {
      ...fetchOptions,
      headers: this.getHeaders(),
    });

    try {
      return await this.handleResponse<T>(response);
    } catch (error) {
      // Retry once if token was refreshed
      if (error instanceof ApiError && error.code === 'RETRY_NEEDED') {
        const retryResponse = await fetch(this.buildUrl(path, params), {
          ...fetchOptions,
          headers: this.getHeaders(),
        });
        return this.handleResponse<T>(retryResponse);
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

  /**
   * DELETE request
   */
  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
export default apiClient;
