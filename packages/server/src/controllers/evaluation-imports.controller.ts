import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '@ssrprompt/shared';
import {
  evaluationImportsService,
  normalizeEvaluationImportLocale,
  type EvaluationImportMode,
} from '../services/evaluation-imports.service.js';
import { enqueueEvaluationImport } from '../services/evaluation-import-queue.service.js';

type MulterRequest = Request & { file?: Express.Multer.File };

const CreateZipImportSchema = z.object({
  mode: z.enum(['create', 'append', 'overwrite']),
  targetEvaluationId: z.string().uuid().optional(),
});

const ExportEvaluationQuerySchema = z.object({
  includeAttachments: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .optional(),
  lang: z.string().optional(),
});

const TemplateQuerySchema = z.object({
  lang: z.string().optional(),
});

export const evaluationImportsController = {
  /**
   * GET /evaluation-imports/template
   * Download a template ZIP (import.xlsx + README + sample attachment).
   */
  async downloadTemplate(req: Request, res: Response): Promise<void> {
    const query = TemplateQuerySchema.parse(req.query);
    const acceptLanguage = Array.isArray(req.headers['accept-language'])
      ? req.headers['accept-language'][0]
      : req.headers['accept-language'];
    const locale = normalizeEvaluationImportLocale(query.lang || acceptLanguage);

    const { filename, buffer } = await evaluationImportsService.buildTemplateZip(locale);

    res.setHeader('Content-Type', 'application/zip');
    const safeFilename = filename.replace(/[^\x20-\x7E]/g, '');
    const encodedFilename = encodeURIComponent(filename);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.status(200).send(buffer);
  },

  /**
   * POST /evaluation-imports/zip
   * Upload a ZIP (import.xlsx + attachments) and start an import job.
   */
  async createZip(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const file = (req as MulterRequest).file;

    if (!file) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Missing ZIP file');
    }

    const body = CreateZipImportSchema.parse(req.body);
    const mode = body.mode as EvaluationImportMode;

    if (mode !== 'create' && !body.targetEvaluationId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'targetEvaluationId is required for append/overwrite');
    }

    const job = await evaluationImportsService.createJob(userId, {
      mode,
      targetEvaluationId: body.targetEvaluationId,
      zip: {
        // multer uses latin1 for originalname, decode as UTF-8
        originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
        mimeType: file.mimetype || 'application/zip',
        size: file.size,
        buffer: file.buffer,
      },
    });

    enqueueEvaluationImport(job.id).catch((error) => {
      console.error('Failed to enqueue evaluation import job:', error);
    });

    res.status(201).json({ data: { jobId: job.id } });
  },

  /**
   * GET /evaluation-imports/:id
   * Get import job status/progress (owner only).
   */
  async getJob(req: Request, res: Response): Promise<void> {
    const job = await evaluationImportsService.getJob(req.user!.userId, req.params.id);
    res.json({ data: job });
  },

  /**
   * GET /evaluation-imports/export/:evaluationId
   * Export evaluation as ZIP in import format.
   */
  async exportEvaluation(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const evaluationId = req.params.evaluationId;
    const query = ExportEvaluationQuerySchema.parse(req.query);
    const acceptLanguage = Array.isArray(req.headers['accept-language'])
      ? req.headers['accept-language'][0]
      : req.headers['accept-language'];
    const locale = normalizeEvaluationImportLocale(query.lang || acceptLanguage);
    const includeAttachments = query.includeAttachments === undefined
      ? true
      : query.includeAttachments === 'true' || query.includeAttachments === '1';

    const { filename, buffer } = await evaluationImportsService.exportEvaluationZip(userId, evaluationId, {
      includeAttachments,
      locale,
    });

    res.setHeader('Content-Type', 'application/zip');
    const safeFilename = filename.replace(/[^\x20-\x7E]/g, '');
    const encodedFilename = encodeURIComponent(filename);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.status(200).send(buffer);
  },
};
