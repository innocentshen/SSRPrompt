import { modelsRepository, providersRepository } from '../repositories/index.js';
import { NotFoundError } from '@ssrprompt/shared';
export class ModelsService {
    /**
     * Get all models for a user
     */
    async findAllForUser(userId) {
        return modelsRepository.findAllForUser(userId);
    }
    /**
     * Get all models for a provider
     */
    async findByProvider(userId, providerId) {
        // Verify provider ownership
        await providersRepository.findByIdOrThrow(userId, providerId);
        return modelsRepository.findByProvider(providerId);
    }
    /**
     * Get model by ID
     */
    async findById(userId, id) {
        const model = await modelsRepository.findById(id);
        if (!model)
            return null;
        // Verify provider ownership
        await providersRepository.findByIdOrThrow(userId, model.providerId);
        return model;
    }
    /**
     * Create a model
     */
    async create(userId, providerId, data) {
        // Verify provider ownership
        await providersRepository.findByIdOrThrow(userId, providerId);
        return modelsRepository.create(providerId, {
            modelId: data.modelId,
            name: data.name,
            capabilities: data.capabilities ?? [],
            maxContextLength: data.maxContextLength ?? 8000,
            supportsVision: data.supportsVision ?? false,
            supportsReasoning: data.supportsReasoning ?? false,
            supportsFunctionCalling: data.supportsFunctionCalling ?? false,
        });
    }
    /**
     * Update a model
     */
    async update(userId, id, data) {
        const model = await modelsRepository.findById(id);
        if (!model) {
            throw new NotFoundError('Model', id);
        }
        // Verify provider ownership
        await providersRepository.findByIdOrThrow(userId, model.providerId);
        return modelsRepository.update(id, data);
    }
    /**
     * Delete a model
     */
    async delete(userId, id) {
        const model = await modelsRepository.findById(id);
        if (!model) {
            throw new NotFoundError('Model', id);
        }
        // Verify provider ownership
        await providersRepository.findByIdOrThrow(userId, model.providerId);
        return modelsRepository.delete(id);
    }
}
export const modelsService = new ModelsService();
//# sourceMappingURL=models.service.js.map