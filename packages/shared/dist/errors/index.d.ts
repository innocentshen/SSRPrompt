/**
 * Unified Error Codes for SSRPrompt
 * Used for consistent error handling across frontend and backend
 */
export declare const ErrorCodes: {
    readonly RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED";
    readonly TOKEN_EXPIRED: "TOKEN_EXPIRED";
    readonly TOKEN_INVALID: "TOKEN_INVALID";
    readonly UNAUTHORIZED: "UNAUTHORIZED";
    readonly REGISTRATION_DISABLED: "REGISTRATION_DISABLED";
    readonly NOT_FOUND: "NOT_FOUND";
    readonly FORBIDDEN: "FORBIDDEN";
    readonly CONFLICT: "CONFLICT";
    readonly PROVIDER_ERROR: "PROVIDER_ERROR";
    readonly QUOTA_EXCEEDED: "QUOTA_EXCEEDED";
    readonly MODEL_NOT_AVAILABLE: "MODEL_NOT_AVAILABLE";
    readonly STREAM_ABORTED: "STREAM_ABORTED";
    readonly CONTEXT_LIMIT_EXCEEDED: "CONTEXT_LIMIT_EXCEEDED";
    readonly FILE_UPLOAD_NOT_ALLOWED: "FILE_UPLOAD_NOT_ALLOWED";
    readonly SHARE_PASSWORD_REQUIRED: "SHARE_PASSWORD_REQUIRED";
    readonly SHARE_PASSWORD_INVALID: "SHARE_PASSWORD_INVALID";
    readonly SHARE_LINK_EXPIRED: "SHARE_LINK_EXPIRED";
    readonly SHARE_LINK_REVOKED: "SHARE_LINK_REVOKED";
    readonly VALIDATION_ERROR: "VALIDATION_ERROR";
    readonly INVALID_REQUEST: "INVALID_REQUEST";
    readonly INTERNAL_ERROR: "INTERNAL_ERROR";
    readonly DATABASE_ERROR: "DATABASE_ERROR";
    readonly ENCRYPTION_ERROR: "ENCRYPTION_ERROR";
};
export type ErrorCode = keyof typeof ErrorCodes;
/**
 * Application Error class for consistent error handling
 */
export declare class AppError extends Error {
    statusCode: number;
    errorCode: ErrorCode;
    details?: unknown | undefined;
    constructor(statusCode: number, errorCode: ErrorCode, message: string, details?: unknown | undefined);
    toJSON(): {
        error: {
            code: "RATE_LIMIT_EXCEEDED" | "TOKEN_EXPIRED" | "TOKEN_INVALID" | "UNAUTHORIZED" | "REGISTRATION_DISABLED" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "PROVIDER_ERROR" | "QUOTA_EXCEEDED" | "MODEL_NOT_AVAILABLE" | "STREAM_ABORTED" | "CONTEXT_LIMIT_EXCEEDED" | "FILE_UPLOAD_NOT_ALLOWED" | "SHARE_PASSWORD_REQUIRED" | "SHARE_PASSWORD_INVALID" | "SHARE_LINK_EXPIRED" | "SHARE_LINK_REVOKED" | "VALIDATION_ERROR" | "INVALID_REQUEST" | "INTERNAL_ERROR" | "DATABASE_ERROR" | "ENCRYPTION_ERROR";
            message: string;
            details: unknown;
        };
    };
}
export declare class NotFoundError extends AppError {
    constructor(resource: string, id?: string);
}
export declare class ForbiddenError extends AppError {
    constructor(message?: string);
}
export declare class UnauthorizedError extends AppError {
    constructor(message?: string);
}
export declare class TokenExpiredError extends AppError {
    constructor();
}
export declare class ValidationError extends AppError {
    constructor(message: string, details?: unknown);
}
export declare class ConflictError extends AppError {
    constructor(message: string);
}
export declare class ProviderError extends AppError {
    constructor(message: string, details?: unknown);
}
export declare class InternalError extends AppError {
    constructor(message?: string);
}
//# sourceMappingURL=index.d.ts.map