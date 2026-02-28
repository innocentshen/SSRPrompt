import { Router } from 'express';
import { randomBytes } from 'crypto';
import { generateDemoToken, authenticateJWT } from '../middleware/auth.js';
import { authService } from '../services/auth.service.js';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { RegisterSchema, LoginSchema, RefreshTokenSchema, ChangePasswordSchema, SendCodeSchema, ForgotPasswordSchema, ResetPasswordSchema, } from '@ssrprompt/shared';
import { ValidationError, AppError, ConflictError } from '@ssrprompt/shared';
import { asyncHandler } from '../utils/async-handler.js';
import rateLimit from 'express-rate-limit';
import { verificationService } from '../services/verification.service.js';
import { usersRepository } from '../repositories/users.repository.js';
import { oauthService } from '../services/oauth.service.js';
function parseCookies(cookieHeader) {
    if (!cookieHeader)
        return {};
    return cookieHeader.split(';').reduce((acc, part) => {
        const [key, ...rest] = part.trim().split('=');
        if (!key)
            return acc;
        acc[key] = rest.join('=');
        return acc;
    }, {});
}
function setCookie(res, name, value, options) {
    const parts = [`${name}=${value}`, `Path=${options.path}`, `Max-Age=${options.maxAgeSeconds}`];
    if (options.httpOnly)
        parts.push('HttpOnly');
    if (options.sameSite)
        parts.push(`SameSite=${options.sameSite}`);
    if (options.secure)
        parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
}
function clearCookie(res, name, path) {
    res.setHeader('Set-Cookie', `${name}=; Path=${path}; Max-Age=0; HttpOnly; SameSite=Lax`);
}
function resolveOauthRedirect(rawRedirect) {
    const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
    const defaultOrigin = allowedOrigins[0] || 'http://localhost:5173';
    if (!rawRedirect) {
        return new URL('/oauth/callback', defaultOrigin).toString();
    }
    if (rawRedirect.startsWith('/')) {
        return new URL(rawRedirect, defaultOrigin).toString();
    }
    let url;
    try {
        url = new URL(rawRedirect);
    }
    catch {
        throw new ValidationError('Invalid redirect URL');
    }
    if (!allowedOrigins.includes(url.origin)) {
        throw new ValidationError('Invalid redirect URL');
    }
    return url.toString();
}
const router = Router();
// Rate limiting for auth endpoints
const loginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    handler: (req, res) => {
        res.status(429).json({
            error: {
                code: 'RATE_LIMIT_EXCEEDED',
                message: '登录尝试次数过多，请稍后再试',
                requestId: req.requestId,
            },
        });
    },
    standardHeaders: true,
    legacyHeaders: false,
});
const registerRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 registrations per hour per IP
    handler: (req, res) => {
        res.status(429).json({
            error: {
                code: 'RATE_LIMIT_EXCEEDED',
                message: '注册尝试次数过多，请稍后再试',
                requestId: req.requestId,
            },
        });
    },
    standardHeaders: true,
    legacyHeaders: false,
});
const sendCodeRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 send attempts per window per IP
    handler: (req, res) => {
        res.status(429).json({
            error: {
                code: 'RATE_LIMIT_EXCEEDED',
                message: '验证码发送过于频繁，请稍后再试',
                requestId: req.requestId,
            },
        });
    },
    standardHeaders: true,
    legacyHeaders: false,
});
/**
 * @swagger
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: 用户注册
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: 注册成功
 *       400:
 *         description: 验证错误
 *       409:
 *         description: 邮箱已存在
 */
router.post('/register', registerRateLimit, asyncHandler(async (req, res) => {
    // Check if registration is allowed
    if (!env.ALLOW_REGISTRATION) {
        throw new AppError(403, 'REGISTRATION_DISABLED', '管理员已关闭注册渠道');
    }
    const result = RegisterSchema.safeParse(req.body);
    if (!result.success) {
        throw new ValidationError('Validation failed', result.error.flatten().fieldErrors);
    }
    const response = await authService.register(result.data);
    res.status(201).json({ data: response });
}));
/**
 * @swagger
 * /auth/send-code:
 *   post:
 *     tags: [Auth]
 *     summary: 发送邮箱验证码（注册/重置密码）
 *     security: []
 */
