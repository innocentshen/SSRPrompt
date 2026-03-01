import type { Request, Response } from 'express';
export declare const shareController: {
    verifyPassword(req: Request, res: Response): Promise<void>;
    getPrompt(req: Request, res: Response): Promise<void>;
    getEvaluation(req: Request, res: Response): Promise<void>;
    copyPrompt(req: Request, res: Response): Promise<void>;
    copyEvaluation(req: Request, res: Response): Promise<void>;
    downloadEvaluationAttachment(req: Request, res: Response): Promise<void>;
};
//# sourceMappingURL=share.controller.d.ts.map