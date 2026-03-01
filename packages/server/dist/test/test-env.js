export function ensureServerTestEnv() {
    var _a, _b, _c;
    process.env.NODE_ENV = 'test';
    (_a = process.env).DATABASE_URL || (_a.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/ssrprompt_test');
    (_b = process.env).JWT_SECRET || (_b.JWT_SECRET = 'test_jwt_secret_12345678901234567890');
    (_c = process.env).ENCRYPTION_KEY || (_c.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
}
//# sourceMappingURL=test-env.js.map