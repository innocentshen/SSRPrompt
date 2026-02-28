import { Buffer } from 'buffer';
import { env } from '../config/env.js';
import { oauthAccountsRepository } from '../repositories/oauth-accounts.repository.js';
import { usersRepository } from '../repositories/users.repository.js';
import { authService } from './auth.service.js';
import { encrypt } from '../utils/crypto.js';
import { AppError, ValidationError } from '@ssrprompt/shared';
function providerToEnum(provider) {
    return provider;
}
function getSyntheticEmail(provider, providerUserId) {
    return `${provider}+${providerUserId}@users.ssrprompt.local`;
}
export class OAuthService {
    getAuthorizeUrl(provider, state) {
        if (provider === 'google') {
            if (!env.OAUTH_GOOGLE_ENABLED) {
                throw new AppError(400, 'INVALID_REQUEST', 'Google OAuth 未启用');
            }
            const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
            url.searchParams.set('client_id', env.OAUTH_GOOGLE_CLIENT_ID);
            url.searchParams.set('redirect_uri', env.OAUTH_GOOGLE_CALLBACK_URL);
            url.searchParams.set('response_type', 'code');
            url.searchParams.set('scope', 'openid email profile');
            url.searchParams.set('state', state);
            url.searchParams.set('access_type', 'offline');
            url.searchParams.set('prompt', 'consent');
            return url.toString();
        }
        if (!env.OAUTH_LINUXDO_ENABLED) {
            throw new AppError(400, 'INVALID_REQUEST', 'Linux.do OAuth 未启用');
        }
        const url = new URL('https://connect.linux.do/oauth2/authorize');
        url.searchParams.set('client_id', env.OAUTH_LINUXDO_CLIENT_ID);
        url.searchParams.set('redirect_uri', env.OAUTH_LINUXDO_CALLBACK_URL);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('state', state);
        return url.toString();
    }
    async handleCallback(provider, code, meta) {
        const tokens = await this.exchangeCodeForTokens(provider, code);
        const profile = await this.fetchUserProfile(provider, tokens.accessToken);
        const userId = await this.upsertOAuthAccount(provider, profile, tokens);
        return authService.createAuthResponseForUser(userId, meta);
    }
    async exchangeCodeForTokens(provider, code) {
        if (provider === 'google') {
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: env.OAUTH_GOOGLE_CLIENT_ID,
                    client_secret: env.OAUTH_GOOGLE_CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: env.OAUTH_GOOGLE_CALLBACK_URL,
                }),
            });
            if (!response.ok) {
                throw new AppError(502, 'PROVIDER_ERROR', 'Google OAuth token exchange failed');
            }
            const data = (await response.json());
            if (!data.access_token) {
                throw new ValidationError('Google OAuth token response missing access_token');
            }
            return {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
            };
        }
        const basic = Buffer.from(`${env.OAUTH_LINUXDO_CLIENT_ID}:${env.OAUTH_LINUXDO_CLIENT_SECRET}`).toString('base64');
        const response = await fetch('https://connect.linux.do/oauth2/token', {
            method: 'POST',
            headers: {
                Authorization: `Basic ${basic}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: env.OAUTH_LINUXDO_CALLBACK_URL,
            }),
        });
        if (!response.ok) {
            throw new AppError(502, 'PROVIDER_ERROR', 'Linux.do OAuth token exchange failed');
        }
        const data = (await response.json());
        if (!data.access_token) {
            throw new ValidationError('Linux.do OAuth token response missing access_token');
        }
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
        };
    }
    async fetchUserProfile(provider, accessToken) {
        if (provider === 'google') {
            const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (!response.ok) {
                throw new AppError(502, 'PROVIDER_ERROR', 'Failed to fetch Google user profile');
            }
            const data = (await response.json());
            if (!data.sub) {
                throw new ValidationError('Google user profile missing sub');
            }
            return {
                providerUserId: data.sub,
                providerEmail: data.email,
                name: data.name,
                avatar: data.picture,
            };
        }
        const response = await fetch('https://connect.linux.do/api/user', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) {
            throw new AppError(502, 'PROVIDER_ERROR', 'Failed to fetch Linux.do user profile');
        }
        const data = (await response.json());
        if (!data.id) {
            throw new ValidationError('Linux.do user profile missing id');
        }
        const providerUserId = String(data.id);
        return {
            providerUserId,
            name: data.name || data.username,
            avatar: data.avatar_template,
        };
    }
    async upsertOAuthAccount(provider, profile, tokens) {
        const providerEnum = providerToEnum(provider);
        const existing = await oauthAccountsRepository.findByProviderAccountId(providerEnum, profile.providerUserId);
        if (existing) {
            await oauthAccountsRepository.update(existing.id, {
                providerEmail: profile.providerEmail ?? null,
                name: profile.name ?? null,
                avatar: profile.avatar ?? null,
                accessTokenEncrypted: encrypt(tokens.accessToken),
                refreshTokenEncrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
                expiresAt: tokens.expiresAt ?? null,
            });
            return existing.userId;
        }
        const email = profile.providerEmail || getSyntheticEmail(provider, profile.providerUserId);
        const byEmail = await usersRepository.findByEmail(email);
        if (byEmail) {
            await oauthAccountsRepository.create({
                userId: byEmail.id,
                provider: providerEnum,
                providerUserId: profile.providerUserId,
                providerEmail: profile.providerEmail ?? null,
                name: profile.name ?? null,
                avatar: profile.avatar ?? null,
                accessTokenEncrypted: encrypt(tokens.accessToken),
                refreshTokenEncrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
                expiresAt: tokens.expiresAt ?? null,
            });
            return byEmail.id;
        }
        if (!env.ALLOW_REGISTRATION) {
            throw new AppError(403, 'REGISTRATION_DISABLED', '管理员已关闭注册渠道');
        }
        const created = await usersRepository.createWithRole({
            email,
            name: profile.name,
            avatar: profile.avatar,
            emailVerified: provider === 'google' ? true : false,
        }, 'user');
        await oauthAccountsRepository.create({
            userId: created.id,
            provider: providerEnum,
            providerUserId: profile.providerUserId,
            providerEmail: profile.providerEmail ?? null,
            name: profile.name ?? null,
            avatar: profile.avatar ?? null,
            accessTokenEncrypted: encrypt(tokens.accessToken),
            refreshTokenEncrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
            expiresAt: tokens.expiresAt ?? null,
        });
        return created.id;
    }
}
export const oauthService = new OAuthService();
//# sourceMappingURL=oauth.service.js.map