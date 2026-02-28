import { Model } from '@prisma/client';
import { CreateModelInput, UpdateModelInput } from '@ssrprompt/shared';
export declare class ModelsService {
    /**
     * Get all models for a user
     */
    findAllForUser(userId: string): Promise<Model[]>;
    /**
     * Get all models for a provider
     */
    findByProvider(userId: string, providerId: string): Promise<Model[]>;
    /**
     * Get model by ID
     */
    findById(userId: string, id: string): Promise<Model | null>;
    /**
     * Create a model
     */
    create(userId: string, providerId: string, data: CreateModelInput): Promise<Model>;
    /**
     * Update a model
     */
    update(userId: string, id: string, data: UpdateModelInput): Promise<Model>;
    /**
     * Delete a model
     */
    delete(userId: string, id: string): Promise<Model>;
}
export declare const modelsService: ModelsService;
//# sourceMappingURL=models.service.d.ts.map