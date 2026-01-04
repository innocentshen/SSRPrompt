import { Request, Response, NextFunction } from 'express';
import { tracesService } from '../services/traces.service.js';
import { CreateTraceSchema, TraceQuerySchema } from '@ssrprompt/shared';

export class TracesController {
  /**
   * GET /traces
   * List traces with pagination
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const query = TraceQuerySchema.parse(req.query);

      const result = await tracesService.findPaginated(userId, query);

      res.json({
        data: result.data,
        meta: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: Math.ceil(result.total / result.limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /traces/:id
   * Get a single trace by ID
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      const trace = await tracesService.findById(userId, id);

      if (!trace) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Trace not found' },
        });
      }

      res.json({ data: trace });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /traces
   * Create a new trace
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const data = CreateTraceSchema.parse(req.body);

      const trace = await tracesService.create(userId, data);

      res.status(201).json({ data: trace });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /traces/:id
   * Delete a trace
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      await tracesService.delete(userId, id);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /traces/by-prompt/:promptId
   * Delete all traces for a prompt
   */
  async deleteByPrompt(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { promptId } = req.params;

      // Handle "null" string for traces without a prompt
      const actualPromptId = promptId === 'null' ? null : promptId;

      const count = await tracesService.deleteByPrompt(userId, actualPromptId);

      res.json({ data: { deleted: count } });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /stats/usage
   * Get usage statistics
   */
  async getUsageStats(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;

      const stats = await tracesService.getUsageStats(userId);

      res.json({ data: stats });
    } catch (error) {
      next(error);
    }
  }
}

export const tracesController = new TracesController();
