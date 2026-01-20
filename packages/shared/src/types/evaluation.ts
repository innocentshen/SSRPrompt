// Evaluation Types
import type { FileAttachment } from './trace.js';
import type { OcrProvider } from './ocr.js';

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
  /**
   * Execution mode for evaluation runs.
   * - sequential: run test cases one by one (default).
   * - parallel: run test cases concurrently.
   */
  execution_mode?: 'sequential' | 'parallel';
  /**
   * How to process file attachments when sending to the model.
   * - auto: vision models send files directly; non-vision models use OCR (if available).
   * - vision: send files directly to the model (requires vision-capable model).
   * - ocr: always OCR PDF/images and send extracted text to the model.
   * - none: do not send attachments to the model.
   */
  file_processing?: 'auto' | 'vision' | 'ocr' | 'none';
  /**
   * Optional OCR provider override for this evaluation (only used when file_processing resolves to "ocr").
   * When not set, the user's OCR settings provider is used.
   */
  ocr_provider?: OcrProvider;
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
  orderIndex: number;
  isPublic: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateEvaluationDto {
  name: string;
  promptId?: string;
  modelId?: string;
  judgeModelId?: string;
  config?: EvaluationConfig;
  orderIndex?: number;
}

export interface UpdateEvaluationDto {
  name?: string;
  promptId?: string | null;
  modelId?: string | null;
  judgeModelId?: string | null;
  status?: EvaluationStatus;
  config?: EvaluationConfig;
  results?: Record<string, unknown>;
  isPublic?: boolean;
  completedAt?: string | null;
  orderIndex?: number;
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

// Run Config - 运行时配置快照
export interface RunConfig {
  promptId?: string | null;
  promptName?: string | null;
  promptVersion?: number | null;
  modelId?: string | null;
  modelName?: string | null;
  judgeModelId?: string | null;
  judgeModelName?: string | null;
  passThreshold?: number;
  executionMode?: 'sequential' | 'parallel';
  fileProcessing?: string;
  ocrProvider?: OcrProvider;
  ocrProviderResolved?: OcrProvider;
  testCaseIds?: string[];
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
  runConfig: RunConfig | null;
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
  ocrLatencyMs: number;
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
