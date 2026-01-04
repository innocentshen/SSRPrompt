import { Model } from '@prisma/client';
import { modelsRepository, providersRepository } from '../repositories/index.js';
import { CreateModelInput, UpdateModelInput, NotFoundError } from '@ssrprompt/shared';

export class ModelsService {
  /**
   * Get all models for a user
   */
  async findAllForUser(userId: string): Promise<Model[]> {
    return modelsRepository.findAllForUser(userId);
  }

  /**
   * Get all models for a provider
   */
  async findByProvider(userId: string, providerId: string): Promise<Model[]> {
    // Verify provider ownership
    await providersRepository.findByIdOrThrow(userId, providerId);
    return modelsRepository.findByProvider(providerId);
  }

  /**
   * Get model by ID
   */
  async findById(userId: string, id: string): Promise<Model | null> {
    const model = await modelsRepository.findById(id);
    if (!model) return null;

    // Verify provider ownership
    await providersRepository.findByIdOrThrow(userId, model.providerId);
    return model;
  }

  /**
   * Create a model
   */
  async create(userId: string, providerId: string, data: CreateModelInput): Promise<Model> {
    // Verify provider ownership
    await providersRepository.findByIdOrThrow(userId, providerId);

    return modelsRepository.create(providerId, {
      modelId: data.modelId,
      name: data.name,
      capabilities: data.capabilities ?? [],
      supportsVision: data.supportsVision ?? true,
      supportsReasoning: data.supportsReasoning ?? false,
      supportsFunctionCalling: data.supportsFunctionCalling ?? false,
    });
  }

  /**
   * Update a model
   */
  async update(userId: string, id: string, data: UpdateModelInput): Promise<Model> {
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
  async delete(userId: string, id: string): Promise<Model> {
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
