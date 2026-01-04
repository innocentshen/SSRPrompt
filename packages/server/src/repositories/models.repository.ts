import { Model, Prisma } from '@prisma/client';
import { ChildRepository } from './base.repository.js';
import { prisma } from '../config/database.js';
import { transformResponse } from '../utils/transform.js';

type ModelDelegate = typeof prisma.model;

export class ModelsRepository extends ChildRepository<
  Model,
  Prisma.ModelCreateInput,
  Prisma.ModelUpdateInput,
  ModelDelegate
> {
  protected delegate = prisma.model;
  protected entityName = 'Model';
  protected parentField = 'providerId';

  /**
   * Find all models for a provider
   */
  async findByProvider(providerId: string): Promise<Model[]> {
    const models = await this.delegate.findMany({
      where: { providerId },
      orderBy: { createdAt: 'asc' },
    });

    return models.map(transformResponse);
  }

  /**
   * Find all models for a user (across all providers)
   */
  async findAllForUser(userId: string): Promise<Model[]> {
    const models = await this.delegate.findMany({
      where: {
        provider: { userId },
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
  async create(providerId: string, data: Omit<Prisma.ModelCreateInput, 'provider'>): Promise<Model> {
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
  async update(id: string, data: Prisma.ModelUpdateInput): Promise<Model> {
    const model = await this.delegate.update({
      where: { id },
      data,
    });

    return transformResponse(model);
  }

  /**
   * Delete models by provider
   */
  async deleteByProvider(providerId: string): Promise<number> {
    const result = await this.delegate.deleteMany({
      where: { providerId },
    });

    return result.count;
  }
}

export const modelsRepository = new ModelsRepository();
