import { TenantRepository } from './base.repository.js';
import { prisma } from '../config/database.js';
import { encrypt, decrypt, isEncrypted } from '../utils/crypto.js';
import { transformResponse } from '../utils/transform.js';
import { ForbiddenError } from '@ssrprompt/shared';
export class ProvidersRepository extends TenantRepository {
    constructor() {
        super(...arguments);
        Object.defineProperty(this, "delegate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: prisma.provider
        });
        Object.defineProperty(this, "entityName", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'Provider'
        });
    }
    /**
     * Find all providers for a user (own + system providers)
     */
    async findAll(userId) {
        const providers = await this.delegate.findMany({
            where: {
                OR: [
                    { userId },
                    { isSystem: true },
                ],
            },
            orderBy: { createdAt: 'asc' },
            include: {
                models: {
                    orderBy: { createdAt: 'asc' },
                },
            },
        });
        return providers.map((p) => this.decryptProvider(p));
    }
    /**
     * Find provider by ID (own or system provider)
     */
    async findById(userId, id) {
        const provider = await this.delegate.findUnique({
            where: { id },
        });
        if (!provider)
            return null;
        // Allow access if it's user's own provider or system provider
        if (provider.userId !== userId && !provider.isSystem) {
            throw new ForbiddenError(`Access denied to ${this.entityName}`);
        }
        return this.decryptProvider(provider);
    }
    /**
     * Create a new provider (encrypts API key)
     */
    async create(userId, data, isAdmin = false) {
        // Only admin can create system providers
        if (data.isSystem && !isAdmin) {
            throw new ForbiddenError('Only administrators can create system providers');
        }
        const createData = {
            ...data,
            apiKey: encrypt(data.apiKey),
            ...(data.isSystem ? {} : { user: { connect: { id: userId } } }),
        };
        const provider = await this.delegate.create({ data: createData });
        return this.decryptProvider(provider);
    }
    /**
     * Update a provider (encrypts API key if provided)
     */
    async update(userId, id, data, isAdmin = false) {
        const existing = await this.delegate.findUnique({ where: { id } });
        if (!existing) {
            throw new ForbiddenError(`${this.entityName} not found`);
        }
        // System providers can only be updated by admin
        if (existing.isSystem && !isAdmin) {
            throw new ForbiddenError('Only administrators can update system providers');
        }
        // Non-system providers can only be updated by owner
        if (!existing.isSystem && existing.userId !== userId) {
            throw new ForbiddenError(`Access denied to ${this.entityName}`);
        }
        // Only admin can change isSystem flag
        if (data.isSystem !== undefined && !isAdmin) {
            throw new ForbiddenError('Only administrators can change system provider status');
        }
        const updateData = { ...data };
        // Encrypt API key if being updated
        if (typeof updateData.apiKey === 'string') {
            const nextApiKey = updateData.apiKey.trim();
            // Prevent accidentally overwriting the real key with a masked value returned by the API (e.g. "sk-xxxx...").
            // Masked keys are short and end with "...".
            const isLikelyMasked = nextApiKey === '***decryption-failed***' || (nextApiKey.endsWith('...') && nextApiKey.length <= 20);
            if (!nextApiKey || isLikelyMasked) {
                delete updateData.apiKey;
            }
            else {
                updateData.apiKey = encrypt(nextApiKey);
            }
        }
        const provider = await this.delegate.update({
            where: { id },
            data: updateData,
        });
        return this.decryptProvider(provider);
    }
    /**
     * Delete a provider
     */
    async delete(userId, id, isAdmin = false) {
        const existing = await this.delegate.findUnique({ where: { id } });
        if (!existing) {
            throw new ForbiddenError(`${this.entityName} not found`);
        }
        // System providers can only be deleted by admin
        if (existing.isSystem && !isAdmin) {
            throw new ForbiddenError('Only administrators can delete system providers');
        }
        // Non-system providers can only be deleted by owner
        if (!existing.isSystem && existing.userId !== userId) {
            throw new ForbiddenError(`Access denied to ${this.entityName}`);
        }
        return this.delegate.delete({ where: { id } });
    }
    /**
     * Find provider with models
     */
    async findWithModels(userId, id) {
        const provider = await this.delegate.findUnique({
            where: { id },
            include: {
                models: {
                    orderBy: { createdAt: 'asc' },
                },
            },
        });
        if (!provider)
            return null;
        // Allow access if it's user's own provider or system provider
        if (provider.userId !== userId && !provider.isSystem) {
            throw new ForbiddenError('Access denied');
        }
        return this.decryptProvider(provider);
    }
    /**
     * Helper to decrypt provider API key
     */
    decryptProvider(provider) {
        const result = transformResponse(provider);
        // Decrypt API key if it's encrypted
        if (result.apiKey && isEncrypted(result.apiKey)) {
            try {
                result.apiKey = decrypt(result.apiKey);
            }
            catch {
                // If decryption fails, return masked key
                result.apiKey = '***decryption-failed***';
            }
        }
        return result;
    }
}
export const providersRepository = new ProvidersRepository();
//# sourceMappingURL=providers.repository.js.map