router.post('/send-code', sendCodeRateLimit, asyncHandler(async (req, res) => {
    const result = SendCodeSchema.safeParse(req.body);
    if (!result.success) {
        throw new ValidationError('Validation failed', result.error.flatten().fieldErrors);
    }
    const { email, type } = result.data;
    if (type === 'register') {
        if (!env.ALLOW_REGISTRATION) {
            throw new AppError(403, 'REGISTRATION_DISABLED', '管理员已关闭注册渠道');
        }
        if (!env.REQUIRE_EMAIL_VERIFICATION) {
            throw new AppError(400, 'INVALID_REQUEST', '邮箱验证码注册未开启');
        }
        const exists = await usersRepository.emailExists(email);
        if (exists) {
            throw new ConflictError('Email already registered');
        }
        const response = await verificationService.sendCode(email, 'register');
        res.json({ data: response });
        return;
    }
    // reset_password: do not reveal whether email exists
    await authService.sendPasswordResetCode(email);
    res.json({ data: { success: true, expiresIn: 15 * 60 } });
}));
/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: 忘记密码（发送重置验证码）
 *     security: []
 */
router.post('/forgot-password', sendCodeRateLimit, asyncHandler(async (req, res) => {
    const result = ForgotPasswordSchema.safeParse(req.body);
    if (!result.success) {
        throw new ValidationError('Validation failed', result.error.flatten().fieldErrors);
    }
    await authService.sendPasswordResetCode(result.data.email);
    res.json({ data: { success: true, expiresIn: 15 * 60 } });
}));
/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: 重置密码（验证码+新密码）
 *     security: []
 */
router.post('/reset-password', asyncHandler(async (req, res) => {
    const result = ResetPasswordSchema.safeParse(req.body);
    if (!result.success) {
        throw new ValidationError('Validation failed', result.error.flatten().fieldErrors);
    }
    await authService.resetPassword(result.data.email, result.data.code, result.data.newPassword);
    res.json({ data: { success: true } });
}));
/**
 * @swagger
 * /auth/oauth/google:
 *   get:
 *     tags: [Auth]
 *     summary: Google OAuth 登录（跳转）
 *     security: []
 */
router.get('/oauth/google', asyncHandler(async (req, res) => {
    if (!env.OAUTH_GOOGLE_ENABLED) {
        throw new AppError(400, 'INVALID_REQUEST', 'Google OAuth 未启用');
    }
    const state = randomBytes(16).toString('hex');
    const redirect = resolveOauthRedirect(typeof req.query.redirect === 'string' ? req.query.redirect : undefined);
    const cookie = { nonce: state, redirect };
    const cookieValue = Buffer.from(JSON.stringify(cookie), 'utf8').toString('base64url');
    setCookie(res, 'oauth_state_google', cookieValue, {
        path: '/api/v1/auth/oauth/google/callback',
        maxAgeSeconds: 5 * 60,
        httpOnly: true,
        sameSite: 'Lax',
        secure: env.NODE_ENV === 'production',
    });
    res.redirect(oauthService.getAuthorizeUrl('google', state));
}));
/**
 * @swagger
 * /auth/oauth/google/callback:
 *   get:
 *     tags: [Auth]
 *     summary: Google OAuth 回调
 *     security: []
 */
