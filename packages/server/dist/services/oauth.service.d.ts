type ProviderId = 'google' | 'linuxdo';
export declare class OAuthService {
    getAuthorizeUrl(provider: ProviderId, state: string): string;
    handleCallback(provider: ProviderId, code: string, meta?: {
        userAgent?: string;
        ipAddress?: string;
    }): Promise<import("@ssrprompt/shared").AuthResponse>;
    private exchangeCodeForTokens;
    private fetchUserProfile;
    private upsertOAuthAccount;
}
export declare const oauthService: OAuthService;
export {};
//# sourceMappingURL=oauth.service.d.ts.map