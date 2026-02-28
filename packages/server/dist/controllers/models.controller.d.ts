import { Request, Response, NextFunction } from 'express';
export declare class ModelsController {
    /**
     * GET /models
     * List all models for the authenticated user
     */
    listAll(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /providers/:providerId/models
     * List models for a specific provider
     */
    listByProvider(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /models/:id
     * Get a single model by ID
     */
    getById(req: Request, res: Response, next: NextFunction): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * POST /providers/:providerId/models
     * Create a new model
     */
    create(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * PUT /models/:id
     * Update a model
     */
    update(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * DELETE /models/:id
     * Delete a model
     */
    delete(req: Request, res: Response, next: NextFunction): Promise<void>;
}
export declare const modelsController: ModelsController;
//# sourceMappingURL=models.controller.d.ts.map