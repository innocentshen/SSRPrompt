import { Prompt, PromptVersion, Prisma } from '@prisma/client';
import { TenantRepository, ChildRepository } from './base.repository.js';
import { prisma } from '../config/database.js';
type PromptDelegate = typeof prisma.prompt;
type VersionDelegate = typeof prisma.promptVersion;
export declare class PromptsRepository extends TenantRepository<Prompt, Prisma.PromptCreateInput, Prisma.PromptUpdateInput, PromptDelegate> {
    protected delegate: Prisma.PromptDelegate<import("@prisma/client/runtime/library").DefaultArgs>;
    protected entityName: string;
    /**
     * Find all prompts for a user (list view - exclude large fields)
     */
    findAllList(userId: string): Promise<Partial<Prompt>[]>;
    /**
     * Create a prompt
     */
    create(userId: string, data: Omit<Prisma.PromptCreateInput, 'userId' | 'user'>): Promise<Prompt>;
    /**
     * Update prompt order for multiple prompts
     */
    updateOrder(userId: string, updates: {
        id: string;
        orderIndex: number;
    }[]): Promise<void>;
    /**
     * Get next version number for a prompt
     */
    getNextVersion(promptId: string): Promise<number>;
}
export declare class PromptVersionsRepository extends ChildRepository<PromptVersion, Prisma.PromptVersionCreateInput, Prisma.PromptVersionUpdateInput, VersionDelegate> {
    protected delegate: Prisma.PromptVersionDelegate<import("@prisma/client/runtime/library").DefaultArgs>;
    protected entityName: string;
    protected parentField: string;
    /**
     * Find all versions for a prompt
     */
    findByPrompt(promptId: string): Promise<PromptVersion[]>;
    /**
     * Create a new version and update prompt's current version
     */
    createVersion(promptId: string, version: number, data: {
        content: string;
        commitMessage?: string;
        variables?: Prisma.InputJsonValue;
        messages?: Prisma.InputJsonValue;
        config?: Prisma.InputJsonValue;
        defaultModelId?: string | null;
        isPublic?: boolean;
        publishedAt?: Date | null;
    }): Promise<PromptVersion>;
    /**
     * Find a specific version
     */
    findByVersion(promptId: string, version: number): Promise<PromptVersion | null>;
}
export declare const promptsRepository: PromptsRepository;
export declare const promptVersionsRepository: PromptVersionsRepository;
export {};
//# sourceMappingURL=prompts.repository.d.ts.map