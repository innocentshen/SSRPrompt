import { TenantRepository, type FindOptions } from './base.repository.js';
import { prisma } from '../config/database.js';
import type { Prisma, Evaluation, TestCase, EvaluationCriterion, EvaluationRun, TestCaseResult, ProviderType } from '@prisma/client';

/**
 * Evaluation with all relations
 */
export type EvaluationWithRelations = Evaluation & {
  prompt?: { id: string; name: string; currentVersion: number } | null;
  model?: { id: string; name: string; modelId: string; provider: { type: ProviderType } } | null;
  judgeModel?: { id: string; name: string; modelId: string; provider: { type: ProviderType } } | null;
  testCases?: TestCase[];
  criteria?: EvaluationCriterion[];
  runs?: EvaluationRun[];
};

/**
 * Evaluations Repository
 */
class EvaluationsRepositoryClass extends TenantRepository<
  Evaluation,
  Prisma.EvaluationCreateInput,
  Prisma.EvaluationUpdateInput
> {
  protected delegate = prisma.evaluation;
  protected entityName = 'Evaluation';

  /**
   * Find all evaluations for a user (list view - minimal data)
   * Includes user's own evaluations and public evaluations from others.
   * Users should NOT see other users' private evaluations.
   */
  async findAll(userId: string, options?: FindOptions): Promise<EvaluationWithRelations[]> {
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
        { userId: userId },   // User's own evaluations (explicit assignment)
        { isPublic: true },   // Public evaluations from anyone
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
    }) as unknown as EvaluationWithRelations[];
  }

  /**
   * Find evaluation by ID with all relations
   * Allows access to own evaluations or public evaluations
   */
  async findByIdWithRelations(userId: string, id: string): Promise<EvaluationWithRelations | null> {
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

    if (!evaluation) return null;
    if (evaluation.userId !== userId && !evaluation.isPublic) return null;

    return evaluation;
  }

  /**
   * Create evaluation with optional test cases and criteria
   */
  async createWithRelations(
    userId: string,
    data: Prisma.EvaluationCreateInput,
    testCases?: Omit<Prisma.TestCaseCreateInput, 'evaluation'>[],
    criteria?: Omit<Prisma.EvaluationCriterionCreateInput, 'evaluation'>[]
  ): Promise<EvaluationWithRelations> {
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
  async copy(userId: string, id: string, newName: string): Promise<EvaluationWithRelations> {
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
        config: original.config as Prisma.JsonObject,
        results: {},
        testCases: {
          create: (original.testCases || []).map((tc, index) => ({
            name: tc.name,
            inputText: tc.inputText,
            inputVariables: tc.inputVariables as Prisma.JsonObject,
            attachments: tc.attachments as Prisma.JsonArray,
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
  async updateOrder(userId: string, updates: { id: string; orderIndex: number }[]): Promise<void> {
    await prisma.$transaction(
      updates.map((u) =>
        this.delegate.updateMany({
          where: { id: u.id, userId },
          data: { orderIndex: u.orderIndex },
        })
      )
    );
  }
}

/**
 * Test Cases Repository
 */
export class TestCasesRepository {
  /**
   * Create a test case
   */
  async create(evaluationId: string, data: Omit<Prisma.TestCaseCreateInput, 'evaluation'>): Promise<TestCase> {
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
  async update(id: string, data: Prisma.TestCaseUpdateInput): Promise<TestCase> {
    return prisma.testCase.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete a test case
   */
  async delete(id: string): Promise<void> {
    await prisma.testCase.delete({
      where: { id },
    });
  }

  /**
   * Find test case by ID
   */
  async findById(id: string): Promise<TestCase | null> {
    return prisma.testCase.findUnique({
      where: { id },
    });
  }

  /**
   * Batch update order
   */
  async batchUpdateOrder(updates: { id: string; orderIndex: number }[]): Promise<void> {
    await prisma.$transaction(
      updates.map((u) =>
        prisma.testCase.update({
          where: { id: u.id },
          data: { orderIndex: u.orderIndex },
        })
      )
    );
  }
}

/**
 * Evaluation Criteria Repository
 */
export class CriteriaRepository {
  /**
   * Create a criterion
   */
  async create(
    evaluationId: string,
    data: Omit<Prisma.EvaluationCriterionCreateInput, 'evaluation'>
  ): Promise<EvaluationCriterion> {
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
  async update(id: string, data: Prisma.EvaluationCriterionUpdateInput): Promise<EvaluationCriterion> {
    return prisma.evaluationCriterion.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete a criterion
   */
  async delete(id: string): Promise<void> {
    await prisma.evaluationCriterion.delete({
      where: { id },
    });
  }

  /**
   * Find criterion by ID
   */
  async findById(id: string): Promise<EvaluationCriterion | null> {
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
   * Create a run
   */
  async create(evaluationId: string, data?: Partial<Prisma.EvaluationRunCreateInput>): Promise<EvaluationRun> {
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
  async update(id: string, data: Prisma.EvaluationRunUpdateInput): Promise<EvaluationRun> {
    return prisma.evaluationRun.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete a run and its results
   */
  async delete(id: string): Promise<void> {
    await prisma.evaluationRun.delete({
      where: { id },
    });
  }

  /**
   * Find run by ID with results
   */
  async findByIdWithResults(id: string): Promise<(EvaluationRun & { testCaseResults: TestCaseResult[] }) | null> {
    return prisma.evaluationRun.findUnique({
      where: { id },
      include: {
        testCaseResults: {
          include: {
            testCase: true,
          },
        },
      },
    });
  }

  /**
   * Find runs by evaluation ID
   */
  async findByEvaluationId(evaluationId: string): Promise<EvaluationRun[]> {
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
  async create(data: Prisma.TestCaseResultCreateInput): Promise<TestCaseResult> {
    return prisma.testCaseResult.create({
      data,
    });
  }

  /**
   * Create many results
   */
  async createMany(
    evaluationId: string,
    runId: string,
    results: Omit<Prisma.TestCaseResultCreateManyInput, 'evaluationId' | 'runId'>[]
  ): Promise<void> {
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
  async findByRunId(runId: string): Promise<TestCaseResult[]> {
    return prisma.testCaseResult.findMany({
      where: { runId },
      include: {
        testCase: true,
      },
    });
  }
}

// Export singleton instances
export const evaluationsRepository = new EvaluationsRepositoryClass();
export const testCasesRepository = new TestCasesRepository();
export const criteriaRepository = new CriteriaRepository();
export const runsRepository = new RunsRepository();
export const testCaseResultsRepository = new TestCaseResultsRepository();
