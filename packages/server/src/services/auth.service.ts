import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID, randomBytes } from 'crypto';
import { env } from '../config/env.js';
import { usersRepository, sessionsRepository, type UserWithRoles } from '../repositories/users.repository.js';
import { UnauthorizedError, ConflictError, NotFoundError, ValidationError } from '@ssrprompt/shared';
import type { User, AuthResponse, TokenPair, JwtPayload } from '@ssrprompt/shared';
import { verificationService } from './verification.service.js';

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '24h';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

/**
 * Auth Service - handles authentication logic
 */
export class AuthService {
  /**
   * Register a new user with email/password
   */
  async register(data: {
    email: string;
    password: string;
    name?: string;
    code?: string;
  }): Promise<AuthResponse> {
    // Check if email already exists
    const existingUser = await usersRepository.findByEmail(data.email);
    if (existingUser) {
      throw new ConflictError('Email already registered');
    }

    if (env.REQUIRE_EMAIL_VERIFICATION) {
      if (!data.code) {
        throw new ValidationError('Validation failed', { code: ['请输入邮箱验证码'] });
      }
      await verificationService.verifyCode(data.email, 'register', data.code);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    // Create user with default role
    const user = await usersRepository.createWithRole(
      {
        email: data.email,
        passwordHash,
        name: data.name,
        emailVerified: env.REQUIRE_EMAIL_VERIFICATION ? true : undefined,
      },
      'user'
    );

    // Generate tokens
    const tokens = await this.generateTokenPair(user);

    return {
      user: this.formatUser(user),
      ...tokens,
    };
  }

  /**
   * Login with email/password
   */
  async login(
    email: string,
    password: string,
    meta?: { userAgent?: string; ipAddress?: string }
  ): Promise<AuthResponse> {
    // Find user
    const user = await usersRepository.findByEmailWithRoles(email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Check if user has password (not OAuth-only user)
    if (!user.passwordHash) {
      throw new UnauthorizedError('Please login with your social account');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Check user status
    if (user.status === 'suspended') {
      throw new UnauthorizedError('账号已被禁用，请联系管理员');
    }
    if (user.status === 'inactive') {
      throw new UnauthorizedError('账号未激活');
    }

    // Update last login
    await usersRepository.updateLastLogin(user.id);

    // Generate tokens
    const tokens = await this.generateTokenPair(user, meta);

    return {
      user: this.formatUser(user),
      ...tokens,
    };
  }

  /**
   * Issue tokens for an existing user (used by OAuth login)
   */
  async createAuthResponseForUser(
    userId: string,
    meta?: { userAgent?: string; ipAddress?: string }
  ): Promise<AuthResponse> {
    const user = await usersRepository.findByIdWithRoles(userId);
    if (!user) {
      throw new NotFoundError('User', userId);
    }

    if (user.status === 'suspended') {
      throw new UnauthorizedError('账号已被禁用，请联系管理员');
    }
    if (user.status === 'inactive') {
      throw new UnauthorizedError('账号未激活');
    }

    await usersRepository.updateLastLogin(user.id);
    const tokens = await this.generateTokenPair(user, meta);

    return {
      user: this.formatUser(user),
      ...tokens,
    };
  }

  /**
   * Logout - invalidate refresh token
   */
  async logout(refreshToken: string): Promise<void> {
    await sessionsRepository.deleteByRefreshToken(refreshToken);
  }

  /**
   * Logout all sessions for a user
   */
  async logoutAll(userId: string): Promise<number> {
    return sessionsRepository.deleteAllByUserId(userId);
  }

  /**
   * Refresh access token
   */
  async refreshTokens(
    refreshToken: string,
    meta?: { userAgent?: string; ipAddress?: string }
  ): Promise<TokenPair> {
    // Atomically consume session so one refresh token can only be used once.
    const session = await sessionsRepository.consumeByRefreshToken(refreshToken);
    if (!session) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Check if expired
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedError('Refresh token expired');
    }

    // Get user with roles
    const user = await usersRepository.findByIdWithRoles(session.userId);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedError('User not found or inactive');
    }

    // Generate new token pair
    return this.generateTokenPair(user, meta);
  }

  /**
   * Get current user info
   */
  async getCurrentUser(userId: string): Promise<User> {
    const user = await usersRepository.findByIdWithRoles(userId);
    if (!user) {
      throw new NotFoundError('User', userId);
    }
    return this.formatUser(user);
  }

  /**
   * Change password
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const user = await usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User', userId);
    }

    if (!user.passwordHash) {
      throw new UnauthorizedError('Cannot change password for social login accounts');
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password
    await usersRepository.update(userId, { passwordHash: newPasswordHash });

    // Invalidate all sessions
    await sessionsRepository.deleteAllByUserId(userId);
  }

  /**
   * Send password reset verification code (no-op if user does not exist)
   */
  async sendPasswordResetCode(email: string): Promise<{ success: true; expiresIn: number } | null> {
    const user = await usersRepository.findByEmail(email);
    if (!user) return null;
    return verificationService.sendCode(email, 'reset_password');
  }

  /**
   * Reset password using email verification code
   */
  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    await verificationService.verifyCode(email, 'reset_password', code);

    const user = await usersRepository.findByEmail(email);
    if (!user) {
      // Avoid leaking whether the email exists
      throw new ValidationError('验证码无效或已过期');
    }

    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await usersRepository.update(user.id, { passwordHash: newPasswordHash, emailVerified: true });
    await sessionsRepository.deleteAllByUserId(user.id);
  }

  /**
   * Generate demo token
   */
  generateDemoToken(): { token: string; userId: string } {
    const userId = `demo_${randomUUID()}`;
    const payload: Partial<JwtPayload> = {
      userId,
      tenantType: 'demo',
      isDemo: true,
    };

    const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });
    return { token, userId };
  }

  /**
   * Generate access token and refresh token
   */
  private async generateTokenPair(
    user: UserWithRoles,
    meta?: { userAgent?: string; ipAddress?: string }
  ): Promise<TokenPair> {
    const roles = user.roles.map((r) => r.role.name);

    // Access token
    const accessTokenPayload: Partial<JwtPayload> = {
      userId: user.id,
      email: user.email,
      tenantType: 'personal',
      isDemo: false,
      roles,
    };

    const accessToken = jwt.sign(accessTokenPayload, env.JWT_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });

    // Refresh token
    const refreshToken = randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    // Save session
    await sessionsRepository.create({
      userId: user.id,
      refreshToken,
      userAgent: meta?.userAgent,
      ipAddress: meta?.ipAddress,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      expiresAt: expiresAt.getTime(),
    };
  }

  /**
   * Format user for API response
   */
  private formatUser(user: UserWithRoles): User {
    return {
      id: user.id,
      email: user.email,
      name: user.name ?? undefined,
      avatar: user.avatar ?? undefined,
      status: user.status,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString(),
      roles: user.roles.map((r) => r.role.name),
    };
  }
}

// Export singleton instance
export const authService = new AuthService();
