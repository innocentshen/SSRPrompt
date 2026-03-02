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
    shareAttachments: boolean;
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
    shareAttachments?: boolean;
    completedAt?: string | null;
    orderIndex?: number;
}
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
export interface RunConfig {
    promptId?: string | null;
    promptName?: string | null;
    promptVersion?: number | null;
    modelId?: string | null;
    modelName?: string | null;
    judgeModelId?: string | null;
    judgeModelName?: string | null;
    passThreshold?: number;
    fileProcessing?: string;
    ocrProvider?: OcrProvider;
    ocrProviderResolved?: OcrProvider;
    testCaseIds?: string[];
}
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
export interface EvaluationDetail extends Evaluation {
    testCases: TestCase[];
    criteria: EvaluationCriterion[];
    runs: EvaluationRun[];
}
/**
 * Detail of a frequently failing test case.
 */
export interface FailureCaseDetail {
    testCaseId: string;
    testCaseName: string;
    failCount: number;
    totalCount: number;
    latestModelOutput: string;
    latestAiFeedback: Record<string, string>;
    expectedOutput: string | null;
    latestScores: Record<string, number>;
}
/**
 * Aggregated summary of an evaluation's runs.
 * Used by the optimization system to provide data-driven suggestions.
 */
export interface EvaluationSummary {
    evaluationId: string;
    evaluationName: string;
    modelName: string;
    judgeModelName: string;
    totalRuns: number;
    latestRunAt: string | null;
    avgPassRate: number;
    avgCriterionScores: Record<string, number>;
    avgLatencyMs: number;
    avgTokens: number;
    topFailures: FailureCaseDetail[];
    recentDelta?: {
        passRateChange: number;
        criterionChanges: Record<string, number>;
    };
    criteriaNames?: string[];
    /** Stats for ALL test cases (both passed and failed), used by verification panel */
    testCaseStats?: TestCaseStat[];
}
/**
 * Per-test-case aggregate stats for verification panel.
 */
export interface TestCaseStat {
    testCaseId: string;
    testCaseName: string;
    inputText: string;
    inputVariables: Record<string, string>;
    expectedOutput: string | null;
    passCount: number;
    totalCount: number;
    latestPassed: boolean;
    latestScore: number;
    latestModelOutput: string;
}
/**
 * Lightweight evaluation list item for the evaluation selector.
 */
export interface EvaluationListItem {
    id: string;
    name: string;
    modelName: string;
    judgeModelName: string;
    runCount: number;
    latestRunAt: string | null;
    avgPassRate: number;
}
//# sourceMappingURL=evaluation.d.ts.map