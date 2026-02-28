import { Request, Response, NextFunction } from 'express';
export declare class PromptsController {
    /**
     * GET /prompts
     * List all prompts for the authenticated user
     */
    list(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /prompts/public
     * List all public prompts for the plaza
     */
    listPublic(_req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /prompts/public/:id
     * Get public prompt detail (latest public version snapshot)
     */
    getPublicById(req: Request, res: Response, next: NextFunction): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * GET /prompts/:id
     * Get a single prompt by ID
     */
    getById(req: Request, res: Response, next: NextFunction): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * POST /prompts
     * Create a new prompt
     */
    create(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * PUT /prompts/:id
     * Update a prompt
     */
    update(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * DELETE /prompts/:id
     * Delete a prompt
     */
    delete(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * PUT /prompts/:id/order
     * Update prompt order
     */
    updateOrder(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * PUT /prompts/batch-order
     * Update order for multiple prompts
     */
    batchUpdateOrder(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /prompts/:id/versions
     * Get versions for a prompt
     */
    getVersions(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /prompts/public/:id/versions
     * Get public versions for a public prompt
     */
    getPublicVersions(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * POST /prompts/:id/versions
     * Create a new version
     */
    createVersion(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /prompts/:id/versions/:version
     * Get a specific version
     */
    getVersion(req: Request, res: Response, next: NextFunction): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * GET /prompts/public/:id/versions/:version
     * Get a specific public version for a public prompt
     */
    getPublicVersion(req: Request, res: Response, next: NextFunction): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * POST /prompts/public/:id/copy
     * Copy a public prompt into the user's private space
     */
    copyPublic(req: Request, res: Response, next: NextFunction): Promise<void>;
}
export declare const promptsController: PromptsController;
//# sourceMappingURL=prompts.controller.d.ts.map