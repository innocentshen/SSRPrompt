import { Trace, Prisma } from '@prisma/client';
import { TenantRepository } from './base.repository.js';
import { prisma } from '../config/database.js';
import { transformResponse } from '../utils/transform.js';

type TraceDelegate = typeof prisma.trace;

export class TracesRepository extends TenantRepository<
  Trace,
  Prisma.TraceCreateInput,
  Prisma.TraceUpdateInput,
  TraceDelegate
> {
  protected delegate = prisma.trace;
  protected entityName = 'Trace';

  /**
   * Find traces for a user with pagination (list view - exclude large fields)
   */
  async findPaginated(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      promptId?: string;
      status?: 'success' | 'error';
    } = {}
  ): Promise<{ data: Partial<Trace>[]; total: number; page: number; limit: number }> {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 50, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.TraceWhereInput = {
      userId,
      ...(options.promptId && { promptId: options.promptId }),
      ...(options.status && { status: options.status }),
    };

    const [traces, total] = await Promise.all([
      this.delegate.findMany({
        where,
        select: {
          id: true,
          userId: true,
          promptId: true,
          modelId: true,
          tokensInput: true,
          tokensOutput: true,
          latencyMs: true,
          status: true,
          createdAt: true,
          // Exclude large fields: input, output, thinkingContent, attachments
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.delegate.count({ where }),
    ]);

    return {
      data: traces.map(transformResponse),
      total,
      page,
      limit,
    };
  }

  /**
   * Find trace by ID with full details
   */
  async findById(userId: string, id: string): Promise<Trace | null> {
    const trace = await this.delegate.findUnique({
      where: { id },
      include: {
        prompt: { select: { id: true, name: true } },
        model: { select: { id: true, name: true, modelId: true } },
      },
    });

    if (!trace) return null;
    if (trace.userId !== userId) {
      throw new Error('Access denied');
    }

    return transformResponse(trace);
  }

  /**
   * Create a trace
   */
  async create(userId: string, data: Omit<Prisma.TraceCreateInput, 'userId'>): Promise<Trace> {
    const trace = await this.delegate.create({
      data: { ...data, userId },
    });

    return transformResponse(trace);
  }

  /**
   * Delete traces by prompt ID
   */
  async deleteByPrompt(userId: string, promptId: string | null): Promise<number> {
    const result = await this.delegate.deleteMany({
      where: {
        userId,
        promptId: promptId ?? null,
      },
    });

    return result.count;
  }

  /**
   * Get usage statistics for a user
   */
  async getUsageStats(userId: string): Promise<{
    totalTraces: number;
    totalTokensInput: number;
    totalTokensOutput: number;
    averageLatency: number;
  }> {
    const stats = await this.delegate.aggregate({
      where: { userId },
      _count: { id: true },
      _sum: {
        tokensInput: true,
        tokensOutput: true,
      },
      _avg: {
        latencyMs: true,
      },
    });

    return {
      totalTraces: stats._count.id,
      totalTokensInput: stats._sum.tokensInput ?? 0,
      totalTokensOutput: stats._sum.tokensOutput ?? 0,
      averageLatency: Math.round(stats._avg.latencyMs ?? 0),
    };
  }
}

export const tracesRepository = new TracesRepository();
