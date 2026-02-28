import { ChildRepository } from './base.repository.js';
import { prisma } from '../config/database.js';
import { transformResponse } from '../utils/transform.js';
export class ModelsRepository extends ChildRepository {
    constructor() {
        super(...arguments);
        Object.defineProperty(this, "delegate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: prisma.model
        });
        Object.defineProperty(this, "entityName", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'Model'
        });
        Object.defineProperty(this, "parentField", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'providerId'
        });
    }
    /**
     * Find all models for a provider
     */
    async findByProvider(providerId) {
        const models = await this.delegate.findMany({
            where: { providerId },
            orderBy: { createdAt: 'asc' },
        });
        return models.map(transformResponse);
    }
    /**
     * Find all models for a user (across all providers)
     */
    async findAllForUser(userId) {
        const models = await this.delegate.findMany({
            where: {
                provider: {
                    OR: [{ userId }, { isSystem: true }],
                },
            },
            include: {
                provider: {
                    select: { id: true, name: true, type: true },
                },
            },
            orderBy: { createdAt: 'asc' },
        });
        return models.map(transformResponse);
    }
    /**
     * Create a model
     */
    async create(providerId, data) {
        const model = await this.delegate.create({
            data: {
                ...data,
                provider: { connect: { id: providerId } },
            },
        });
        return transformResponse(model);
    }
    /**
     * Update a model
     */
    async update(id, data) {
        const model = await this.delegate.update({
            where: { id },
            data,
        });
        return transformResponse(model);
    }
    /**
     * Delete models by provider
     */
    async deleteByProvider(providerId) {
        const result = await this.delegate.deleteMany({
            where: { providerId },
        });
        return result.count;
    }
}
export const modelsRepository = new ModelsRepository();
//# sourceMappingURL=models.repository.js.map