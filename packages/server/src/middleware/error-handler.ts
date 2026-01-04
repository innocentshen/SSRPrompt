import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, ErrorCodes } from '@ssrprompt/shared';
import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';

/**
 * Global error handling middleware
 */
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error(`[Error] ${req.method} ${req.path}:`, error);

  // Handle AppError (our custom errors)
  if (error instanceof AppError) {
    return res.status(error.statusCode).json(error.toJSON());
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Validation failed',
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
          },
        });
      case 'P2025':
        return res.status(404).json({
          error: {
            code: ErrorCodes.NOT_FOUND,
            message: 'Record not found',
          },
        });
      case 'P2003':
        return res.status(400).json({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Foreign key constraint failed',
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
      ...(isDev && { stack: error.stack }),
    },
  });
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: ErrorCodes.NOT_FOUND,
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}