router.get('/oauth/google/callback', asyncHandler(async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const cookieName = 'oauth_state_google';
    const cookiePath = '/api/v1/auth/oauth/google/callback';
    let redirectUrl = resolveOauthRedirect();
    let expectedState = null;
    const rawCookie = cookies[cookieName];
    if (rawCookie) {
        try {
            const decoded = Buffer.from(rawCookie, 'base64url').toString('utf8');
            const parsed = JSON.parse(decoded);
            if (parsed.redirect)
                redirectUrl = parsed.redirect;
            if (parsed.nonce)
                expectedState = parsed.nonce;
        }
        catch {
            // Ignore cookie parse errors; fall back to default redirect.
        }
    }
    clearCookie(res, cookieName, cookiePath);
    const oauthError = typeof req.query.error === 'string' ? req.query.error : undefined;
    if (oauthError) {
        const url = new URL(redirectUrl);
        url.searchParams.set('error', oauthError);
        res.redirect(url.toString());
        return;
    }
    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    if (!code || !state || !expectedState || state !== expectedState) {
        const url = new URL(redirectUrl);
        url.searchParams.set('error', 'Invalid OAuth state');
        res.redirect(url.toString());
        return;
    }
    try {
        const auth = await oauthService.handleCallback('google', code, {
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip,
        });
        const url = new URL(redirectUrl);
        url.searchParams.set('accessToken', auth.accessToken);
        url.searchParams.set('refreshToken', auth.refreshToken);
        url.searchParams.set('expiresAt', String(auth.expiresAt));
        res.redirect(url.toString());
    }
    catch (error) {
        const url = new URL(redirectUrl);
        url.searchParams.set('error', error instanceof Error ? error.message : 'OAuth login failed');
        res.redirect(url.toString());
    }
}));
/**
 * @swagger
 * /auth/oauth/linuxdo:
 *   get:
 *     tags: [Auth]
 *     summary: Linux.do OAuth 登录（跳转）
 *     security: []
 */
router.get('/oauth/linuxdo', asyncHandler(async (req, res) => {
    if (!env.OAUTH_LINUXDO_ENABLED) {
        throw new AppError(400, 'INVALID_REQUEST', 'Linux.do OAuth 未启用');
    }
    const state = randomBytes(16).toString('hex');
    const redirect = resolveOauthRedirect(typeof req.query.redirect === 'string' ? req.query.redirect : undefined);
    const cookie = { nonce: state, redirect };
    const cookieValue = Buffer.from(JSON.stringify(cookie), 'utf8').toString('base64url');
    setCookie(res, 'oauth_state_linuxdo', cookieValue, {
        path: '/api/v1/auth/oauth/linuxdo/callback',
        maxAgeSeconds: 5 * 60,
        httpOnly: true,
        sameSite: 'Lax',
        secure: env.NODE_ENV === 'production',
    });
    res.redirect(oauthService.getAuthorizeUrl('linuxdo', state));
}));
/**
 * @swagger
 * /auth/oauth/linuxdo/callback:
 *   get:
 *     tags: [Auth]
 *     summary: Linux.do OAuth 回调
 *     security: []
 */
router.get('/oauth/linuxdo/callback', asyncHandler(async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const cookieName = 'oauth_state_linuxdo';
    const cookiePath = '/api/v1/auth/oauth/linuxdo/callback';
    let redirectUrl = resolveOauthRedirect();
    let expectedState = null;
    const rawCookie = cookies[cookieName];
    if (rawCookie) {
        try {
            const decoded = Buffer.from(rawCookie, 'base64url').toString('utf8');
            const parsed = JSON.parse(decoded);
            if (parsed.redirect)
                redirectUrl = parsed.redirect;
            if (parsed.nonce)
                expectedState = parsed.nonce;
        }
        catch {
            // Ignore cookie parse errors; fall back to default redirect.
        }
    }
    clearCookie(res, cookieName, cookiePath);
    const oauthError = typeof req.query.error === 'string' ? req.query.error : undefined;
    if (oauthError) {
        const url = new URL(redirectUrl);
        url.searchParams.set('error', oauthError);
        res.redirect(url.toString());
        return;
    }
    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    if (!code || !state || !expectedState || state !== expectedState) {
        const url = new URL(redirectUrl);
        url.searchParams.set('error', 'Invalid OAuth state');
        res.redirect(url.toString());
        return;
    }
    try {
        const auth = await oauthService.handleCallback('linuxdo', code, {
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip,
        });
        const url = new URL(redirectUrl);
        url.searchParams.set('accessToken', auth.accessToken);
        url.searchParams.set('refreshToken', auth.refreshToken);
        url.searchParams.set('expiresAt', String(auth.expiresAt));
        res.redirect(url.toString());
    }
    catch (error) {
        const url = new URL(redirectUrl);
        url.searchParams.set('error', error instanceof Error ? error.message : 'OAuth login failed');
        res.redirect(url.toString());
    }
}));
/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: 用户登录
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: 登录成功
 *       401:
 *         description: 认证失败
 */
