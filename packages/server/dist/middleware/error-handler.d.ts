import { Request, Response, NextFunction } from 'express';
export { asyncHandler } from '../utils/async-handler.js';
/**
 * Global error handling middleware
 */
export declare function errorHandler(error: Error, req: Request, res: Response, _next: NextFunction): Response<any, Record<string, any>> | undefined;
/**
 * 404 Not Found handler
 */
export declare function notFoundHandler(req: Request, res: Response): void;
//# sourceMappingURL=error-handler.d.ts.map