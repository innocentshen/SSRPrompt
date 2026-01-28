import { Request, Response, NextFunction } from 'express';
import { providersService } from '../services/index.js';
import { CreateProviderSchema, UpdateProviderSchema, TestConnectionSchema, DiscoverProviderModelsSchema } from '@ssrprompt/shared';

function maskApiKey(apiKey: string): string {
  const value = apiKey?.trim();
  if (!value) return '';
  return `${value.substring(0, 8)}...`;
}

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
        apiKey: maskApiKey(p.apiKey),
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
          error: { code: 'NOT_FOUND', message: 'Provider not found', requestId: req.requestId },
        });
      }

      // Mask API key in response
      res.json({
        data: {
          ...provider,
          apiKey: maskApiKey(provider.apiKey),
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
      const isAdmin = req.user?.roles?.includes('admin') ?? false;
      const data = CreateProviderSchema.parse(req.body);

      const provider = await providersService.create(userId, data, isAdmin);

      res.status(201).json({
        data: {
          ...provider,
          apiKey: maskApiKey(provider.apiKey),
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
      const isAdmin = req.user?.roles?.includes('admin') ?? false;
      const { id } = req.params;
      const data = UpdateProviderSchema.parse(req.body);

      const provider = await providersService.update(userId, id, data, isAdmin);

      res.json({
        data: {
          ...provider,
          apiKey: maskApiKey(provider.apiKey),
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
      const isAdmin = req.user?.roles?.includes('admin') ?? false;
      const { id } = req.params;

      await providersService.delete(userId, id, isAdmin);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /providers/test-connection
   * Test connection to a provider API
   */
  async testConnection(req: Request, res: Response, next: NextFunction) {
    try {
      const data = TestConnectionSchema.parse(req.body);

      const result = await providersService.testConnection(data);

      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /providers/:providerId/models/discover
   * Discover models from a provider API (uses saved key by default).
   */
  async discoverModels(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { providerId } = req.params;
      const data = DiscoverProviderModelsSchema.parse(req.body);
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;

      const models = await providersService.discoverModels(userId, providerId, data, origin);

      res.json({ data: models });
    } catch (error) {
      next(error);
    }
  }
}

export const providersController = new ProvidersController();
