import type { Request, Response } from 'express';
export declare const evaluationImportsController: {
    /**
     * GET /evaluation-imports/template
     * Download a template ZIP (import.xlsx + README + sample attachment).
     */
    downloadTemplate(req: Request, res: Response): Promise<void>;
    /**
     * POST /evaluation-imports/zip
     * Upload a ZIP (import.xlsx + attachments) and start an import job.
     */
    createZip(req: Request, res: Response): Promise<void>;
    /**
     * GET /evaluation-imports/:id
     * Get import job status/progress (owner only).
     */
    getJob(req: Request, res: Response): Promise<void>;
    /**
     * GET /evaluation-imports/export/:evaluationId
     * Export evaluation as ZIP in import format.
     */
    exportEvaluation(req: Request, res: Response): Promise<void>;
};
//# sourceMappingURL=evaluation-imports.controller.d.ts.map