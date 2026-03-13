export function ensureServerTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/ssrprompt_test';
  process.env.JWT_SECRET ||= 'test_jwt_secret_12345678901234567890';
  process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.ADMIN_EMAIL ||= 'admin@example.com';
  process.env.ADMIN_PASSWORD ||= 'test-admin-password';
}
