import { Request, Response, NextFunction } from 'express';
import { modelsService } from '../services/index.js';
import { CreateModelSchema, UpdateModelSchema } from '@ssrprompt/shared';

export class ModelsController {
  /**
   * GET /models
   * List all models for the authenticated user
   */
  async listAll(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const models = await modelsService.findAllForUser(userId);

      res.json({ data: models });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /providers/:providerId/models
   * List models for a specific provider
   */
  async listByProvider(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { providerId } = req.params;

      const models = await modelsService.findByProvider(userId, providerId);

      res.json({ data: models });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /models/:id
   * Get a single model by ID
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      const model = await modelsService.findById(userId, id);

      if (!model) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Model not found' },
        });
      }

      res.json({ data: model });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /providers/:providerId/models
   * Create a new model
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { providerId } = req.params;
      const data = CreateModelSchema.parse(req.body);

      const model = await modelsService.create(userId, providerId, data);

      res.status(201).json({ data: model });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /models/:id
   * Update a model
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;
      const data = UpdateModelSchema.parse(req.body);

      const model = await modelsService.update(userId, id, data);

      res.json({ data: model });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /models/:id
   * Delete a model
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      await modelsService.delete(userId, id);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}

export const modelsController = new ModelsController();
