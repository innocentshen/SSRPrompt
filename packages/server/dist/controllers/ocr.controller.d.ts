import type { Request, Response } from 'express';
export declare const ocrController: {
    getSettings(req: Request, res: Response): Promise<void>;
    updateSettings(req: Request, res: Response): Promise<void>;
    getSystemSettings(_req: Request, res: Response): Promise<void>;
    updateSystemSettings(req: Request, res: Response): Promise<void>;
    test(req: Request, res: Response): Promise<void>;
    getResults(req: Request, res: Response): Promise<void>;
};
//# sourceMappingURL=ocr.controller.d.ts.map