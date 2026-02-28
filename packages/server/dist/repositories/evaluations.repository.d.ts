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