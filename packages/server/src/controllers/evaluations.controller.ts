import type { Request, Response } from 'express';
import {
  evaluationsService,
  testCasesService,
  criteriaService,
  runsService,
} from '../services/evaluations.service.js';
import {
  CreateEvaluationSchema,
  UpdateEvaluationSchema,
  CreateTestCaseSchema,
  UpdateTestCaseSchema,
  CreateCriterionSchema,
  UpdateCriterionSchema,
} from '@ssrprompt/shared';
import { z } from 'zod';

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
});

// Add result schema
const AddResultSchema = z.object({
  testCaseId: z.string().uuid(),
  modelOutput: z.string().optional(),
  scores: z.record(z.number()).optional(),
  aiFeedback: z.record(z.unknown()).optional(),
  latencyMs: z.number().int().min(0).optional(),
  tokensInput: z.number().int().min(0).optional(),
  tokensOutput: z.number().int().min(0).optional(),
  passed: z.boolean().optional(),
  errorMessage: z.string().optional(),
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
   * DELETE /runs/:id - Delete run
   */
  async delete(req: Request, res: Response): Promise<void> {
    await runsService.delete(req.user!.userId, req.params.id);
    res.status(204).send();
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
};
