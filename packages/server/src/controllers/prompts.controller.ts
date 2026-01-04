import { Request, Response, NextFunction } from 'express';
import { promptsService } from '../services/prompts.service.js';
import { CreatePromptSchema, UpdatePromptSchema, CreateVersionSchema } from '@ssrprompt/shared';
import { z } from 'zod';

export class PromptsController {
  /**
   * GET /prompts
   * List all prompts for the authenticated user
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const prompts = await promptsService.findAll(userId);

      res.json({ data: prompts });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /prompts/:id
   * Get a single prompt by ID
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      const prompt = await promptsService.findById(userId, id);

      if (!prompt) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Prompt not found' },
        });
      }

      res.json({ data: prompt });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /prompts
   * Create a new prompt
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const data = CreatePromptSchema.parse(req.body);

      const prompt = await promptsService.create(userId, data);

      res.status(201).json({ data: prompt });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /prompts/:id
   * Update a prompt
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;
      const data = UpdatePromptSchema.parse(req.body);

      const prompt = await promptsService.update(userId, id, data);

      res.json({ data: prompt });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /prompts/:id
   * Delete a prompt
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      await promptsService.delete(userId, id);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /prompts/:id/order
   * Update prompt order
   */
  async updateOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;
      const { orderIndex } = z.object({ orderIndex: z.number().int().min(0) }).parse(req.body);

      const prompt = await promptsService.update(userId, id, { orderIndex });

      res.json({ data: prompt });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /prompts/batch-order
   * Update order for multiple prompts
   */
  async batchUpdateOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const updates = z
        .array(z.object({ id: z.string().uuid(), orderIndex: z.number().int().min(0) }))
        .parse(req.body);

      await promptsService.updateOrder(userId, updates);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /prompts/:id/versions
   * Get versions for a prompt
   */
  async getVersions(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      const versions = await promptsService.getVersions(userId, id);

      res.json({ data: versions });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /prompts/:id/versions
   * Create a new version
   */
  async createVersion(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;
      const data = CreateVersionSchema.parse(req.body);

      const version = await promptsService.createVersion(userId, id, data);

      res.status(201).json({ data: version });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /prompts/:id/versions/:version
   * Get a specific version
   */
  async getVersion(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id, version: versionStr } = req.params;
      const version = parseInt(versionStr, 10);

      if (isNaN(version)) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Invalid version number' },
        });
      }

      const versionData = await promptsService.getVersion(userId, id, version);

      if (!versionData) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Version not found' },
        });
      }

      res.json({ data: versionData });
    } catch (error) {
      next(error);
    }
  }
}

export const promptsController = new PromptsController();
