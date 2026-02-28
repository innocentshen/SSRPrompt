export type UserStatus = 'active' | 'inactive' | 'suspended';
export type TenantType = 'demo' | 'personal';
export interface User {
    id: string;
    email: string;
    name?: string;
    avatar?: string;
    status: UserStatus;
    emailVerified: boolean;
    createdAt: string;
    updatedAt: string;
    lastLoginAt?: string;
    roles?: string[];
}
export interface Role {
    id: string;
    name: string;
    description?: string;
    isSystem: boolean;
    createdAt: string;
}
export interface Permission {
    id: string;
    name: string;
    description?: string;
    resource: string;
    action: string;
}
export interface JwtPayload {
    userId: string;
    email?: string;
    tenantType: TenantType;
    isDemo: boolean;
    roles?: string[];
    iat: number;
    exp: number;
}
export interface AuthResponse {
    user: User;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
}
export interface TokenPair {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
}
export interface DemoTokenResponse {
    token: string;
    user: {
        id: string;
        tenantType: 'demo';
    };
}
export interface SessionInfo {
    id: string;
    userAgent?: string;
    ipAddress?: string;
    createdAt: string;
    expiresAt: string;
    isCurrent: boolean;
}
export type EmailVerificationType = 'register' | 'reset_password';
export type OAuthProvider = 'google' | 'linuxdo';
export interface AuthConfig {
    allowRegistration: boolean;
    requireEmailVerification: boolean;
    oauth: {
        google: {
            enabled: boolean;
        };
        linuxdo: {
            enabled: boolean;
        };
    };
}
export interface SendCodeResponse {
    success: true;
    expiresIn: number;
}
//# sourceMappingURL=auth.d.ts.map