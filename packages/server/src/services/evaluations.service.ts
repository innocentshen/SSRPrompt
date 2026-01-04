import {
  evaluationsRepository,
  testCasesRepository,
  criteriaRepository,
  runsRepository,
  testCaseResultsRepository,
  type EvaluationWithRelations,
} from '../repositories/evaluations.repository.js';
import { transformResponse, transformDecimal } from '../utils/transform.js';
import { AppError } from '@ssrprompt/shared';
import type { Prisma, TestCase, EvaluationCriterion, EvaluationRun, TestCaseResult } from '@prisma/client';

/**
 * Evaluations Service
 */
export class EvaluationsService {
  /**
   * Get all evaluations for a user
   */
  async findAll(userId: string): Promise<EvaluationWithRelations[]> {
    const evaluations = await evaluationsRepository.findAll(userId);
    return evaluations.map((e) => transformResponse(e));
  }

  /**
   * Get evaluation by ID with all relations
   */
  async findById(userId: string, id: string): Promise<EvaluationWithRelations> {
    const evaluation = await evaluationsRepository.findByIdWithRelations(userId, id);
    if (!evaluation) {
      throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
    }
    return transformResponse(evaluation);
  }

  /**
   * Create a new evaluation
   */
  async create(
    userId: string,
    data: {
      name: string;
      promptId?: string;
      modelId?: string;
      judgeModelId?: string;
      config?: Record<string, unknown>;
      testCases?: Array<{
        name?: string;
        inputText: string;
        inputVariables?: Record<string, unknown>;
        attachments?: unknown[];
        expectedOutput?: string;
        notes?: string;
      }>;
      criteria?: Array<{
        name: string;
        description?: string;
        prompt?: string;
        weight?: number;
        enabled?: boolean;
      }>;
    }
  ): Promise<EvaluationWithRelations> {
    const evaluation = await evaluationsRepository.createWithRelations(
      userId,
      {
        name: data.name,
        prompt: data.promptId ? { connect: { id: data.promptId } } : undefined,
        model: data.modelId ? { connect: { id: data.modelId } } : undefined,
        judgeModel: data.judgeModelId ? { connect: { id: data.judgeModelId } } : undefined,
        config: (data.config as Prisma.JsonObject) || {},
      },
      data.testCases?.map((tc) => ({
        name: tc.name || '',
        inputText: tc.inputText,
        inputVariables: (tc.inputVariables as Prisma.JsonObject) || {},
        attachments: (tc.attachments as Prisma.JsonArray) || [],
        expectedOutput: tc.expectedOutput,
        notes: tc.notes,
      })),
      data.criteria?.map((c) => ({
        name: c.name,
        description: c.description,
        prompt: c.prompt,
        weight: c.weight,
        enabled: c.enabled ?? true,
      }))
    );

    return transformResponse(evaluation);
  }

  /**
   * Update an evaluation
   */
  async update(
    userId: string,
    id: string,
    data: {
      name?: string;
      promptId?: string | null;
      modelId?: string | null;
      judgeModelId?: string | null;
      status?: 'pending' | 'running' | 'completed' | 'failed';
      config?: Record<string, unknown>;
      results?: Record<string, unknown>;
    }
  ): Promise<EvaluationWithRelations> {
    // Verify ownership
    await this.findById(userId, id);

    const updateData: Prisma.EvaluationUpdateInput = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.config !== undefined) updateData.config = data.config as Prisma.JsonObject;
    if (data.results !== undefined) updateData.results = data.results as Prisma.JsonObject;

    // Handle relation updates
    if (data.promptId !== undefined) {
      updateData.prompt = data.promptId ? { connect: { id: data.promptId } } : { disconnect: true };
    }
    if (data.modelId !== undefined) {
      updateData.model = data.modelId ? { connect: { id: data.modelId } } : { disconnect: true };
    }
    if (data.judgeModelId !== undefined) {
      updateData.judgeModel = data.judgeModelId ? { connect: { id: data.judgeModelId } } : { disconnect: true };
    }

    if (data.status === 'completed') {
      updateData.completedAt = new Date();
    }

