import { TenantRepository } from './base.repository.js';
import { prisma } from '../config/database.js';
/**
 * Evaluations Repository
 */
class EvaluationsRepositoryClass extends TenantRepository {
    constructor() {
        super(...arguments);
        Object.defineProperty(this, "delegate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: prisma.evaluation
        });
        Object.defineProperty(this, "entityName", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'Evaluation'
        });
    }
    /**
     * Find all evaluations for a user (list view - minimal data)
     * Includes user's own evaluations and public evaluations from others.
     * Users should NOT see other users' private evaluations.
     */
    async findAll(userId, options) {
        // CRITICAL: Validate userId to prevent security bypass
        // If userId is undefined/null/empty, Prisma would ignore the condition,
        // causing the OR to match ALL records (security vulnerability)
        if (!userId || typeof userId !== 'string') {
            throw new Error('userId is required for evaluations query');
        }
        // Build the access control condition:
        // - User's own evaluations (both public and private)
        // - Other users' public evaluations only
        const accessCondition = {
            OR: [
                { userId: userId }, // User's own evaluations (explicit assignment)
                { isPublic: true }, // Public evaluations from anyone
            ],
        };
        // Combine access control with any additional filters using AND
        // This ensures the access control cannot be bypassed by options.where
        const whereClause = options?.where
            ? { AND: [accessCondition, options.where] }
            : accessCondition;
        return prisma.evaluation.findMany({
            where: whereClause,
            select: {
                id: true,
                userId: true,
                name: true,
                promptId: true,
                modelId: true,
                judgeModelId: true,
                status: true,
                config: true,
                results: true,
                orderIndex: true,
                isPublic: true,
                shareAttachments: true,
                createdAt: true,
                completedAt: true,
                prompt: {
                    select: { id: true, name: true, currentVersion: true },
                },
                model: {
                    select: {
                        id: true,
                        name: true,
                        modelId: true,
                        provider: { select: { type: true } },
                    },
                },
                judgeModel: {
                    select: {
                        id: true,
                        name: true,
                        modelId: true,
                        provider: { select: { type: true } },
                    },
                },
                _count: {
                    select: { testCases: true, criteria: true, runs: true },
                },
            },
            orderBy: options?.orderBy || [{ orderIndex: 'asc' }, { createdAt: 'desc' }],
            skip: options?.skip,
            take: options?.take,
        });
    }
    /**
     * Find evaluation by ID with all relations
     * Allows access to own evaluations or public evaluations
     */
    async findByIdWithRelations(userId, id) {
        const evaluation = await prisma.evaluation.findUnique({
            where: { id },
            include: {
                prompt: {
                    select: { id: true, name: true, currentVersion: true },
                },
                model: {
                    select: {
                        id: true,
                        name: true,
                        modelId: true,
                        provider: { select: { type: true } },
                    },
                },
                judgeModel: {
                    select: {
                        id: true,
                        name: true,
                        modelId: true,
                        provider: { select: { type: true } },
                    },
                },
                testCases: {
                    orderBy: { orderIndex: 'asc' },
                },
                criteria: {
                    orderBy: { createdAt: 'asc' },
                },
                runs: {
                    orderBy: { createdAt: 'desc' },
                    take: 10, // Limit to recent runs
                },
            },
        });
        if (!evaluation)
            return null;
        if (evaluation.userId !== userId && !evaluation.isPublic)
            return null;
        return evaluation;
    }
    /**
     * Create evaluation with optional test cases and criteria
     */
    async createWithRelations(userId, data, testCases, criteria) {
        return prisma.evaluation.create({
            data: {
                ...data,
                user: { connect: { id: userId } },
                testCases: testCases
                    ? {
                        create: testCases.map((tc, index) => ({
                            ...tc,
                            orderIndex: tc.orderIndex ?? index,
                        })),
                    }
                    : undefined,
                criteria: criteria
                    ? {
                        create: criteria,
                    }
                    : undefined,
            },
            include: {
                prompt: {
                    select: { id: true, name: true, currentVersion: true },
                },
                model: {
                    select: {
                        id: true,
                        name: true,
                        modelId: true,
                        provider: { select: { type: true } },
                    },
                },
                judgeModel: {
                    select: {
                        id: true,
                        name: true,
                        modelId: true,
                        provider: { select: { type: true } },
                    },
                },
                testCases: {
                    orderBy: { orderIndex: 'asc' },
                },
                criteria: {
                    orderBy: { createdAt: 'asc' },
                },
                runs: true,
            },
        });
    }
    /**
     * Copy an evaluation with all its test cases and criteria
     */
    async copy(userId, id, newName) {
        const original = await this.findByIdWithRelations(userId, id);
        if (!original) {
            throw new Error('Evaluation not found');
        }
        return prisma.evaluation.create({
            data: {
                userId,
                name: newName,
                promptId: original.promptId,
                modelId: original.modelId,
                judgeModelId: original.judgeModelId,
                status: 'pending',
                config: original.config,
                results: {},
                testCases: {
                    create: (original.testCases || []).map((tc, index) => ({
                        name: tc.name,
                        inputText: tc.inputText,
                        inputVariables: tc.inputVariables,
                        attachments: tc.attachments,
                        expectedOutput: tc.expectedOutput,
                        notes: tc.notes,
                        orderIndex: index,
                    })),
                },
                criteria: {
                    create: (original.criteria || []).map((c) => ({
                        name: c.name,
                        description: c.description,
                        prompt: c.prompt,
                        weight: c.weight,
                        enabled: c.enabled,
                    })),
                },
            },
            include: {
                prompt: {
                    select: { id: true, name: true, currentVersion: true },
                },
                model: {
                    select: {
                        id: true,
                        name: true,
                        modelId: true,
                        provider: { select: { type: true } },
                    },
                },
                judgeModel: {
                    select: {
                        id: true,
                        name: true,
                        modelId: true,
                        provider: { select: { type: true } },
                    },
                },
                testCases: {
                    orderBy: { orderIndex: 'asc' },
                },
                criteria: {
                    orderBy: { createdAt: 'asc' },
                },
                runs: true,
            },
        });
    }
    /**
     * Update order for multiple evaluations
     */
    async updateOrder(userId, updates) {
        await prisma.$transaction(updates.map((u) => this.delegate.updateMany({
            where: { id: u.id, userId },
            data: { orderIndex: u.orderIndex },
        })));
    }
    /**
     * Find evaluations associated with a specific prompt.
     * Returns lightweight data for evaluation selection list.
     */
    async findByPromptId(userId, promptId) {
        return prisma.evaluation.findMany({
            where: {
                promptId,
                userId,
            },
            select: {
                id: true,
                name: true,
                model: {
                    select: {
                        id: true,
                        name: true,
                        modelId: true,
                    },
                },
                judgeModel: {
                    select: {
                        id: true,
                        name: true,
                        modelId: true,
                    },
                },
                _count: {
                    select: { runs: true },
                },
                runs: {
                    where: { status: 'completed' },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: {
                        createdAt: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    /**
     * Find completed runs for an evaluation with their test case results.
     * Used for aggregating evaluation statistics.
     */
    async findCompletedRunsByEvaluationId(userId, evaluationId, limit = 20) {
        return prisma.evaluationRun.findMany({
            where: {
                evaluationId,
                status: 'completed',
                evaluation: {
                    userId,
                },
            },
            include: {
                testCaseResults: true,
                evaluation: {
                    include: {
                        testCases: {
                            orderBy: { orderIndex: 'asc' },
                        },
                        criteria: {
                            orderBy: { createdAt: 'asc' },
                        },
                        model: {
                            select: { id: true, name: true, modelId: true },
                        },
                        judgeModel: {
                            select: { id: true, name: true, modelId: true },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }
}
/**
 * Test Cases Repository
 */
export class TestCasesRepository {
    /**
     * Create a test case
     */
    async create(evaluationId, data) {
        // Get max order index
        const maxOrder = await prisma.testCase.aggregate({
            where: { evaluationId },
            _max: { orderIndex: true },
        });
        return prisma.testCase.create({
            data: {
                ...data,
                orderIndex: data.orderIndex ?? (maxOrder._max.orderIndex ?? -1) + 1,
                evaluation: { connect: { id: evaluationId } },
            },
        });
    }
    /**
     * Update a test case
     */
    async update(id, data) {
        return prisma.testCase.update({
            where: { id },
            data,
        });
    }
    /**
     * Delete a test case
     */
    async delete(id) {
        await prisma.testCase.delete({
            where: { id },
        });
    }
    /**
     * Find test case by ID
     */
    async findById(id) {
        return prisma.testCase.findUnique({
            where: { id },
        });
    }
    /**
     * Batch update order
     */
    async batchUpdateOrder(updates) {
        await prisma.$transaction(updates.map((u) => prisma.testCase.update({
            where: { id: u.id },
            data: { orderIndex: u.orderIndex },
        })));
    }
}
/**
 * Evaluation Criteria Repository
 */
export class CriteriaRepository {
    /**
     * Create a criterion
     */
    async create(evaluationId, data) {
        return prisma.evaluationCriterion.create({
            data: {
                ...data,
                evaluation: { connect: { id: evaluationId } },
            },
        });
    }
    /**
     * Update a criterion
     */
    async update(id, data) {
        return prisma.evaluationCriterion.update({
            where: { id },
            data,
        });
    }
    /**
     * Delete a criterion
     */
    async delete(id) {
        await prisma.evaluationCriterion.delete({
            where: { id },
        });
    }
    /**
     * Find criterion by ID
     */
    async findById(id) {
        return prisma.evaluationCriterion.findUnique({
            where: { id },
        });
    }
}
/**
 * Evaluation Runs Repository
 */
export class RunsRepository {
    /**
     * Find run by ID (lightweight)
     */
    async findById(id) {
        return prisma.evaluationRun.findUnique({
            where: { id },
        });
    }
    /**
     * Create a run
     */
    async create(evaluationId, data) {
        return prisma.evaluationRun.create({
            data: {
                ...data,
                evaluation: { connect: { id: evaluationId } },
            },
        });
    }
    /**
     * Update a run
     */
    async update(id, data) {
        return prisma.evaluationRun.update({
            where: { id },
            data,
        });
    }
    /**
     * Delete a run and its results
     */
    async delete(id) {
        await prisma.evaluationRun.delete({
            where: { id },
        });
    }
    /**
     * Find run by ID with results
     */
    async findByIdWithResults(id) {
        return prisma.evaluationRun.findUnique({
            where: { id },
            include: {
                testCaseResults: true,
            },
        });
    }
    /**
     * Find runs by evaluation ID
     */
    async findByEvaluationId(evaluationId) {
        return prisma.evaluationRun.findMany({
            where: { evaluationId },
            orderBy: { createdAt: 'desc' },
        });
    }
}
/**
 * Test Case Results Repository
 */
export class TestCaseResultsRepository {
    /**
     * Create a result
     */
    async create(data) {
        return prisma.testCaseResult.create({
            data,
        });
    }
    /**
     * Create many results
     */
    async createMany(evaluationId, runId, results) {
        await prisma.testCaseResult.createMany({
            data: results.map((r) => ({
                ...r,
                evaluationId,
                runId,
            })),
        });
    }
    /**
     * Find results by run ID
     */
    async findByRunId(runId) {
        return prisma.testCaseResult.findMany({
            where: { runId },
        });
    }
}
// Export singleton instances
export const evaluationsRepository = new EvaluationsRepositoryClass();
export const testCasesRepository = new TestCasesRepository();
export const criteriaRepository = new CriteriaRepository();
export const runsRepository = new RunsRepository();
export const testCaseResultsRepository = new TestCaseResultsRepository();
//# sourceMappingURL=evaluations.repository.js.map