import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureServerTestEnv } from '../test/test-env.js';

test('refreshTokens consumes refresh token atomically (single-use)', async (t) => {
  ensureServerTestEnv();

  const { AuthService } = await import('./auth.service.js');
  const { sessionsRepository, usersRepository } = await import('../repositories/users.repository.js');

  let consumeCount = 0;
  t.mock.method(sessionsRepository, 'consumeByRefreshToken', async () => {
    if (consumeCount > 0) return null;
    consumeCount += 1;
    return {
      id: 'session-1',
      userId: 'user-1',
      refreshToken: 'rt',
      userAgent: null,
      ipAddress: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });

  t.mock.method(usersRepository, 'findByIdWithRoles', async () => ({
    id: 'user-1',
    email: 'test@example.com',
    passwordHash: 'hashed',
    name: null,
    avatar: null,
    status: 'active',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
    roles: [{ userId: 'user-1', roleId: 'role-1', createdAt: new Date(), role: { id: 'role-1', name: 'user', description: null, isSystem: false, createdAt: new Date() } }],
  } as any));

  t.mock.method(AuthService.prototype as unknown as { generateTokenPair: () => Promise<unknown> }, 'generateTokenPair', async () => ({
    accessToken: 'access-token',
    refreshToken: 'new-refresh-token',
    expiresAt: Date.now() + 60_000,
  }));

  const service = new AuthService();
  const results = await Promise.allSettled([
    service.refreshTokens('rt'),
    service.refreshTokens('rt'),
  ]);

  const fulfilled = results.filter((item) => item.status === 'fulfilled');
  const rejected = results.filter((item) => item.status === 'rejected') as PromiseRejectedResult[];

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match((rejected[0].reason as Error).message, /Invalid refresh token/);
});
