import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { env } from '../config/env.js';
import { UnauthorizedError, TokenExpiredError, ForbiddenError } from '@ssrprompt/shared';
/**
 * Generate a JWT token
 */
export function generateToken(payload, expiresIn = '7d') {
    return jwt.sign(payload, env.JWT_SECRET, { expiresIn });
}
/**
 * Generate a demo token with a random user ID
 */
export function generateDemoToken() {
    const userId = `demo_${randomUUID()}`;
    const token = generateToken({
        userId,
        tenantType: 'demo',
        isDemo: true,
    }, '7d');
    return { token, userId };
}
/**
 * Verify and decode a JWT token
 */
export function verifyToken(token) {
    return jwt.verify(token, env.JWT_SECRET);
}
/**
 * Authentication middleware
 * Validates JWT token and attaches user info to request
 */
export function authenticateJWT(req, _res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return next(new UnauthorizedError('Missing authorization header'));
    }
    const token = authHeader.substring(7);
    try {
        const payload = verifyToken(token);
        req.user = payload;
        next();
    }
    catch (error) {
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
export function optionalAuth(req, _res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return next();
    }
    const token = authHeader.substring(7);
    try {
        const payload = verifyToken(token);
        req.user = payload;
    }
    catch {
        // Ignore token errors for optional auth
    }
    next();
}
/**
 * Middleware to require a specific tenant type
 */
export function requireTenantType(type) {
    return (req, _res, next) => {
        if (!req.user) {
            return next(new UnauthorizedError());
        }
        if (req.user.tenantType !== type) {
            return next(new UnauthorizedError(`This action requires ${type} account`));
        }
        next();
    };
}
/**
 * Middleware to require specific roles
 */
export function requireRole(...roles) {
    return (req, _res, next) => {
        if (!req.user) {
            return next(new UnauthorizedError());
        }
        // Demo users don't have roles
        if (req.user.isDemo) {
            return next(new ForbiddenError('This action requires a registered account'));
        }
        const userRoles = req.user.roles || [];
        const hasRole = roles.some((role) => userRoles.includes(role));
        if (!hasRole) {
            return next(new ForbiddenError(`Required role: ${roles.join(' or ')}`));
        }
        next();
    };
}
/**
 * Middleware to check if user is not demo
 */
export function requireRegisteredUser(req, _res, next) {
    if (!req.user) {
        return next(new UnauthorizedError());
    }
    if (req.user.isDemo) {
        return next(new ForbiddenError('This action requires a registered account'));
    }
    next();
}
//# sourceMappingURL=auth.js.map