import type { OAuthAccount, OAuthProvider } from '@prisma/client';
export declare class OAuthAccountsRepository {
    findByProviderAccountId(provider: OAuthProvider, providerUserId: string): Promise<OAuthAccount | null>;
    findByUserIdAndProvider(userId: string, provider: OAuthProvider): Promise<OAuthAccount | null>;
    create(data: {
        userId: string;
        provider: OAuthProvider;
        providerUserId: string;
        providerEmail?: string | null;
        name?: string | null;
        avatar?: string | null;
        accessTokenEncrypted?: string | null;
        refreshTokenEncrypted?: string | null;
        expiresAt?: Date | null;
    }): Promise<OAuthAccount>;
    update(id: string, data: Partial<Pick<OAuthAccount, 'providerEmail' | 'name' | 'avatar' | 'accessTokenEncrypted' | 'refreshTokenEncrypted' | 'expiresAt'>>): Promise<OAuthAccount>;
}
export declare const oauthAccountsRepository: OAuthAccountsRepository;
//# sourceMappingURL=oauth-accounts.repository.d.ts.map