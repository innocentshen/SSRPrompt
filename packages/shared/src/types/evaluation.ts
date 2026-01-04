// Evaluation Types
import type { FileAttachment } from './trace';
export type { FileAttachment };

export type EvaluationStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ModelParameters {
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens?: number;
}

export interface EvaluationConfig {
  pass_threshold?: number;
  model_parameters?: ModelParameters;
  inherited_from_prompt?: boolean;
}

export interface Evaluation {
  id: string;
  userId: string;
  name: string;
  promptId: string | null;
  modelId: string | null;
  judgeModelId: string | null;
  status: EvaluationStatus;
  config: EvaluationConfig;
  results: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateEvaluationDto {
  name: string;
  promptId?: string;
  modelId?: string;
  judgeModelId?: string;
  config?: EvaluationConfig;
}

export interface UpdateEvaluationDto {
  name?: string;
  promptId?: string | null;
  modelId?: string | null;
  judgeModelId?: string | null;
  status?: EvaluationStatus;
  config?: EvaluationConfig;
  results?: Record<string, unknown>;
  completedAt?: string | null;
}

// Test Case Types
export interface TestCase {
  id: string;
  evaluationId: string;
  name: string;
  inputText: string;
  inputVariables: Record<string, string>;
  attachments: FileAttachment[];
  expectedOutput: string | null;
  notes: string | null;
  orderIndex: number;
  createdAt: string;
}

export interface CreateTestCaseDto {
  name?: string;
  inputText: string;
  inputVariables?: Record<string, string>;
  attachments?: FileAttachment[];
  expectedOutput?: string;
  notes?: string;
  orderIndex?: number;
}

export interface UpdateTestCaseDto {
  name?: string;
  inputText?: string;
  inputVariables?: Record<string, string>;
  attachments?: FileAttachment[];
  expectedOutput?: string | null;
  notes?: string | null;
  orderIndex?: number;
}

// Evaluation Criterion Types
export interface EvaluationCriterion {
  id: string;
  evaluationId: string;
  name: string;
  description: string | null;
  prompt: string | null;
  weight: number;
  enabled: boolean;
  createdAt: string;
}

export interface CreateCriterionDto {
  name: string;
  description?: string;
  prompt?: string;
  weight?: number;
  enabled?: boolean;
}

export interface UpdateCriterionDto {
  name?: string;
  description?: string | null;
  prompt?: string | null;
  weight?: number;
  enabled?: boolean;
}

// Evaluation Run Types
export interface EvaluationRun {
  id: string;
  evaluationId: string;
  status: EvaluationStatus;
  results: Record<string, unknown>;
  errorMessage: string | null;
  totalTokensInput: number;
  totalTokensOutput: number;
  modelParameters: ModelParameters | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

// Test Case Result Types
export interface TestCaseResult {
  id: string;
  evaluationId: string;
  testCaseId: string;
  runId: string | null;
  modelOutput: string | null;
  scores: Record<string, number>;
  aiFeedback: Record<string, string>;
  latencyMs: number;
  tokensInput: number;
  tokensOutput: number;
  passed: boolean;
  errorMessage: string | null;
  createdAt: string;
}

// Evaluation Detail (with all related entities)
export interface EvaluationDetail extends Evaluation {
  testCases: TestCase[];
  criteria: EvaluationCriterion[];
  runs: EvaluationRun[];
}
