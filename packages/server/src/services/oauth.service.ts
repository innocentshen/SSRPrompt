import { Buffer } from 'buffer';
import { env } from '../config/env.js';
import { oauthAccountsRepository } from '../repositories/oauth-accounts.repository.js';
import { usersRepository } from '../repositories/users.repository.js';
import { authService } from './auth.service.js';
import { encrypt } from '../utils/crypto.js';
import { AppError, ValidationError } from '@ssrprompt/shared';
import type { OAuthProvider } from '@prisma/client';

type ProviderId = 'google' | 'linuxdo';

type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
};

type OAuthProfile = {
  providerUserId: string;
  providerEmail?: string;
  name?: string;
  avatar?: string;
};

function providerDisplayName(provider: ProviderId): string {
  return provider === 'google' ? 'Google' : 'Linux.do';
}

function formatNetworkErrorCause(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;

  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const maybeCode = (cause as { code?: unknown }).code;
    const code = typeof maybeCode === 'string' ? maybeCode : undefined;
    return code ? `${cause.message} (${code})` : cause.message;
  }

  if (typeof cause === 'string' && cause.trim().length > 0) return cause.trim();

  // Fall back to the error message when we don't have a richer underlying cause.
  const message = error.message?.trim();
  if (message && message !== 'fetch failed') return message;

  return undefined;
}

async function fetchOrThrow(provider: ProviderId, stage: string, input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (error) {
    const detail = formatNetworkErrorCause(error) || (error instanceof Error ? error.message : String(error));
    throw new AppError(
      502,
      'PROVIDER_ERROR',
      `${providerDisplayName(provider)} OAuth request failed (${stage}). ${detail}`
    );
  }
}

function providerToEnum(provider: ProviderId): OAuthProvider {
  return provider;
}

function getSyntheticEmail(provider: ProviderId, providerUserId: string): string {
  return `${provider}+${providerUserId}@users.ssrprompt.local`;
}

export class OAuthService {
  getAuthorizeUrl(provider: ProviderId, state: string): string {
    if (provider === 'google') {
      if (!env.OAUTH_GOOGLE_ENABLED) {
        throw new AppError(400, 'INVALID_REQUEST', 'Google OAuth 未启用');
      }

      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', env.OAUTH_GOOGLE_CLIENT_ID!);
      url.searchParams.set('redirect_uri', env.OAUTH_GOOGLE_CALLBACK_URL!);
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
    url.searchParams.set('client_id', env.OAUTH_LINUXDO_CLIENT_ID!);
    url.searchParams.set('redirect_uri', env.OAUTH_LINUXDO_CALLBACK_URL!);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async handleCallback(
    provider: ProviderId,
    code: string,
    meta?: { userAgent?: string; ipAddress?: string }
  ) {
    const tokens = await this.exchangeCodeForTokens(provider, code);
    const profile = await this.fetchUserProfile(provider, tokens.accessToken);

    const userId = await this.upsertOAuthAccount(provider, profile, tokens);
    return authService.createAuthResponseForUser(userId, meta);
  }

  private async exchangeCodeForTokens(provider: ProviderId, code: string): Promise<OAuthTokens> {
    if (provider === 'google') {
      const response = await fetchOrThrow(provider, 'token exchange', 'https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.OAUTH_GOOGLE_CLIENT_ID!,
          client_secret: env.OAUTH_GOOGLE_CLIENT_SECRET!,
          grant_type: 'authorization_code',
          code,
          redirect_uri: env.OAUTH_GOOGLE_CALLBACK_URL!,
        }),
      });

      if (!response.ok) {
        throw new AppError(502, 'PROVIDER_ERROR', 'Google OAuth token exchange failed');
      }

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      if (!data.access_token) {
        throw new ValidationError('Google OAuth token response missing access_token');
      }

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      };
    }

    const basic = Buffer.from(`${env.OAUTH_LINUXDO_CLIENT_ID!}:${env.OAUTH_LINUXDO_CLIENT_SECRET!}`).toString(
      'base64'
    );

    const response = await fetchOrThrow(provider, 'token exchange', 'https://connect.linux.do/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: env.OAUTH_LINUXDO_CALLBACK_URL!,
      }),
    });

    if (!response.ok) {
      throw new AppError(502, 'PROVIDER_ERROR', 'Linux.do OAuth token exchange failed');
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!data.access_token) {
      throw new ValidationError('Linux.do OAuth token response missing access_token');
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    };
  }

  private async fetchUserProfile(provider: ProviderId, accessToken: string): Promise<OAuthProfile> {
    if (provider === 'google') {
      const response = await fetchOrThrow(
        provider,
        'fetch user profile',
        'https://openidconnect.googleapis.com/v1/userinfo',
        {
        headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!response.ok) {
        throw new AppError(502, 'PROVIDER_ERROR', 'Failed to fetch Google user profile');
      }

      const data = (await response.json()) as {
        sub: string;
        email?: string;
        name?: string;
        picture?: string;
      };

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

    const response = await fetchOrThrow(provider, 'fetch user profile', 'https://connect.linux.do/api/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new AppError(502, 'PROVIDER_ERROR', 'Failed to fetch Linux.do user profile');
    }

    const data = (await response.json()) as {
      id: number | string;
      username?: string;
      name?: string;
      avatar_template?: string;
    };

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

  private async upsertOAuthAccount(provider: ProviderId, profile: OAuthProfile, tokens: OAuthTokens): Promise<string> {
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

    const created = await usersRepository.createWithRole(
      {
        email,
        name: profile.name,
        avatar: profile.avatar,
        emailVerified: provider === 'google' ? true : false,
      },
      'user'
    );

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
