import { Request, Response, NextFunction } from 'express';
export interface JwtPayload {
    userId: string;
    email?: string;
    tenantType: 'demo' | 'personal';
    isDemo: boolean;
    roles?: string[];
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
export declare function generateToken(payload: Omit<JwtPayload, 'iat' | 'exp'>, expiresIn?: string): string;
/**
 * Generate a demo token with a random user ID
 */
export declare function generateDemoToken(): {
    token: string;
    userId: string;
};
/**
 * Verify and decode a JWT token
 */
export declare function verifyToken(token: string): JwtPayload;
/**
 * Authentication middleware
 * Validates JWT token and attaches user info to request
 */
export declare function authenticateJWT(req: Request, _res: Response, next: NextFunction): void;
/**
 * Optional authentication middleware
 * Attaches user info if token is present, but doesn't require it
 */
export declare function optionalAuth(req: Request, _res: Response, next: NextFunction): void;
/**
 * Middleware to require a specific tenant type
 */
export declare function requireTenantType(type: 'demo' | 'personal'): (req: Request, _res: Response, next: NextFunction) => void;
/**
 * Middleware to require specific roles
 */
export declare function requireRole(...roles: string[]): (req: Request, _res: Response, next: NextFunction) => void;
/**
 * Middleware to check if user is not demo
 */
export declare function requireRegisteredUser(req: Request, _res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.d.ts.map