import type { Prompt, PromptVersion } from '@prisma/client';
import type { PublicPromptDetail, PublicPromptListItem, CreatePromptInput, UpdatePromptInput, CreateVersionInput, CopyPublicPromptInput } from '@ssrprompt/shared';
export declare class PromptsService {
    /**
     * Get all prompts for a user (list view)
     */
    findAll(userId: string): Promise<Partial<Prompt>[]>;
    /**
     * Get prompt by ID with full details
     */
    findById(userId: string, id: string): Promise<Prompt | null>;
    /**
     * Create a new prompt
     */
    create(userId: string, data: CreatePromptInput): Promise<Prompt>;
    /**
     * Update a prompt
     * When setting isPublic to false, cascade to related evaluations
     */
    update(userId: string, id: string, data: UpdatePromptInput): Promise<Prompt>;
    private assertPromptGroupExists;
    /**
     * Delete a prompt
     */
    delete(userId: string, id: string): Promise<Prompt>;
    /**
     * Update order of multiple prompts
     */
    updateOrder(userId: string, updates: {
        id: string;
        orderIndex: number;
    }[]): Promise<void>;
    /**
     * Get versions for a prompt
     */
    getVersions(userId: string, promptId: string): Promise<PromptVersion[]>;
    /**
     * Create a new version
     */
    createVersion(userId: string, promptId: string, data: CreateVersionInput): Promise<PromptVersion>;
    /**
     * Get a specific version
     */
    getVersion(userId: string, promptId: string, version: number): Promise<PromptVersion | null>;
    /**
     * List all public prompts for the plaza (one item per prompt)
     */
    listPublicPrompts(): Promise<PublicPromptListItem[]>;
    /**
     * Get public prompt detail (latest public version snapshot)
     */
    getPublicPrompt(promptId: string): Promise<PublicPromptDetail | null>;
    /**
     * List public versions for a public prompt
     */
    getPublicVersions(promptId: string): Promise<PromptVersion[]>;
    /**
     * Get a specific public version for a public prompt
     */
    getPublicVersion(promptId: string, version: number): Promise<PromptVersion | null>;
    /**
     * Copy a public prompt version into the user's private space
     */
    copyPublicPrompt(userId: string, promptId: string, input: CopyPublicPromptInput): Promise<Prompt>;
}
export declare const promptsService: PromptsService;
//# sourceMappingURL=prompts.service.d.ts.map