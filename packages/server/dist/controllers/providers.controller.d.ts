import { Request, Response, NextFunction } from 'express';
export declare class ProvidersController {
    /**
     * GET /providers
     * List all providers for the authenticated user
     */
    list(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /providers/:id
     * Get a single provider by ID
     */
    getById(req: Request, res: Response, next: NextFunction): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * POST /providers
     * Create a new provider
     */
    create(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * PUT /providers/:id
     * Update a provider
     */
    update(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * DELETE /providers/:id
     * Delete a provider
     */
    delete(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * POST /providers/test-connection
     * Test connection to a provider API
     */
    testConnection(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * POST /providers/:providerId/models/discover
     * Discover models from a provider API (uses saved key by default).
     */
    discoverModels(req: Request, res: Response, next: NextFunction): Promise<void>;
}
export declare const providersController: ProvidersController;
//# sourceMappingURL=providers.controller.d.ts.map