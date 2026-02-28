import type { Request, Response, NextFunction } from 'express';
export declare class FilesController {
    /**
     * POST /files
     * Upload a file and store in S3-compatible storage (e.g., MinIO)
     */
    upload(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /files/:id/meta
     * Get file metadata
     */
    getMeta(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /files/:id
     * Download/preview a file (supports Range)
     */
    download(req: Request, res: Response, next: NextFunction): Promise<void>;
}
export declare const filesController: FilesController;
//# sourceMappingURL=files.controller.d.ts.map