import { prisma } from '../config/database.js';
export class OAuthAccountsRepository {
    async findByProviderAccountId(provider, providerUserId) {
        return prisma.oAuthAccount.findUnique({
            where: {
                provider_providerUserId: {
                    provider,
                    providerUserId,
                },
            },
        });
    }
    async findByUserIdAndProvider(userId, provider) {
        return prisma.oAuthAccount.findFirst({
            where: { userId, provider },
        });
    }
    async create(data) {
        return prisma.oAuthAccount.create({
            data: {
                userId: data.userId,
                provider: data.provider,
                providerUserId: data.providerUserId,
                providerEmail: data.providerEmail ?? undefined,
                name: data.name ?? undefined,
                avatar: data.avatar ?? undefined,
                accessTokenEncrypted: data.accessTokenEncrypted ?? undefined,
                refreshTokenEncrypted: data.refreshTokenEncrypted ?? undefined,
                expiresAt: data.expiresAt ?? undefined,
            },
        });
    }
    async update(id, data) {
        return prisma.oAuthAccount.update({
            where: { id },
            data,
        });
    }
}
export const oauthAccountsRepository = new OAuthAccountsRepository();
//# sourceMappingURL=oauth-accounts.repository.js.map