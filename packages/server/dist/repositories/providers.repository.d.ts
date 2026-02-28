import { Provider, Prisma } from '@prisma/client';
import { TenantRepository } from './base.repository.js';
import { prisma } from '../config/database.js';
type ProviderDelegate = typeof prisma.provider;
export declare class ProvidersRepository extends TenantRepository<Provider, Prisma.ProviderCreateInput, Prisma.ProviderUpdateInput, ProviderDelegate> {
    protected delegate: Prisma.ProviderDelegate<import("@prisma/client/runtime/library").DefaultArgs>;
    protected entityName: string;
    /**
     * Find all providers for a user (own + system providers)
     */
    findAll(userId: string): Promise<Provider[]>;
    /**
     * Find provider by ID (own or system provider)
     */
    findById(userId: string, id: string): Promise<Provider | null>;
    /**
     * Create a new provider (encrypts API key)
     */
    create(userId: string, data: Omit<Prisma.ProviderCreateInput, 'userId' | 'user'>, isAdmin?: boolean): Promise<Provider>;
    /**
     * Update a provider (encrypts API key if provided)
     */
    update(userId: string, id: string, data: Prisma.ProviderUpdateInput, isAdmin?: boolean): Promise<Provider>;
    /**
     * Delete a provider
     */
    delete(userId: string, id: string, isAdmin?: boolean): Promise<Provider>;
    /**
     * Find provider with models
     */
    findWithModels(userId: string, id: string): Promise<(Provider & {
        models: unknown[];
    }) | null>;
    /**
     * Helper to decrypt provider API key
     */
    private decryptProvider;
}
export declare const providersRepository: ProvidersRepository;
export {};
//# sourceMappingURL=providers.repository.d.ts.map