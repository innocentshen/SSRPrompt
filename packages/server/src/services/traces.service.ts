import { Trace } from '@prisma/client';
import { tracesRepository } from '../repositories/traces.repository.js';
import { CreateTraceInput, TraceQueryInput } from '@ssrprompt/shared';

export class TracesService {
  /**
   * Get traces with pagination
   */
  async findPaginated(userId: string, query: TraceQueryInput) {
    return tracesRepository.findPaginated(userId, {
      page: query.page,
      limit: query.limit,
      promptId: query.promptId,
      status: query.status,
    });
  }

  /**
   * Get trace by ID with full details
   */
  async findById(userId: string, id: string): Promise<Trace | null> {
    return tracesRepository.findById(userId, id);
  }

  /**
   * Create a new trace
   */
  async create(userId: string, data: CreateTraceInput): Promise<Trace> {
    return tracesRepository.create(userId, {
      promptId: data.promptId,
      modelId: data.modelId,
      input: data.input,
      output: data.output,
      tokensInput: data.tokensInput ?? 0,
      tokensOutput: data.tokensOutput ?? 0,
      latencyMs: data.latencyMs ?? 0,
      status: data.status ?? 'success',
      errorMessage: data.errorMessage,
      metadata: data.metadata ?? {},
      attachments: data.attachments,
      thinkingContent: data.thinkingContent,
      thinkingTimeMs: data.thinkingTimeMs,
    });
  }

  /**
   * Delete a trace
   */
  async delete(userId: string, id: string): Promise<Trace> {
    return tracesRepository.delete(userId, id);
  }

  /**
   * Delete traces by prompt ID
   */
  async deleteByPrompt(userId: string, promptId: string | null): Promise<number> {
    return tracesRepository.deleteByPrompt(userId, promptId);
  }

  /**
   * Get usage statistics
   */
  async getUsageStats(userId: string) {
    return tracesRepository.getUsageStats(userId);
  }
}

export const tracesService = new TracesService();
