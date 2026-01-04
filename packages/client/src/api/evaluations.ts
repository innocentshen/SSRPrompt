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
  model?: { id: string; name: string; modelId: string } | null;
  judgeModel?: { id: string; name: string; modelId: string } | null;
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
  create: (evaluationId: string, modelParameters?: Record<string, unknown>) =>
    apiClient.post<EvaluationRun>(`/evaluations/${evaluationId}/runs`, { modelParameters }),

  /**
   * Delete a run
   */
  delete: (id: string) => apiClient.delete<void>(`/runs/${id}`),

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
      tokensInput?: number;
      tokensOutput?: number;
      passed?: boolean;
      errorMessage?: string;
    }
  ) => apiClient.post<TestCaseResult>(`/runs/${runId}/results`, data),
};
