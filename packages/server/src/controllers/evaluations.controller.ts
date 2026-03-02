import type { Request, Response } from 'express';
import { AppError } from '@ssrprompt/shared';
import {
  evaluationsService,
  testCasesService,
  criteriaService,
  runsService,
} from '../services/evaluations.service.js';
import { toNodeReadable } from '../utils/stream.js';
import {
  CreateEvaluationSchema,
  UpdateEvaluationSchema,
  CreateTestCaseSchema,
  UpdateTestCaseSchema,
  CreateCriterionSchema,
  UpdateCriterionSchema,
} from '@ssrprompt/shared';
import { z } from 'zod';

function parseRangeHeader(rangeHeader: string | undefined): { start: number; end?: number } | null {
  if (!rangeHeader) return null;

  // Only support single range: bytes=start-end
  const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return null;

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : undefined;

  if (!Number.isFinite(start) || start < 0) return null;
  if (end !== undefined && (!Number.isFinite(end) || end < start)) return null;

  return { start, end };
}

/**
 * Evaluations Controller
 */
export const evaluationsController = {
  /**
   * GET /evaluations - List all evaluations
   */
  async list(req: Request, res: Response): Promise<void> {
    const evaluations = await evaluationsService.findAll(req.user!.userId);
    res.json({ data: evaluations });
  },

  /**
   * GET /evaluations/:id - Get evaluation by ID
   */
  async getById(req: Request, res: Response): Promise<void> {
    const evaluation = await evaluationsService.findById(req.user!.userId, req.params.id);
    res.json({ data: evaluation });
  },

  /**
   * GET /prompts/:id/evaluations - Get evaluations for a prompt
   */
  async getByPromptId(req: Request, res: Response): Promise<void> {
    const promptId = req.params.id;
    const evaluations = await evaluationsService.getEvaluationsByPromptId(req.user!.userId, promptId);
    res.json({ data: evaluations });
  },

  /**
   * GET /prompts/:id/evaluations/:evaluationId/summary - Get evaluation summary
   */
  async getSummary(req: Request, res: Response): Promise<void> {
    const { evaluationId } = req.params;
    const summary = await evaluationsService.getEvaluationSummary(req.user!.userId, evaluationId);
    res.json({ data: summary });
  },

  /**
   * POST /evaluations - Create evaluation
   */
  async create(req: Request, res: Response): Promise<void> {
    const data = CreateEvaluationSchema.parse(req.body);

    // Parse test cases and criteria if provided
    const testCases = req.body.testCases
      ? z.array(CreateTestCaseSchema).parse(req.body.testCases)
      : undefined;
    const criteria = req.body.criteria
      ? z.array(CreateCriterionSchema).parse(req.body.criteria)
      : undefined;

    const evaluation = await evaluationsService.create(req.user!.userId, {
      ...data,
      testCases,
      criteria,
    });

    res.status(201).json({ data: evaluation });
  },

  /**
   * PUT /evaluations/:id - Update evaluation
   */
  async update(req: Request, res: Response): Promise<void> {
    const data = UpdateEvaluationSchema.parse(req.body);
    const evaluation = await evaluationsService.update(req.user!.userId, req.params.id, data);
    res.json({ data: evaluation });
  },

  /**
   * DELETE /evaluations/:id - Delete evaluation
   */
  async delete(req: Request, res: Response): Promise<void> {
    await evaluationsService.delete(req.user!.userId, req.params.id);
    res.status(204).send();
  },

  /**
   * POST /evaluations/:id/copy - Copy evaluation
   */
  async copy(req: Request, res: Response): Promise<void> {
    const { name } = req.body;
    const evaluation = await evaluationsService.copy(req.user!.userId, req.params.id, name);
    res.status(201).json({ data: evaluation });
  },

  /**
   * GET /evaluations/:evaluationId/files/:fileId - Download/preview an evaluation attachment
   * - Owner can always access.
   * - Non-owner can access only when evaluation is public and attachments are shared.
   */
  async downloadFile(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { evaluationId, fileId } = req.params;
    const range = parseRangeHeader(typeof req.headers.range === 'string' ? req.headers.range : undefined);

    const { meta, body, contentLength, contentRange } = await evaluationsService.downloadAttachment(
      userId,
      evaluationId,
      fileId,
      range
    );

    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    // Use RFC 5987 encoding for non-ASCII filenames
    const safeFilename = meta.originalName.replace(/[^\x20-\x7E]/g, '');
    const encodedFilename = encodeURIComponent(meta.originalName);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`
    );

    if (range && contentRange) {
      res.status(206);
      res.setHeader('Content-Range', contentRange);
    }

    if (contentLength !== undefined) {
      res.setHeader('Content-Length', String(contentLength));
    } else if (!range) {
      res.setHeader('Content-Length', String(meta.size));
    }

    if (!body) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Missing file body from storage');
    }

    const stream = toNodeReadable(body);
    stream.pipe(res);
  },

  /**
   * PUT /evaluations/batch-order
   * Update order for multiple evaluations
   */
  async batchUpdateOrder(req: Request, res: Response): Promise<void> {
    const updates = z
      .array(z.object({ id: z.string().uuid(), orderIndex: z.number().int().min(0) }))
      .parse(req.body);
    await evaluationsService.updateOrder(req.user!.userId, updates);
    res.json({ success: true });
  },
};

/**
 * Test Cases Controller
 */
export const testCasesController = {
  /**
   * POST /evaluations/:evaluationId/test-cases - Create test case
   */
  async create(req: Request, res: Response): Promise<void> {
    const data = CreateTestCaseSchema.parse(req.body);
    const testCase = await testCasesService.create(
      req.user!.userId,
      req.params.evaluationId,
      data
    );
    res.status(201).json({ data: testCase });
  },

  /**
   * PUT /test-cases/:id - Update test case
   */
  async update(req: Request, res: Response): Promise<void> {
    const data = UpdateTestCaseSchema.parse(req.body);
    const testCase = await testCasesService.update(req.user!.userId, req.params.id, data);
    res.json({ data: testCase });
  },

  /**
   * DELETE /test-cases/:id - Delete test case
   */
  async delete(req: Request, res: Response): Promise<void> {
    await testCasesService.delete(req.user!.userId, req.params.id);
    res.status(204).send();
  },
};

/**
 * Criteria Controller
 */
export const criteriaController = {
  /**
   * POST /evaluations/:evaluationId/criteria - Create criterion
   */
  async create(req: Request, res: Response): Promise<void> {
    const data = CreateCriterionSchema.parse(req.body);
    const criterion = await criteriaService.create(
      req.user!.userId,
      req.params.evaluationId,
      data
    );
    res.status(201).json({ data: criterion });
  },

  /**
   * PUT /criteria/:id - Update criterion
   */
  async update(req: Request, res: Response): Promise<void> {
    const data = UpdateCriterionSchema.parse(req.body);
    const criterion = await criteriaService.update(req.user!.userId, req.params.id, data);
    res.json({ data: criterion });
  },

  /**
   * DELETE /criteria/:id - Delete criterion
   */
  async delete(req: Request, res: Response): Promise<void> {
    await criteriaService.delete(req.user!.userId, req.params.id);
    res.status(204).send();
  },
};

// Run creation schema
const CreateRunSchema = z.object({
  modelParameters: z.record(z.unknown()).optional(),
  testCaseIds: z.array(z.string().uuid()).optional(),
});

// Run update schema
const UpdateRunSchema = z.object({
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  results: z.record(z.unknown()).optional(),
  errorMessage: z.string().nullable().optional(),
  totalTokensInput: z.number().int().min(0).optional(),
  totalTokensOutput: z.number().int().min(0).optional(),
});

// Add result schema
const AddResultSchema = z.object({
  testCaseId: z.string().uuid(),
  modelOutput: z.string().optional(),
  scores: z.record(z.number()).optional(),
  aiFeedback: z.record(z.unknown()).optional(),
  latencyMs: z.number().int().min(0).optional(),
  ocrLatencyMs: z.number().int().min(0).optional(),
  tokensInput: z.number().int().min(0).optional(),
  tokensOutput: z.number().int().min(0).optional(),
  passed: z.boolean().optional(),
  errorMessage: z.string().nullable().optional(),
});
const AddResultsBatchSchema = z.object({
  results: z.array(AddResultSchema).min(1),
});

/**
 * Runs Controller
 */
export const runsController = {
  /**
   * POST /evaluations/:evaluationId/runs - Create run
   */
  async create(req: Request, res: Response): Promise<void> {
    const data = CreateRunSchema.parse(req.body);
    const run = await runsService.create(req.user!.userId, req.params.evaluationId, data);
    res.status(201).json({ data: run });
  },

  /**
   * POST /evaluations/:evaluationId/runs/execute - Create and execute run server-side
   */
  async execute(req: Request, res: Response): Promise<void> {
    const data = CreateRunSchema.parse(req.body);
    const run = await runsService.createAndExecute(req.user!.userId, req.params.evaluationId, data);
    res.status(201).json({ data: run });
  },

  /**
   * POST /runs/:id/retry-scores - Retry AI scoring for an existing run
   */
  async retryScores(req: Request, res: Response): Promise<void> {
    const run = await runsService.retryScores(req.user!.userId, req.params.id);
    res.json({ data: run });
  },

  /**
   * PUT /runs/:id - Update run
   */
  async update(req: Request, res: Response): Promise<void> {
    const data = UpdateRunSchema.parse(req.body);
    const run = await runsService.update(req.user!.userId, req.params.id, data);
    res.json({ data: run });
  },

  /**
   * GET /runs/:id - Get run by ID
   */
  async getById(req: Request, res: Response): Promise<void> {
    const run = await runsService.getById(req.user!.userId, req.params.id);
    res.json({ data: run });
  },

  /**
   * DELETE /runs/:id - Delete run
   */
  async delete(req: Request, res: Response): Promise<void> {
    await runsService.delete(req.user!.userId, req.params.id);
    res.status(204).send();
  },

  /**
   * POST /runs/:id/abort - Abort a run
   */
  async abort(req: Request, res: Response): Promise<void> {
    const run = await runsService.abort(req.user!.userId, req.params.id);
    res.json({ data: run });
  },

  /**
   * GET /runs/:id/results - Get run results
   */
  async getResults(req: Request, res: Response): Promise<void> {
    const results = await runsService.getResults(req.user!.userId, req.params.id);
    res.json({ data: results });
  },

  /**
   * POST /runs/:id/results - Add result to run
   */
  async addResult(req: Request, res: Response): Promise<void> {
    const data = AddResultSchema.parse(req.body);
    const result = await runsService.addResult(req.user!.userId, req.params.id, data);
    res.status(201).json({ data: result });
  },

  /**
   * POST /runs/:id/results/batch - Add results to run
   */
  async addResultsBatch(req: Request, res: Response): Promise<void> {
    const data = AddResultsBatchSchema.parse(req.body);
    const results = await runsService.addResultsBatch(req.user!.userId, req.params.id, data.results);
    res.status(201).json({ data: results });
  },
};
