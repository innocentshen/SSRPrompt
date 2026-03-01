import { type EvaluationWithRelations } from '../repositories/evaluations.repository.js';
import type { StoredFile, TestCase, EvaluationCriterion, EvaluationRun, TestCaseResult } from '@prisma/client';
import { type DownloadRange } from './files.service.js';
/**
 * Evaluations Service
 */
export declare class EvaluationsService {
    private assertPromptAccessible;
    private assertModelAccessible;
    /**
     * Verify the evaluation is owned by the current user (not just readable/public).
     */
    assertOwner(userId: string, evaluationId: string): Promise<void>;
    /**
     * Get all evaluations for a user
     */
    findAll(userId: string): Promise<EvaluationWithRelations[]>;
    /**
     * Get evaluation by ID with all relations
     */
    findById(userId: string, id: string): Promise<EvaluationWithRelations>;
    downloadAttachment(requesterUserId: string, evaluationId: string, fileId: string, range: DownloadRange): Promise<{
        meta: StoredFile;
        body: unknown;
        contentLength?: number;
        contentRange?: string;
    }>;
    /**
     * Create a new evaluation
     */
    create(userId: string, data: {
        name: string;
        promptId?: string;
        modelId?: string;
        judgeModelId?: string;
        config?: Record<string, unknown>;
        orderIndex?: number;
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
    }): Promise<EvaluationWithRelations>;
    /**
     * Update an evaluation
     */
    update(userId: string, id: string, data: {
        name?: string;
        promptId?: string | null;
        modelId?: string | null;
        judgeModelId?: string | null;
        status?: 'pending' | 'running' | 'completed' | 'failed';
        config?: Record<string, unknown>;
        results?: Record<string, unknown>;
        isPublic?: boolean;
        shareAttachments?: boolean;
        orderIndex?: number;
        completedAt?: string | null;
    }): Promise<EvaluationWithRelations>;
    /**
     * Delete an evaluation
     */
    delete(userId: string, id: string): Promise<void>;
    /**
     * Copy an evaluation
     */
    copy(userId: string, id: string, newName?: string): Promise<EvaluationWithRelations>;
    /**
     * Update order for multiple evaluations
     */
    updateOrder(userId: string, updates: {
        id: string;
        orderIndex: number;
    }[]): Promise<void>;
}
/**
 * Test Cases Service
 */
export declare class TestCasesService {
    private evaluationsService;
    /**
     * Create a test case
     */
    create(userId: string, evaluationId: string, data: {
        name?: string;
        inputText?: string;
        inputVariables?: Record<string, unknown>;
        attachments?: unknown[];
        expectedOutput?: string;
        notes?: string;
        orderIndex?: number;
    }): Promise<TestCase>;
    /**
     * Update a test case
     */
    update(userId: string, id: string, data: {
        name?: string;
        inputText?: string;
        inputVariables?: Record<string, unknown>;
        attachments?: unknown[];
        expectedOutput?: string | null;
        notes?: string | null;
        orderIndex?: number;
    }): Promise<TestCase>;
    /**
     * Delete a test case
     */
    delete(userId: string, id: string): Promise<void>;
}
/**
 * Criteria Service
 */
export declare class CriteriaService {
    private evaluationsService;
    /**
     * Create a criterion
     */
    create(userId: string, evaluationId: string, data: {
        name: string;
        description?: string;
        prompt?: string;
        weight?: number;
        enabled?: boolean;
    }): Promise<EvaluationCriterion>;
    /**
     * Update a criterion
     */
    update(userId: string, id: string, data: {
        name?: string;
        description?: string | null;
        prompt?: string | null;
        weight?: number;
        enabled?: boolean;
    }): Promise<EvaluationCriterion>;
    /**
     * Delete a criterion
     */
    delete(userId: string, id: string): Promise<void>;
}
/**
 * Runs Service
 */
export declare class RunsService {
    private evaluationsService;
    /**
     * Create a new run
     */
    create(userId: string, evaluationId: string, data?: {
        modelParameters?: Record<string, unknown>;
        testCaseIds?: string[];
    }, options?: {
        status?: 'pending' | 'running' | 'completed' | 'failed';
    }): Promise<EvaluationRun>;
    /**
     * Create a new run and enqueue server-side execution.
     */
    createAndExecute(userId: string, evaluationId: string, data?: {
        modelParameters?: Record<string, unknown>;
        testCaseIds?: string[];
    }): Promise<EvaluationRun>;
    /**
     * Enqueue retrying AI scores for an existing run.
     */
    retryScores(userId: string, runId: string): Promise<EvaluationRun>;
    /**
     * Update a run
     */
    update(userId: string, id: string, data: {
        status?: 'pending' | 'running' | 'completed' | 'failed';
        results?: Record<string, unknown>;
        errorMessage?: string | null;
        totalTokensInput?: number;
        totalTokensOutput?: number;
    }): Promise<EvaluationRun>;
    /**
     * Get run by ID
     */
    getById(userId: string, id: string): Promise<EvaluationRun>;
    /**
     * Delete a run
     */
    delete(userId: string, id: string): Promise<void>;
    /**
     * Abort a run
     */
    abort(userId: string, id: string): Promise<EvaluationRun>;
    /**
     * Get run results
     */
    getResults(userId: string, id: string): Promise<TestCaseResult[]>;
    /**
     * Add result to a run
     */
    addResult(userId: string, runId: string, data: {
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
    }): Promise<TestCaseResult>;
    /**
     * Add results to a run in batches
     */
    addResultsBatch(userId: string, runId: string, results: Array<{
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
    }>): Promise<TestCaseResult[]>;
}
export declare const evaluationsService: EvaluationsService;
export declare const testCasesService: TestCasesService;
export declare const criteriaService: CriteriaService;
export declare const runsService: RunsService;
//# sourceMappingURL=evaluations.service.d.ts.map