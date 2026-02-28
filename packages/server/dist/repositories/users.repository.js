import { prisma } from '../config/database.js';
import { NotFoundError } from '@ssrprompt/shared';
/**
 * Users Repository - handles user CRUD operations
 */
export class UsersRepository {
    /**
     * Find user by ID
     */
    async findById(id) {
        return prisma.user.findUnique({
            where: { id },
        });
    }
    /**
     * Find user by ID with roles
     */
    async findByIdWithRoles(id) {
        return prisma.user.findUnique({
            where: { id },
            include: {
                roles: {
                    include: {
                        role: true,
                    },
                },
            },
        });
    }
    /**
     * Find user by email
     */
    async findByEmail(email) {
        return prisma.user.findUnique({
            where: { email },
        });
    }
    /**
     * Find user by email with roles
     */
    async findByEmailWithRoles(email) {
        return prisma.user.findUnique({
            where: { email },
            include: {
                roles: {
                    include: {
                        role: true,
                    },
                },
            },
        });
    }
    /**
     * Create a new user
     */
    async create(data) {
        return prisma.user.create({
            data: {
                email: data.email,
                passwordHash: data.passwordHash,
                name: data.name,
                avatar: data.avatar,
                emailVerified: data.emailVerified,
            },
        });
    }
    /**
     * Create user with default role
     */
    async createWithRole(data, roleName = 'user') {
        // Find the role
        const role = await prisma.role.findUnique({
            where: { name: roleName },
        });
        if (!role) {
            throw new NotFoundError('Role', roleName);
        }
        return prisma.user.create({
            data: {
                email: data.email,
                passwordHash: data.passwordHash,
                name: data.name,
                avatar: data.avatar,
                emailVerified: data.emailVerified,
                roles: {
                    create: {
                        roleId: role.id,
                    },
                },
            },
            include: {
                roles: {
                    include: {
                        role: true,
                    },
                },
            },
        });
    }
    /**
     * Update user
     */
    async update(id, data) {
        return prisma.user.update({
            where: { id },
            data,
        });
    }
    /**
     * Update last login timestamp
     */
    async updateLastLogin(id) {
        return prisma.user.update({
            where: { id },
            data: { lastLoginAt: new Date() },
        });
    }
    /**
     * Delete user
     */
    async delete(id) {
        return prisma.user.delete({
            where: { id },
        });
    }
    /**
     * Check if email exists
     */
    async emailExists(email) {
        const count = await prisma.user.count({
            where: { email },
        });
        return count > 0;
    }
    /**
     * Get user roles
     */
    async getRoles(userId) {
        const userRoles = await prisma.userRole.findMany({
            where: { userId },
            include: { role: true },
        });
        return userRoles.map((ur) => ur.role.name);
    }
    /**
     * Add role to user
     */
    async addRole(userId, roleName) {
        const role = await prisma.role.findUnique({
            where: { name: roleName },
        });
        if (!role) {
            throw new NotFoundError('Role', roleName);
        }
        await prisma.userRole.create({
            data: {
                userId,
                roleId: role.id,
            },
        });
    }
    /**
     * Remove role from user
     */
    async removeRole(userId, roleName) {
        const role = await prisma.role.findUnique({
            where: { name: roleName },
        });
        if (!role) {
            throw new NotFoundError('Role', roleName);
        }
        await prisma.userRole.delete({
            where: {
                userId_roleId: {
                    userId,
                    roleId: role.id,
                },
            },
        });
    }
}
/**
 * Sessions Repository - handles session/refresh token management
 */
export class SessionsRepository {
    /**
     * Create a new session
     */
    async create(data) {
        return prisma.session.create({
            data: {
                userId: data.userId,
                refreshToken: data.refreshToken,
                userAgent: data.userAgent,
                ipAddress: data.ipAddress,
                expiresAt: data.expiresAt,
            },
        });
    }
    /**
     * Find session by refresh token
     */
    async findByRefreshToken(refreshToken) {
        return prisma.session.findUnique({
            where: { refreshToken },
        });
    }
    /**
     * Find all sessions for a user
     */
    async findByUserId(userId) {
        return prisma.session.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });
    }
    /**
     * Delete session by refresh token
     */
    async deleteByRefreshToken(refreshToken) {
        try {
            return await prisma.session.delete({
                where: { refreshToken },
            });
        }
        catch {
            return null;
        }
    }
    /**
     * Delete all sessions for a user
     */
    async deleteAllByUserId(userId) {
        const result = await prisma.session.deleteMany({
            where: { userId },
        });
        return result.count;
    }
    /**
     * Delete expired sessions
     */
    async deleteExpired() {
        const result = await prisma.session.deleteMany({
            where: {
                expiresAt: { lt: new Date() },
            },
        });
        return result.count;
    }
    /**
     * Check if session is valid (exists and not expired)
     */
    async isValid(refreshToken) {
        const session = await prisma.session.findUnique({
            where: { refreshToken },
        });
        if (!session) {
            return false;
        }
        return session.expiresAt > new Date();
    }
}
// Export singleton instances
export const usersRepository = new UsersRepository();
export const sessionsRepository = new SessionsRepository();
//# sourceMappingURL=users.repository.js.map