// Re-export all types
export * from './provider';
export * from './prompt';
export * from './evaluation';
export * from './trace';

// Common API Response Types
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// Auth Types
export interface JwtPayload {
  userId: string;
  tenantType: 'demo' | 'personal';
  iat: number;
  exp: number;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    tenantType: 'demo' | 'personal';
  };
}
