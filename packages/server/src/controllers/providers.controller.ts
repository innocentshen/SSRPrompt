import { Request, Response, NextFunction } from 'express';
import { providersService } from '../services/index.js';
import { CreateProviderSchema, UpdateProviderSchema } from '@ssrprompt/shared';

export class ProvidersController {
  /**
   * GET /providers
   * List all providers for the authenticated user
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const providers = await providersService.findAll(userId);

      // Mask API keys in response
      const maskedProviders = providers.map((p) => ({
        ...p,
        apiKey: p.apiKey.substring(0, 8) + '...',
      }));

      res.json({ data: maskedProviders });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /providers/:id
   * Get a single provider by ID
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      const provider = await providersService.findWithModels(userId, id);

      if (!provider) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Provider not found' },
        });
      }

      // Mask API key in response
      res.json({
        data: {
          ...provider,
          apiKey: provider.apiKey.substring(0, 8) + '...',
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /providers
   * Create a new provider
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const data = CreateProviderSchema.parse(req.body);

      const provider = await providersService.create(userId, data);

      res.status(201).json({
        data: {
          ...provider,
          apiKey: provider.apiKey.substring(0, 8) + '...',
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /providers/:id
   * Update a provider
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;
      const data = UpdateProviderSchema.parse(req.body);

      const provider = await providersService.update(userId, id, data);

      res.json({
        data: {
          ...provider,
          apiKey: provider.apiKey.substring(0, 8) + '...',
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /providers/:id
   * Delete a provider
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      await providersService.delete(userId, id);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}

export const providersController = new ProvidersController();
