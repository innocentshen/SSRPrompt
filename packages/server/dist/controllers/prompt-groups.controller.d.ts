import { Request, Response, NextFunction } from 'express';
export declare class PromptGroupsController {
    /**
     * GET /prompt-groups
     * List all groups for the authenticated user
     */
    list(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * POST /prompt-groups
     * Create a new group
     */
    create(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * PUT /prompt-groups/:id
     * Update a group
     */
    update(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * DELETE /prompt-groups/:id
     * Delete a group
     */
    delete(req: Request, res: Response, next: NextFunction): Promise<void>;
}
export declare const promptGroupsController: PromptGroupsController;
//# sourceMappingURL=prompt-groups.controller.d.ts.map