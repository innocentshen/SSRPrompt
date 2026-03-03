import { TenantRepository, type FindOptions } from './base.repository.js';
import type { Prisma, Evaluation, TestCase, EvaluationCriterion, EvaluationRun, TestCaseResult, ProviderType } from '@prisma/client';
/**
 * Evaluation with all relations
 */
export type EvaluationWithRelations = Evaluation & {
    prompt?: {
        id: string;
        name: string;
        currentVersion: number;
    } | null;
    model?: {
        id: string;
        name: string;
        modelId: string;
        provider: {
            type: ProviderType;
        };
    } | null;
    judgeModel?: {
        id: string;
        name: string;
        modelId: string;
        provider: {
            type: ProviderType;
        };
    } | null;
    testCases?: TestCase[];
    criteria?: EvaluationCriterion[];
    runs?: EvaluationRun[];
};
/**
 * Evaluations Repository
 */
declare class EvaluationsRepositoryClass extends TenantRepository<Evaluation, Prisma.EvaluationCreateInput, Prisma.EvaluationUpdateInput> {
    protected delegate: Prisma.EvaluationDelegate<import("@prisma/client/runtime/library").DefaultArgs>;
    protected entityName: string;
    /**
     * Find all evaluations for a user (list view - minimal data)
     * Includes user's own evaluations and public evaluations from others.
     * Users should NOT see other users' private evaluations.
     */
    findAll(userId: string, options?: FindOptions): Promise<EvaluationWithRelations[]>;
    /**
     * Find evaluation by ID with all relations
     * Allows access to own evaluations or public evaluations
     */
    findByIdWithRelations(userId: string, id: string): Promise<EvaluationWithRelations | null>;
    /**
     * Create evaluation with optional test cases and criteria
     */
    createWithRelations(userId: string, data: Prisma.EvaluationCreateInput, testCases?: Omit<Prisma.TestCaseCreateInput, 'evaluation'>[], criteria?: Omit<Prisma.EvaluationCriterionCreateInput, 'evaluation'>[]): Promise<EvaluationWithRelations>;
    /**
     * Copy an evaluation with all its test cases and criteria
     */
    copy(userId: string, id: string, newName: string): Promise<EvaluationWithRelations>;
    /**
     * Update order for multiple evaluations
     */
    updateOrder(userId: string, updates: {
        id: string;
        orderIndex: number;
    }[]): Promise<void>;
    /**
     * Find evaluations associated with a specific prompt.
     * Returns lightweight data for evaluation selection list.
     */
    findByPromptId(userId: string, promptId: string): Promise<{
        model: {
            name: string;
            id: string;
            modelId: string;
        } | null;
        name: string;
        id: string;
        runs: {
            createdAt: Date;
        }[];
        judgeModel: {
            name: string;
            id: string;
            modelId: string;
        } | null;
        _count: {
            runs: number;
        };
    }[]>;
    /**
     * Find completed runs for an evaluation with their test case results.
     * Used for aggregating evaluation statistics.
     */
    findCompletedRunsByEvaluationId(userId: string, evaluationId: string, limit?: number): Promise<({
        evaluation: {
            model: {
                name: string;
                id: string;
                modelId: string;
            } | null;
            criteria: {
                prompt: string | null;
                name: string;
                id: string;
                createdAt: Date;
                description: string | null;
                enabled: boolean;
                evaluationId: string;
                weight: Prisma.Decimal;
            }[];
            judgeModel: {
                name: string;
                id: string;
                modelId: string;
            } | null;
            testCases: {
                name: string;
                id: string;
                createdAt: Date;
                orderIndex: number;
                attachments: Prisma.JsonValue;
                evaluationId: string;
                inputText: string;
                inputVariables: Prisma.JsonValue;
                expectedOutput: string | null;
                notes: string | null;
            }[];
        } & {
            status: import("@prisma/client").$Enums.EvaluationStatus;
            name: string;
            userId: string;
            id: string;
            createdAt: Date;
            config: Prisma.JsonValue;
            results: Prisma.JsonValue;
            orderIndex: number;
            completedAt: Date | null;
            isPublic: boolean;
            shareAttachments: boolean;
            promptId: string | null;
            modelId: string | null;
            judgeModelId: string | null;
        };
        testCaseResults: {
            id: string;
            createdAt: Date;
            errorMessage: string | null;
            tokensInput: number;
            tokensOutput: number;
            latencyMs: number;
            evaluationId: string;
            modelOutput: string | null;
            scores: Prisma.JsonValue;
            aiFeedback: Prisma.JsonValue;
            ocrLatencyMs: number;
            passed: boolean;
            runId: string | null;
            testCaseId: string;
        }[];
    } & {
        status: import("@prisma/client").$Enums.EvaluationStatus;
        id: string;
        createdAt: Date;
        results: Prisma.JsonValue;
        completedAt: Date | null;
        errorMessage: string | null;
        title: string | null;
        evaluationId: string;
        totalTokensInput: number;
        totalTokensOutput: number;
        modelParameters: Prisma.JsonValue | null;
        runConfig: Prisma.JsonValue | null;
        startedAt: Date;
    })[]>;
}
/**
 * Test Cases Repository
 */