router.post('/login', loginRateLimit, asyncHandler(async (req, res) => {
    const result = LoginSchema.safeParse(req.body);
    if (!result.success) {
        throw new ValidationError('Validation failed', result.error.flatten().fieldErrors);
    }
    const { email, password } = result.data;
    const response = await authService.login(email, password, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
    });
    res.json({ data: response });
}));
/**
 * @swagger
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: 退出登录
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: 退出成功
 */
router.post('/logout', asyncHandler(async (req, res) => {
    const result = RefreshTokenSchema.safeParse(req.body);
    if (!result.success) {
        // Silent fail for logout
        res.json({ data: { success: true } });
        return;
    }
    await authService.logout(result.data.refreshToken);
    res.json({ data: { success: true } });
}));
/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: 刷新访问令牌
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: 刷新成功
 *       401:
 *         description: 刷新令牌无效或已过期
 */
router.post('/refresh', asyncHandler(async (req, res) => {
    const result = RefreshTokenSchema.safeParse(req.body);
    if (!result.success) {
        throw new ValidationError('Validation failed', result.error.flatten().fieldErrors);
    }
    const tokens = await authService.refreshTokens(result.data.refreshToken, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
    });
    res.json({ data: tokens });
}));
/**
 * @swagger
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: 获取当前用户信息
 *     responses:
 *       200:
 *         description: 成功
 *       401:
 *         description: 未认证
 */
router.get('/me', authenticateJWT, asyncHandler(async (req, res) => {
    // For demo users, return minimal info
    if (req.user?.isDemo) {
        res.json({
            data: {
                id: req.user.userId,
                email: '',
                status: 'active',
                emailVerified: false,
                isDemo: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        });
        return;
    }
    const user = await authService.getCurrentUser(req.user.userId);
    res.json({ data: user });
}));
/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: 修改密码
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: 修改成功
 *       401:
 *         description: 当前密码错误
 */
router.post('/change-password', authenticateJWT, asyncHandler(async (req, res) => {
    if (req.user?.isDemo) {
        throw new ValidationError('Demo users cannot change password');
    }
    const result = ChangePasswordSchema.safeParse(req.body);
    if (!result.success) {
        throw new ValidationError('Validation failed', result.error.flatten().fieldErrors);
    }
    await authService.changePassword(req.user.userId, result.data.currentPassword, result.data.newPassword);
    res.json({ data: { success: true } });
}));
/**
 * @swagger
 * /auth/demo-token:
 *   get:
 *     tags: [Auth]
 *     summary: 获取 Demo Token
 *     security: []
 *     responses:
 *       200:
 *         description: 成功
 */
router.get('/demo-token', asyncHandler(async (_req, res) => {
    const { token, userId } = generateDemoToken();
    // Ensure a corresponding user row exists so demo sessions can use the normal tenant isolation layer.
    // Demo users have no password and are cleaned up by scripts/cleanup-demo.ts.
    await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: {
            id: userId,
            email: `${userId}@demo.local`,
            name: 'Demo User',
            status: 'active',
            emailVerified: false,
        },
    });
    res.json({
        data: {
            token,
            user: {
                id: userId,
                tenantType: 'demo',
            },
        },
    });
}));
/**
 * @swagger
 * /auth/config:
 *   get:
 *     tags: [Auth]
 *     summary: 获取公共配置
 *     security: []
 *     responses:
 *       200:
 *         description: 成功
 */
router.get('/config', asyncHandler(async (_req, res) => {
    res.json({
        data: {
            allowRegistration: env.ALLOW_REGISTRATION,
            requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
            oauth: {
                google: { enabled: env.OAUTH_GOOGLE_ENABLED },
                linuxdo: { enabled: env.OAUTH_LINUXDO_ENABLED },
            },
        },
    });
}));
export default router;
//# sourceMappingURL=auth.routes.js.map