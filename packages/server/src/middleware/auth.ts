import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { env } from '../config/env.js';
import { UnauthorizedError, TokenExpiredError } from '@ssrprompt/shared';

export interface JwtPayload {
  userId: string;
  tenantType: 'demo' | 'personal';
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Generate a JWT token
 */
export function generateToken(userId: string, tenantType: 'demo' | 'personal', expiresIn = '7d'): string {
  return jwt.sign(
    { userId, tenantType },
    env.JWT_SECRET,
    { expiresIn }
  );
}

/**
 * Generate a demo token with a random user ID
 */
export function generateDemoToken(): { token: string; userId: string } {
  const userId = `demo_${randomUUID()}`;
  const token = generateToken(userId, 'demo', '7d');
  return { token, userId };
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

/**
 * Authentication middleware
 * Validates JWT token and attaches user info to request
 */
export function authenticateJWT(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing authorization header'));
  }

  const token = authHeader.substring(7);

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(new TokenExpiredError());
    }
    return next(new UnauthorizedError('Invalid token'));
  }
}

/**
 * Optional authentication middleware
 * Attaches user info if token is present, but doesn't require it
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.substring(7);

  try {
    const payload = verifyToken(token);
    req.user = payload;
  } catch {
    // Ignore token errors for optional auth
  }

  next();
}

/**
 * Middleware to require a specific tenant type
 */
export function requireTenantType(type: 'demo' | 'personal') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    if (req.user.tenantType !== type) {
      return next(new UnauthorizedError(`This action requires ${type} account`));
    }

    next();
  };
}