    await evaluationsRepository.update(userId, id, updateData);
    return this.findById(userId, id);
  }

  /**
   * Delete an evaluation
   */
  async delete(userId: string, id: string): Promise<void> {
    await this.findById(userId, id);
    await evaluationsRepository.delete(userId, id);
  }

  /**
   * Copy an evaluation
   */
  async copy(userId: string, id: string, newName?: string): Promise<EvaluationWithRelations> {
    const original = await this.findById(userId, id);
    const evaluation = await evaluationsRepository.copy(userId, id, newName || `${original.name} (Copy)`);
    return transformResponse(evaluation);
  }
}

/**
 * Test Cases Service
 */
export class TestCasesService {
  private evaluationsService = new EvaluationsService();

  /**
   * Create a test case
   */
  async create(
    userId: string,
    evaluationId: string,
    data: {
      name?: string;
      inputText: string;
      inputVariables?: Record<string, unknown>;
      attachments?: unknown[];
      expectedOutput?: string;
      notes?: string;
      orderIndex?: number;
    }
  ): Promise<TestCase> {
    // Verify evaluation ownership
    await this.evaluationsService.findById(userId, evaluationId);

    const testCase = await testCasesRepository.create(evaluationId, {
      name: data.name || '',
      inputText: data.inputText,
      inputVariables: (data.inputVariables as Prisma.JsonObject) || {},
      attachments: (data.attachments as Prisma.JsonArray) || [],
      expectedOutput: data.expectedOutput,
      notes: data.notes,
      orderIndex: data.orderIndex,
    });

    return transformResponse(testCase);
  }

  /**
   * Update a test case
   */
  async update(
    userId: string,
    id: string,
    data: {
      name?: string;
      inputText?: string;
      inputVariables?: Record<string, unknown>;
      attachments?: unknown[];
      expectedOutput?: string | null;
      notes?: string | null;
      orderIndex?: number;
    }
  ): Promise<TestCase> {
    const testCase = await testCasesRepository.findById(id);
    if (!testCase) {
      throw new AppError(404, 'NOT_FOUND', 'Test case not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.findById(userId, testCase.evaluationId);

    const updateData: Prisma.TestCaseUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.inputText !== undefined) updateData.inputText = data.inputText;
    if (data.inputVariables !== undefined) updateData.inputVariables = data.inputVariables as Prisma.JsonObject;
    if (data.attachments !== undefined) updateData.attachments = data.attachments as Prisma.JsonArray;
    if (data.expectedOutput !== undefined) updateData.expectedOutput = data.expectedOutput;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.orderIndex !== undefined) updateData.orderIndex = data.orderIndex;

    const updated = await testCasesRepository.update(id, updateData);
    return transformResponse(updated);
  }

