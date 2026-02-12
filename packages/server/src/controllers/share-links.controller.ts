import type { Request, Response } from 'express';
import {
  CreateShareLinkSchema,
  ListShareLinksQuerySchema,
  UpdateShareLinkSchema,
} from '@ssrprompt/shared';
import { z } from 'zod';
import { shareLinksService } from '../services/share-links.service.js';

const AccessLogsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return 1;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    }),
  limit: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return 20;
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return 20;
      return Math.min(parsed, 100);
    }),
});

export const shareLinksController = {
  async list(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const query = ListShareLinksQuerySchema.parse(req.query);
    const result = await shareLinksService.list(userId, query);
    res.json({ data: result });
  },

  async create(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const input = CreateShareLinkSchema.parse(req.body);
    const shareLink = await shareLinksService.create(userId, input);
    res.status(201).json({ data: shareLink });
  },

  async update(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const input = UpdateShareLinkSchema.parse(req.body);
    const shareLink = await shareLinksService.update(userId, req.params.id, input);
    res.json({ data: shareLink });
  },

  async revoke(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const shareLink = await shareLinksService.revoke(userId, req.params.id);
    res.json({ data: shareLink });
  },

  async listAccessLogs(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const query = AccessLogsQuerySchema.parse(req.query);
    const logs = await shareLinksService.listAccessLogs(userId, req.params.id, query.page, query.limit);
    res.json({ data: logs });
  },
};

