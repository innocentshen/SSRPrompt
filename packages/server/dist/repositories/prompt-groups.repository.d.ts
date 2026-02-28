import { PromptGroup, Prisma } from '@prisma/client';
import { TenantRepository } from './base.repository.js';
import { prisma } from '../config/database.js';
type PromptGroupDelegate = typeof prisma.promptGroup;
export declare class PromptGroupsRepository extends TenantRepository<PromptGroup, Prisma.PromptGroupCreateInput, Prisma.PromptGroupUpdateInput, PromptGroupDelegate> {
    protected delegate: Prisma.PromptGroupDelegate<import("@prisma/client/runtime/library").DefaultArgs>;
    protected entityName: string;
    /**
     * Find all prompt groups for a user (flat list)
     */
    findAllList(userId: string): Promise<PromptGroup[]>;
    /**
     * Find group by ID with ownership verification
     */
    findById(userId: string, id: string): Promise<PromptGroup | null>;
    /**
     * Create a prompt group
     */
    create(userId: string, data: Omit<Prisma.PromptGroupCreateInput, 'user'>): Promise<PromptGroup>;
    /**
     * Update a prompt group
     */
    update(userId: string, id: string, data: Prisma.PromptGroupUpdateInput): Promise<PromptGroup>;
    /**
     * Delete a prompt group
     */
    delete(userId: string, id: string): Promise<PromptGroup>;
}
export declare const promptGroupsRepository: PromptGroupsRepository;
export {};
//# sourceMappingURL=prompt-groups.repository.d.ts.map