  /**
   * Delete a test case
   */
  async delete(userId: string, id: string): Promise<void> {
    const testCase = await testCasesRepository.findById(id);
    if (!testCase) {
      throw new AppError(404, 'NOT_FOUND', 'Test case not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.findById(userId, testCase.evaluationId);

    await testCasesRepository.delete(id);
  }
}

/**
 * Criteria Service
 */
export class CriteriaService {
  private evaluationsService = new EvaluationsService();

  /**
   * Create a criterion
   */
  async create(
    userId: string,
    evaluationId: string,
    data: {
      name: string;
      description?: string;
      prompt?: string;
      weight?: number;
      enabled?: boolean;
    }
  ): Promise<EvaluationCriterion> {
    // Verify evaluation ownership
    await this.evaluationsService.findById(userId, evaluationId);

    const criterion = await criteriaRepository.create(evaluationId, {
      name: data.name,
      description: data.description,
      prompt: data.prompt,
      weight: data.weight,
      enabled: data.enabled ?? true,
    });

    return transformDecimal(criterion);
  }

  /**
   * Update a criterion
   */
  async update(
    userId: string,
    id: string,
    data: {
      name?: string;
      description?: string | null;
      prompt?: string | null;
      weight?: number;
      enabled?: boolean;
    }
  ): Promise<EvaluationCriterion> {
    const criterion = await criteriaRepository.findById(id);
    if (!criterion) {
      throw new AppError(404, 'NOT_FOUND', 'Criterion not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.findById(userId, criterion.evaluationId);

    const updateData: Prisma.EvaluationCriterionUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.prompt !== undefined) updateData.prompt = data.prompt;
    if (data.weight !== undefined) updateData.weight = data.weight;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;

    const updated = await criteriaRepository.update(id, updateData);
    return transformDecimal(updated);
  }

  /**
   * Delete a criterion
   */
  async delete(userId: string, id: string): Promise<void> {
    const criterion = await criteriaRepository.findById(id);
    if (!criterion) {
      throw new AppError(404, 'NOT_FOUND', 'Criterion not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.findById(userId, criterion.evaluationId);

    await criteriaRepository.delete(id);
  }
}

/**
 * Runs Service
 */
export class RunsService {
  private evaluationsService = new EvaluationsService();

  /**
   * Create a new run
   */
  async create(
    userId: string,
    evaluationId: string,
    data?: {
      modelParameters?: Record<string, unknown>;
    }
  ): Promise<EvaluationRun> {
    // Verify evaluation ownership
    await this.evaluationsService.findById(userId, evaluationId);

    const run = await runsRepository.create(evaluationId, {
      status: 'pending',
      modelParameters: data?.modelParameters as Prisma.JsonObject,
    });

    return transformResponse(run);
  }

  /**
   * Update a run
   */
  async update(
    userId: string,
    id: string,
    data: {
      status?: 'pending' | 'running' | 'completed' | 'failed';
      results?: Record<string, unknown>;
      errorMessage?: string | null;
      totalTokensInput?: number;
      totalTokensOutput?: number;
    }
  ): Promise<EvaluationRun> {
    const run = await runsRepository.findByIdWithResults(id);
    if (!run) {
      throw new AppError(404, 'NOT_FOUND', 'Run not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.findById(userId, run.evaluationId);

    const updateData: Prisma.EvaluationRunUpdateInput = {};
    if (data.status !== undefined) updateData.status = data.status;
    if (data.results !== undefined) updateData.results = data.results as Prisma.JsonObject;
    if (data.errorMessage !== undefined) updateData.errorMessage = data.errorMessage;
    if (data.totalTokensInput !== undefined) updateData.totalTokensInput = data.totalTokensInput;
    if (data.totalTokensOutput !== undefined) updateData.totalTokensOutput = data.totalTokensOutput;

    if (data.status === 'completed' || data.status === 'failed') {
      updateData.completedAt = new Date();
    }

    const updated = await runsRepository.update(id, updateData);
    return transformResponse(updated);
  }

  /**
   * Delete a run
   */
  async delete(userId: string, id: string): Promise<void> {
    const run = await runsRepository.findByIdWithResults(id);
    if (!run) {
      throw new AppError(404, 'NOT_FOUND', 'Run not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.findById(userId, run.evaluationId);

    await runsRepository.delete(id);
  }

  /**
   * Get run results
   */
  async getResults(userId: string, id: string): Promise<TestCaseResult[]> {
    const run = await runsRepository.findByIdWithResults(id);
    if (!run) {
      throw new AppError(404, 'NOT_FOUND', 'Run not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.findById(userId, run.evaluationId);

    return run.testCaseResults.map((r) => transformResponse(r));
  }

  /**
   * Add result to a run
   */
  async addResult(
    userId: string,
    runId: string,
    data: {
      testCaseId: string;
      modelOutput?: string;
      scores?: Record<string, number>;
      aiFeedback?: Record<string, unknown>;
      latencyMs?: number;
      tokensInput?: number;
      tokensOutput?: number;
      passed?: boolean;
      errorMessage?: string;
    }
  ): Promise<TestCaseResult> {
    const run = await runsRepository.findByIdWithResults(runId);
    if (!run) {
      throw new AppError(404, 'NOT_FOUND', 'Run not found');
    }

    // Verify evaluation ownership
    await this.evaluationsService.findById(userId, run.evaluationId);

    const result = await testCaseResultsRepository.create({
      evaluation: { connect: { id: run.evaluationId } },
      testCase: { connect: { id: data.testCaseId } },
      run: { connect: { id: runId } },
      modelOutput: data.modelOutput,
      scores: (data.scores as Prisma.JsonObject) || {},
      aiFeedback: (data.aiFeedback as Prisma.JsonObject) || {},
      latencyMs: data.latencyMs || 0,
      tokensInput: data.tokensInput || 0,
      tokensOutput: data.tokensOutput || 0,
      passed: data.passed || false,
      errorMessage: data.errorMessage,
    });

    return transformResponse(result);
  }
}

// Export singleton instances
export const evaluationsService = new EvaluationsService();
export const testCasesService = new TestCasesService();
export const criteriaService = new CriteriaService();
export const runsService = new RunsService();
