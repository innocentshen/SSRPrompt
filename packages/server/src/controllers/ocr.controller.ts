import type { Request, Response } from 'express';
import { z } from 'zod';
import { ocrService } from '../services/ocr.service.js';
import { OcrResultsRequestSchema, UpdateOcrProviderSettingsSchema, UpdateOcrSystemProviderSettingsSchema } from '@ssrprompt/shared';

const OcrProviderSchema = z.enum(['paddle', 'paddle_vl', 'paddle_vl_1_5', 'datalab', 'mineru', 'multimodal_model']);
const OcrCredentialSourceSchema = z.enum(['system', 'custom']);

const OcrTestOverrideSchema = z.object({
  provider: OcrProviderSchema.optional(),
  credentialSource: OcrCredentialSourceSchema.optional(),
  baseUrl: z.string().url().nullable().optional(),
  apiKey: z.string().nullable().optional(),
  multimodal: z.object({
    modelId: z.string().uuid().nullable().optional(),
    prompt: z.string().min(1).nullable().optional(),
    temperature: z.coerce.number().min(0).max(2).nullable().optional(),
    topP: z.coerce.number().min(0).max(1).nullable().optional(),
    maxTokens: z.coerce.number().int().positive().nullable().optional(),
    frequencyPenalty: z.coerce.number().min(-2).max(2).nullable().optional(),
    presencePenalty: z.coerce.number().min(-2).max(2).nullable().optional(),
    pdfToImages: z.boolean().optional(),
  }).optional(),
});

export const ocrController = {
  async getSettings(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const settings = await ocrService.getSettings(userId);
    res.json({ data: settings });
  },

  async updateSettings(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const data = UpdateOcrProviderSettingsSchema.passthrough().parse(req.body);
    const settings = await ocrService.updateSettings(userId, data);
    res.json({ data: settings });
  },

  async getSystemSettings(_req: Request, res: Response): Promise<void> {
    const settings = await ocrService.getSystemSettings();
    res.json({ data: settings });
  },

  async updateSystemSettings(req: Request, res: Response): Promise<void> {
    const data = UpdateOcrSystemProviderSettingsSchema.parse(req.body);
    const settings = await ocrService.updateSystemSettings(data);
    res.json({ data: settings });
  },

  async test(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    if (!req.file) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'file is required', requestId: req.requestId } });
      return;
    }

    const overrideRaw = {
      provider: typeof req.body.provider === 'string' && req.body.provider.trim() ? req.body.provider.trim() : undefined,
      credentialSource: typeof req.body.credentialSource === 'string' && req.body.credentialSource.trim() ? req.body.credentialSource.trim() : undefined,
      baseUrl: typeof req.body.baseUrl === 'string' && req.body.baseUrl.trim() ? req.body.baseUrl.trim() : undefined,
      apiKey: typeof req.body.apiKey === 'string' && req.body.apiKey.trim() ? req.body.apiKey : undefined,
      multimodal: {
        modelId: typeof req.body.multimodalModelId === 'string' && req.body.multimodalModelId.trim() ? req.body.multimodalModelId.trim() : undefined,
        prompt: typeof req.body.multimodalPrompt === 'string' && req.body.multimodalPrompt.trim() ? req.body.multimodalPrompt.trim() : undefined,
        temperature: typeof req.body.multimodalTemperature === 'string' && req.body.multimodalTemperature.trim() ? Number(req.body.multimodalTemperature) : undefined,
        topP: typeof req.body.multimodalTopP === 'string' && req.body.multimodalTopP.trim() ? Number(req.body.multimodalTopP) : undefined,
        maxTokens: typeof req.body.multimodalMaxTokens === 'string' && req.body.multimodalMaxTokens.trim() ? Number(req.body.multimodalMaxTokens) : undefined,
        frequencyPenalty: typeof req.body.multimodalFrequencyPenalty === 'string' && req.body.multimodalFrequencyPenalty.trim() ? Number(req.body.multimodalFrequencyPenalty) : undefined,
        presencePenalty: typeof req.body.multimodalPresencePenalty === 'string' && req.body.multimodalPresencePenalty.trim() ? Number(req.body.multimodalPresencePenalty) : undefined,
        pdfToImages: typeof req.body.multimodalPdfToImages === 'string'
          ? req.body.multimodalPdfToImages === 'true'
          : undefined,
      },
    };

    const hasOverride = Object.entries(overrideRaw).some(([key, value]) => {
      if (key !== 'multimodal') return value !== undefined;
      return value && typeof value === 'object' && Object.values(value).some((item) => item !== undefined);
    });
    const parsedOverride = hasOverride ? OcrTestOverrideSchema.parse(overrideRaw) : undefined;

    const result = await ocrService.test(
      userId,
      {
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        filename: req.file.originalname,
      },
      parsedOverride
    );

    res.json({ data: result });
  },

  async getResults(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const data = OcrResultsRequestSchema.parse(req.body);
    const results = await ocrService.getResults(userId, data.fileIds, data.provider);
    res.json({ data: results });
  },
};
