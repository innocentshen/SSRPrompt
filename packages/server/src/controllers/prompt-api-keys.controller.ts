import type { Request, Response } from 'express';
import { CreatePromptApiKeySchema } from '@ssrprompt/shared';
import { promptApiKeysService } from '../services/prompt-api-keys.service.js';

export const promptApiKeysController = {
  async list(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const keys = await promptApiKeysService.list(userId);
    res.json({ data: keys });
  },

  async create(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const input = CreatePromptApiKeySchema.parse(req.body);
    const created = await promptApiKeysService.create(userId, input);
    res.status(201).json({ data: created });
  },

  async revoke(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const revoked = await promptApiKeysService.revoke(userId, req.params.id);
    res.json({ data: revoked });
  },
};
