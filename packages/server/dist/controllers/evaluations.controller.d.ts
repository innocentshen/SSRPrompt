import type { Request, Response } from 'express';
/**
 * Evaluations Controller
 */
export declare const evaluationsController: {
    /**
     * GET /evaluations - List all evaluations
     */
    list(req: Request, res: Response): Promise<void>;
    /**
     * GET /evaluations/:id - Get evaluation by ID
     */
    getById(req: Request, res: Response): Promise<void>;
    /**
     * GET /prompts/:id/evaluations - Get evaluations for a prompt
     */
    getByPromptId(req: Request, res: Response): Promise<void>;
    /**
     * GET /prompts/:id/evaluations/:evaluationId/summary - Get evaluation summary
     */
    getSummary(req: Request, res: Response): Promise<void>;
    /**
     * POST /evaluations - Create evaluation
     */
    create(req: Request, res: Response): Promise<void>;
    /**
     * PUT /evaluations/:id - Update evaluation
     */
    update(req: Request, res: Response): Promise<void>;
    /**
     * DELETE /evaluations/:id - Delete evaluation
     */
    delete(req: Request, res: Response): Promise<void>;
    /**
     * POST /evaluations/:id/copy - Copy evaluation
     */
    copy(req: Request, res: Response): Promise<void>;
    /**
     * GET /evaluations/:evaluationId/files/:fileId - Download/preview an evaluation attachment
     * - Owner can always access.
     * - Non-owner can access only when evaluation is public and attachments are shared.
     */
    downloadFile(req: Request, res: Response): Promise<void>;
    /**
     * PUT /evaluations/batch-order
     * Update order for multiple evaluations
     */
    batchUpdateOrder(req: Request, res: Response): Promise<void>;
};
/**
 * Test Cases Controller
 */
export declare const testCasesController: {
    /**
     * POST /evaluations/:evaluationId/test-cases - Create test case
     */
    create(req: Request, res: Response): Promise<void>;
    /**
     * PUT /test-cases/:id - Update test case
     */
    update(req: Request, res: Response): Promise<void>;
    /**
     * DELETE /test-cases/:id - Delete test case
     */
    delete(req: Request, res: Response): Promise<void>;
};
/**
 * Criteria Controller
 */
export declare const criteriaController: {
    /**
     * POST /evaluations/:evaluationId/criteria - Create criterion
     */
    create(req: Request, res: Response): Promise<void>;
    /**
     * PUT /criteria/:id - Update criterion
     */
    update(req: Request, res: Response): Promise<void>;
    /**
     * DELETE /criteria/:id - Delete criterion
     */
    delete(req: Request, res: Response): Promise<void>;
};
/**
 * Runs Controller
 */
export declare const runsController: {
    /**
     * POST /evaluations/:evaluationId/runs - Create run
     */
    create(req: Request, res: Response): Promise<void>;
    /**
     * POST /evaluations/:evaluationId/runs/execute - Create and execute run server-side
     */
    execute(req: Request, res: Response): Promise<void>;
    /**
     * POST /runs/:id/retry-scores - Retry AI scoring for an existing run
     */
    retryScores(req: Request, res: Response): Promise<void>;
    /**
     * POST /runs/:id/retry-errored-cases - Retry errored test cases in current run
     */
    retryErroredCases(req: Request, res: Response): Promise<void>;
    /**
     * PUT /runs/:id - Update run
     */
    update(req: Request, res: Response): Promise<void>;
    /**
     * GET /runs/:id - Get run by ID
     */
    getById(req: Request, res: Response): Promise<void>;
    /**
     * DELETE /runs/:id - Delete run
     */
    delete(req: Request, res: Response): Promise<void>;
    /**
     * POST /runs/:id/abort - Abort a run
     */
    abort(req: Request, res: Response): Promise<void>;
    /**
     * GET /runs/:id/results - Get run results
     */
    getResults(req: Request, res: Response): Promise<void>;
    /**
     * POST /runs/:id/results - Add result to run
     */
    addResult(req: Request, res: Response): Promise<void>;
    /**
     * POST /runs/:id/results/batch - Add results to run
     */
    addResultsBatch(req: Request, res: Response): Promise<void>;
};
//# sourceMappingURL=evaluations.controller.d.ts.map