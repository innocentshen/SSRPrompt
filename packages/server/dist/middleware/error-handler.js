import { ZodError } from 'zod';
import { AppError, ErrorCodes } from '@ssrprompt/shared';
import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
export { asyncHandler } from '../utils/async-handler.js';
/**
 * Global error handling middleware
 */
export function errorHandler(error, req, res, _next) {
    const requestId = req.requestId;
    const userId = req.user?.userId;
    // Safe error logging
    try {
        const prefixParts = ['[Error]'];
        if (requestId)
            prefixParts.push(`[${requestId}]`);
        if (userId)
            prefixParts.push(`[user:${userId}]`);
        console.error(`${prefixParts.join(' ')} ${req.method} ${req.path}:`, error.message);
        if (error.stack) {
            console.error(error.stack);
        }
    }
    catch {
        console.error('[Error] Failed to log error');
    }
    // Handle AppError (our custom errors)
    if (error instanceof AppError) {
        const payload = error.toJSON();
        if (requestId) {
            payload.error = payload.error ?? {};
            payload.error.requestId = requestId;
        }
        return res.status(error.statusCode).json(payload);
    }
    // Handle Zod validation errors
    if (error instanceof ZodError) {
        return res.status(400).json({
            error: {
                code: ErrorCodes.VALIDATION_ERROR,
                message: 'Validation failed',
                requestId,
                details: error.errors.map((e) => ({
                    path: e.path.join('.'),
                    message: e.message,
                })),
            },
        });
    }
    // Handle Prisma errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        switch (error.code) {
            case 'P2002':
                return res.status(409).json({
                    error: {
                        code: ErrorCodes.CONFLICT,
                        message: 'A record with this value already exists',
                        requestId,
                    },
                });
            case 'P2025':
                return res.status(404).json({
                    error: {
                        code: ErrorCodes.NOT_FOUND,
                        message: 'Record not found',
                        requestId,
                    },
                });
            case 'P2003':
                return res.status(400).json({
                    error: {
                        code: ErrorCodes.VALIDATION_ERROR,
                        message: 'Foreign key constraint failed',
                        requestId,
                    },
                });
        }
    }
    // Generic error response
    const isDev = env.NODE_ENV === 'development';
    res.status(500).json({
        error: {
            code: ErrorCodes.INTERNAL_ERROR,
            message: isDev ? error.message : 'An unexpected error occurred',
            requestId,
            ...(isDev && { stack: error.stack }),
        },
    });
}
/**
 * 404 Not Found handler
 */
export function notFoundHandler(req, res) {
    res.status(404).json({
        error: {
            code: ErrorCodes.NOT_FOUND,
            message: `Route ${req.method} ${req.path} not found`,
            requestId: req.requestId,
        },
    });
}
//# sourceMappingURL=error-handler.js.map