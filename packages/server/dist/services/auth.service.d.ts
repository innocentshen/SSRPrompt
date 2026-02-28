import type { User, AuthResponse, TokenPair } from '@ssrprompt/shared';
/**
 * Auth Service - handles authentication logic
 */
export declare class AuthService {
    /**
     * Register a new user with email/password
     */
    register(data: {
        email: string;
        password: string;
        name?: string;
        code?: string;
    }): Promise<AuthResponse>;
    /**
     * Login with email/password
     */
    login(email: string, password: string, meta?: {
        userAgent?: string;
        ipAddress?: string;
    }): Promise<AuthResponse>;
    /**
     * Issue tokens for an existing user (used by OAuth login)
     */
    createAuthResponseForUser(userId: string, meta?: {
        userAgent?: string;
        ipAddress?: string;
    }): Promise<AuthResponse>;
    /**
     * Logout - invalidate refresh token
     */
    logout(refreshToken: string): Promise<void>;
    /**
     * Logout all sessions for a user
     */
    logoutAll(userId: string): Promise<number>;
    /**
     * Refresh access token
     */
    refreshTokens(refreshToken: string, meta?: {
        userAgent?: string;
        ipAddress?: string;
    }): Promise<TokenPair>;
    /**
     * Get current user info
     */
    getCurrentUser(userId: string): Promise<User>;
    /**
     * Change password
     */
    changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>;
    /**
     * Send password reset verification code (no-op if user does not exist)
     */
    sendPasswordResetCode(email: string): Promise<{
        success: true;
        expiresIn: number;
    } | null>;
    /**
     * Reset password using email verification code
     */
    resetPassword(email: string, code: string, newPassword: string): Promise<void>;
    /**
     * Generate demo token
     */
    generateDemoToken(): {
        token: string;
        userId: string;
    };
    /**
     * Generate access token and refresh token
     */
    private generateTokenPair;
    /**
     * Format user for API response
     */
    private formatUser;
}
export declare const authService: AuthService;
//# sourceMappingURL=auth.service.d.ts.map