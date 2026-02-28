import type { PromptGroup } from '@prisma/client';
export declare class PromptGroupsService {
    /**
     * GET /prompt-groups
     * List all groups (flat list)
     */
    findAll(userId: string): Promise<PromptGroup[]>;
    /**
     * POST /prompt-groups
     * Create a group (max 3 levels)
     */
    create(userId: string, data: {
        name: string;
        parentId?: string | null;
        orderIndex?: number;
    }): Promise<PromptGroup>;
    /**
     * PUT /prompt-groups/:id
     * Update group name / parent / orderIndex (max 3 levels)
     */
    update(userId: string, id: string, data: {
        name?: string;
        parentId?: string | null;
        orderIndex?: number;
    }): Promise<PromptGroup>;
    /**
     * DELETE /prompt-groups/:id
     * Delete a group safely (detach prompts and children)
     */
    delete(userId: string, id: string): Promise<void>;
    private assertGroupExists;
    private assertNewChildDepthAllowed;
    private assertReparentAllowed;
}
export declare const promptGroupsService: PromptGroupsService;
//# sourceMappingURL=prompt-groups.service.d.ts.map