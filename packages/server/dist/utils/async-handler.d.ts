import { Request, Response, NextFunction, RequestHandler } from 'express';
/**
 * Wraps an async route handler to catch errors and pass them to Express error middleware
 */
export declare const asyncHandler: (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => RequestHandler;
//# sourceMappingURL=async-handler.d.ts.map