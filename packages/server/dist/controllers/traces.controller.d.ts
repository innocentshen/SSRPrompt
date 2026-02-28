import { Request, Response, NextFunction } from 'express';
export declare class TracesController {
    /**
     * GET /traces
     * List traces with pagination
     */
    list(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /traces/:id
     * Get a single trace by ID
     */
    getById(req: Request, res: Response, next: NextFunction): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * POST /traces
     * Create a new trace
     */
    create(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * DELETE /traces/:id
     * Delete a trace
     */
    delete(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * DELETE /traces/by-prompt/:promptId
     * Delete all traces for a prompt
     */
    deleteByPrompt(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /stats/usage
     * Get usage statistics
     */
    getUsageStats(req: Request, res: Response, next: NextFunction): Promise<void>;
}
export declare const tracesController: TracesController;
//# sourceMappingURL=traces.controller.d.ts.map