export declare class TestCasesRepository {
    /**
     * Create a test case
     */
    create(evaluationId: string, data: Omit<Prisma.TestCaseCreateInput, 'evaluation'>): Promise<TestCase>;
    /**
     * Update a test case
     */
    update(id: string, data: Prisma.TestCaseUpdateInput): Promise<TestCase>;
    /**
     * Delete a test case
     */
    delete(id: string): Promise<void>;
    /**
     * Find test case by ID
     */
    findById(id: string): Promise<TestCase | null>;
    /**
     * Batch update order
     */
    batchUpdateOrder(updates: {
        id: string;
        orderIndex: number;
    }[]): Promise<void>;
}
/**
 * Evaluation Criteria Repository
 */
export declare class CriteriaRepository {
    /**
     * Create a criterion
     */
    create(evaluationId: string, data: Omit<Prisma.EvaluationCriterionCreateInput, 'evaluation'>): Promise<EvaluationCriterion>;
    /**
     * Update a criterion
     */
    update(id: string, data: Prisma.EvaluationCriterionUpdateInput): Promise<EvaluationCriterion>;
    /**
     * Delete a criterion
     */
    delete(id: string): Promise<void>;
    /**
     * Find criterion by ID
     */
    findById(id: string): Promise<EvaluationCriterion | null>;
}
/**
 * Evaluation Runs Repository
 */
export declare class RunsRepository {
    /**
     * Find run by ID (lightweight)
     */
    findById(id: string): Promise<EvaluationRun | null>;
    /**
     * Create a run
     */
    create(evaluationId: string, data?: Partial<Prisma.EvaluationRunCreateInput>): Promise<EvaluationRun>;
    /**
     * Update a run
     */
    update(id: string, data: Prisma.EvaluationRunUpdateInput): Promise<EvaluationRun>;
    /**
     * Delete a run and its results
     */
    delete(id: string): Promise<void>;
    /**
     * Find run by ID with results
     */
    findByIdWithResults(id: string): Promise<(EvaluationRun & {
        testCaseResults: TestCaseResult[];
    }) | null>;
    /**
     * Find runs by evaluation ID
     */
    findByEvaluationId(evaluationId: string): Promise<EvaluationRun[]>;
}
/**
 * Test Case Results Repository
 */
export declare class TestCaseResultsRepository {
    /**
     * Create a result
     */
    create(data: Prisma.TestCaseResultCreateInput): Promise<TestCaseResult>;
    /**
     * Create many results
     */
    createMany(evaluationId: string, runId: string, results: Omit<Prisma.TestCaseResultCreateManyInput, 'evaluationId' | 'runId'>[]): Promise<void>;
    /**
     * Find results by run ID
     */
    findByRunId(runId: string): Promise<TestCaseResult[]>;
}
export declare const evaluationsRepository: EvaluationsRepositoryClass;
export declare const testCasesRepository: TestCasesRepository;
export declare const criteriaRepository: CriteriaRepository;
export declare const runsRepository: RunsRepository;
export declare const testCaseResultsRepository: TestCaseResultsRepository;
export {};
//# sourceMappingURL=evaluations.repository.d.ts.map