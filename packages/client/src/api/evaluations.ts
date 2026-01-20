import apiClient from './client';
import type {
  Evaluation,
  TestCase,
  EvaluationCriterion,
  EvaluationRun,
  TestCaseResult,
  CreateEvaluationDto,
  UpdateEvaluationDto,
  CreateTestCaseDto,
  UpdateTestCaseDto,
  CreateCriterionDto,
  UpdateCriterionDto,
} from '@ssrprompt/shared';

/**
 * Evaluation with relations (returned by API)
 */
export interface EvaluationWithRelations extends Evaluation {
  prompt?: { id: string; name: string; currentVersion: number } | null;
  model?: { id: string; name: string; modelId: string; provider?: { type: string } } | null;
  judgeModel?: { id: string; name: string; modelId: string; provider?: { type: string } } | null;
  testCases?: TestCase[];
  criteria?: EvaluationCriterion[];
  runs?: EvaluationRun[];
  _count?: {
    testCases: number;
    criteria: number;
    runs: number;
  };
}

/**
 * Evaluations API
 */
export const evaluationsApi = {
  /**
   * Get all evaluations
   */
  list: () => apiClient.get<EvaluationWithRelations[]>('/evaluations'),

  /**
   * Get evaluation by ID with all relations
   */
  getById: (id: string) => apiClient.get<EvaluationWithRelations>(`/evaluations/${id}`),

  /**
   * Create a new evaluation
   */
  create: (
    data: CreateEvaluationDto & {
      testCases?: CreateTestCaseDto[];
      criteria?: CreateCriterionDto[];
    }
  ) => apiClient.post<EvaluationWithRelations>('/evaluations', data),

  /**
   * Update an evaluation
   */
  update: (id: string, data: UpdateEvaluationDto) =>
    apiClient.put<EvaluationWithRelations>(`/evaluations/${id}`, data),

  /**
   * Delete an evaluation
   */
  delete: (id: string) => apiClient.delete<void>(`/evaluations/${id}`),

  /**
   * Copy an evaluation
   */
  copy: (id: string, name?: string) =>
    apiClient.post<EvaluationWithRelations>(`/evaluations/${id}/copy`, { name }),

  /**
   * Batch update order for multiple evaluations
   */
  batchUpdateOrder: (updates: { id: string; orderIndex: number }[]) =>
    apiClient.put<{ success: boolean }>('/evaluations/batch-order', updates),
};

/**
 * Test Cases API
 */
export const testCasesApi = {
  /**
   * Create a test case
   */
  create: (evaluationId: string, data: CreateTestCaseDto) =>
    apiClient.post<TestCase>(`/evaluations/${evaluationId}/test-cases`, data),

  /**
   * Update a test case
   */
  update: (id: string, data: UpdateTestCaseDto) =>
    apiClient.put<TestCase>(`/test-cases/${id}`, data),

  /**
   * Delete a test case
   */
  delete: (id: string) => apiClient.delete<void>(`/test-cases/${id}`),
};

/**
 * Criteria API
 */
export const criteriaApi = {
  /**
   * Create a criterion
   */
  create: (evaluationId: string, data: CreateCriterionDto) =>
    apiClient.post<EvaluationCriterion>(`/evaluations/${evaluationId}/criteria`, data),

  /**
   * Update a criterion
   */
  update: (id: string, data: UpdateCriterionDto) =>
    apiClient.put<EvaluationCriterion>(`/criteria/${id}`, data),

  /**
   * Delete a criterion
   */
  delete: (id: string) => apiClient.delete<void>(`/criteria/${id}`),
};

/**
 * Runs API
 */
export const runsApi = {
  /**
   * Create a run
   */
  create: (
    evaluationId: string,
    options?: { modelParameters?: Record<string, unknown>; testCaseIds?: string[] }
  ) =>
    apiClient.post<EvaluationRun>(`/evaluations/${evaluationId}/runs`, {
      modelParameters: options?.modelParameters,
      testCaseIds: options?.testCaseIds,
    }),

  /**
   * Create and execute a run on the server
   */
  execute: (
    evaluationId: string,
    options?: { modelParameters?: Record<string, unknown>; testCaseIds?: string[] }
  ) =>
    apiClient.post<EvaluationRun>(`/evaluations/${evaluationId}/runs/execute`, {
      modelParameters: options?.modelParameters,
      testCaseIds: options?.testCaseIds,
    }),

  /**
   * Update a run
   */
  update: (
    id: string,
    data: {
      status?: 'pending' | 'running' | 'completed' | 'failed';
      results?: Record<string, unknown>;
      errorMessage?: string | null;
      totalTokensInput?: number;
      totalTokensOutput?: number;
    }
  ) => apiClient.put<EvaluationRun>(`/runs/${id}`, data),

  /**
   * Get a run by ID
   */
  getById: (id: string) => apiClient.get<EvaluationRun>(`/runs/${id}`),

  /**
   * Delete a run
   */
  delete: (id: string) => apiClient.delete<void>(`/runs/${id}`),

  /**
   * Abort a run
   */
  abort: (id: string) => apiClient.post<EvaluationRun>(`/runs/${id}/abort`),

  /**
   * Get run results
   */
  getResults: (id: string) => apiClient.get<TestCaseResult[]>(`/runs/${id}/results`),

  /**
   * Add result to a run
   */
  addResult: (
    runId: string,
    data: {
      testCaseId: string;
      modelOutput?: string;
      scores?: Record<string, number>;
      aiFeedback?: Record<string, unknown>;
      latencyMs?: number;
      ocrLatencyMs?: number;
      tokensInput?: number;
      tokensOutput?: number;
      passed?: boolean;
      errorMessage?: string | null;
    }
  ) => apiClient.post<TestCaseResult>(`/runs/${runId}/results`, data),

  /**
   * Add results to a run in batch
   */
  addResultsBatch: (
    runId: string,
    results: Array<{
      testCaseId: string;
      modelOutput?: string;
      scores?: Record<string, number>;
      aiFeedback?: Record<string, unknown>;
      latencyMs?: number;
      ocrLatencyMs?: number;
      tokensInput?: number;
      tokensOutput?: number;
      passed?: boolean;
      errorMessage?: string | null;
    }>
  ) => apiClient.post<TestCaseResult[]>(`/runs/${runId}/results/batch`, { results }),
};
