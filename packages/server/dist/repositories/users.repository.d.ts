import type { User, Session, UserRole, Role, Prisma } from '@prisma/client';
export type UserWithRoles = User & {
    roles: (UserRole & {
        role: Role;
    })[];
};
/**
 * Users Repository - handles user CRUD operations
 */
export declare class UsersRepository {
    /**
     * Find user by ID
     */
    findById(id: string): Promise<User | null>;
    /**
     * Find user by ID with roles
     */
    findByIdWithRoles(id: string): Promise<UserWithRoles | null>;
    /**
     * Find user by email
     */
    findByEmail(email: string): Promise<User | null>;
    /**
     * Find user by email with roles
     */
    findByEmailWithRoles(email: string): Promise<UserWithRoles | null>;
    /**
     * Create a new user
     */
    create(data: {
        email: string;
        passwordHash?: string;
        name?: string;
        avatar?: string;
        emailVerified?: boolean;
    }): Promise<User>;
    /**
     * Create user with default role
     */
    createWithRole(data: {
        email: string;
        passwordHash?: string;
        name?: string;
        avatar?: string;
        emailVerified?: boolean;
    }, roleName?: string): Promise<UserWithRoles>;
    /**
     * Update user
     */
    update(id: string, data: Prisma.UserUpdateInput): Promise<User>;
    /**
     * Update last login timestamp
     */
    updateLastLogin(id: string): Promise<User>;
    /**
     * Delete user
     */
    delete(id: string): Promise<User>;
    /**
     * Check if email exists
     */
    emailExists(email: string): Promise<boolean>;
    /**
     * Get user roles
     */
    getRoles(userId: string): Promise<string[]>;
    /**
     * Add role to user
     */
    addRole(userId: string, roleName: string): Promise<void>;
    /**
     * Remove role from user
     */
    removeRole(userId: string, roleName: string): Promise<void>;
}
/**
 * Sessions Repository - handles session/refresh token management
 */
export declare class SessionsRepository {
    /**
     * Create a new session
     */
    create(data: {
        userId: string;
        refreshToken: string;
        userAgent?: string;
        ipAddress?: string;
        expiresAt: Date;
    }): Promise<Session>;
    /**
     * Find session by refresh token
     */
    findByRefreshToken(refreshToken: string): Promise<Session | null>;
    /**
     * Find all sessions for a user
     */
    findByUserId(userId: string): Promise<Session[]>;
    /**
     * Delete session by refresh token
     */
    deleteByRefreshToken(refreshToken: string): Promise<Session | null>;
    /**
     * Delete all sessions for a user
     */
    deleteAllByUserId(userId: string): Promise<number>;
    /**
     * Delete expired sessions
     */
    deleteExpired(): Promise<number>;
    /**
     * Check if session is valid (exists and not expired)
     */
    isValid(refreshToken: string): Promise<boolean>;
}
export declare const usersRepository: UsersRepository;
export declare const sessionsRepository: SessionsRepository;
//# sourceMappingURL=users.repository.d.ts.map