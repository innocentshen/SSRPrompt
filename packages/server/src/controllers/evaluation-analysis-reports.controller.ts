import type { Request, Response } from 'express';
import { CreateEvaluationAnalysisReportSchema, UpdateEvaluationAnalysisReportSchema } from '@ssrprompt/shared';
import { evaluationAnalysisReportsService } from '../services/evaluation-analysis-reports.service.js';

export const evaluationAnalysisReportsController = {
  async list(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { evaluationId } = req.params;
    const reports = await evaluationAnalysisReportsService.list(userId, evaluationId);
    res.json({ data: reports });
  },

  async create(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { evaluationId } = req.params;
    const input = CreateEvaluationAnalysisReportSchema.parse(req.body);
    const report = await evaluationAnalysisReportsService.create(userId, evaluationId, input);
    res.status(201).json({ data: report });
  },

  async updateTitle(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { evaluationId, reportId } = req.params;
    const input = UpdateEvaluationAnalysisReportSchema.parse(req.body);
    const report = await evaluationAnalysisReportsService.updateTitle(userId, evaluationId, reportId, input);
    res.json({ data: report });
  },

  async delete(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { evaluationId, reportId } = req.params;
    await evaluationAnalysisReportsService.delete(userId, evaluationId, reportId);
    res.status(204).send();
  },
};
