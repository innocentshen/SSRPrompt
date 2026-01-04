import { Provider } from '@prisma/client';
import { providersRepository, modelsRepository } from '../repositories/index.js';
import { CreateProviderInput, UpdateProviderInput } from '@ssrprompt/shared';

export class ProvidersService {
  /**
   * Get all providers for a user
   */
  async findAll(userId: string): Promise<Provider[]> {
    return providersRepository.findAll(userId);
  }

  /**
   * Get provider by ID
   */
  async findById(userId: string, id: string): Promise<Provider | null> {
    return providersRepository.findById(userId, id);
  }

  /**
   * Get provider with models
   */
  async findWithModels(userId: string, id: string) {
    return providersRepository.findWithModels(userId, id);
  }

  /**
   * Create a new provider
   */
  async create(userId: string, data: CreateProviderInput): Promise<Provider> {
    return providersRepository.create(userId, {
      name: data.name,
      type: data.type,
      apiKey: data.apiKey,
      baseUrl: data.baseUrl,
      enabled: data.enabled ?? false,
    });
  }

  /**
   * Update a provider
   */
  async update(userId: string, id: string, data: UpdateProviderInput): Promise<Provider> {
    return providersRepository.update(userId, id, data);
  }

  /**
   * Delete a provider and all its models
   */
  async delete(userId: string, id: string): Promise<Provider> {
    // Models are deleted automatically via Prisma cascade
    return providersRepository.delete(userId, id);
  }
}

export const providersService = new ProvidersService();
