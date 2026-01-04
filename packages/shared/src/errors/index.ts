/**
 * Unified Error Codes for SSRPrompt
 * Used for consistent error handling across frontend and backend
 */
export const ErrorCodes = {
  // Auth errors
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  UNAUTHORIZED: 'UNAUTHORIZED',

  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',

  // Provider/AI errors
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  MODEL_NOT_AVAILABLE: 'MODEL_NOT_AVAILABLE',
  STREAM_ABORTED: 'STREAM_ABORTED',

  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',

  // System errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  ENCRYPTION_ERROR: 'ENCRYPTION_ERROR',
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

/**
 * Application Error class for consistent error handling
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: ErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON() {
    return {
      error: {
        code: this.errorCode,
        message: this.message,
        details: this.details,
      },
    };
  }
}

// Convenience error classes
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      404,
      'NOT_FOUND',
      id ? `${resource} with id '${id}' not found` : `${resource} not found`
    );
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(403, 'FORBIDDEN', message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class TokenExpiredError extends AppError {
  constructor() {
    super(401, 'TOKEN_EXPIRED', 'Your session has expired');
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

export class ProviderError extends AppError {
  constructor(message: string, details?: unknown) {
    super(503, 'PROVIDER_ERROR', message, details);
  }
}

export class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred') {
    super(500, 'INTERNAL_ERROR', message);
  }
}
