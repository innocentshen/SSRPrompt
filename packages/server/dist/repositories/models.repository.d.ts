import { Model, Prisma } from '@prisma/client';
import { ChildRepository } from './base.repository.js';
import { prisma } from '../config/database.js';
type ModelDelegate = typeof prisma.model;
export declare class ModelsRepository extends ChildRepository<Model, Prisma.ModelCreateInput, Prisma.ModelUpdateInput, ModelDelegate> {
    protected delegate: Prisma.ModelDelegate<import("@prisma/client/runtime/library").DefaultArgs>;
    protected entityName: string;
    protected parentField: string;
    /**
     * Find all models for a provider
     */
    findByProvider(providerId: string): Promise<Model[]>;
    /**
     * Find all models for a user (across all providers)
     */
    findAllForUser(userId: string): Promise<Model[]>;
    /**
     * Create a model
     */
    create(providerId: string, data: Omit<Prisma.ModelCreateInput, 'provider'>): Promise<Model>;
    /**
     * Update a model
     */
    update(id: string, data: Prisma.ModelUpdateInput): Promise<Model>;
    /**
     * Delete models by provider
     */
    deleteByProvider(providerId: string): Promise<number>;
}
export declare const modelsRepository: ModelsRepository;
export {};
//# sourceMappingURL=models.repository.d.ts.map