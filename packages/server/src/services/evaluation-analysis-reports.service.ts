import type { Prisma } from '@prisma/client';
import {
  AppError,
  type CreateEvaluationAnalysisReportInput,
  type EvaluationAnalysisReport,
  type UpdateEvaluationAnalysisReportInput,
} from '@ssrprompt/shared';
import { prisma } from '../config/database.js';
import { evaluationsService } from './evaluations.service.js';

function normalizeRunIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeAnalysisData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function mapReport(report: {
  id: string;
  userId: string;
  evaluationId: string;
  scope: 'single' | 'multi';
  title: string | null;
  runIds: unknown;
  analysisModelId: string;
  analysisModelName: string | null;
  promptText: string;
  analysisData: unknown;
  summaryMarkdown: string;
  locale: string | null;
  createdAt: Date;
  updatedAt: Date;
}): EvaluationAnalysisReport {
  return {
    id: report.id,
    userId: report.userId,
    evaluationId: report.evaluationId,
    scope: report.scope,
    title: report.title ?? null,
    runIds: normalizeRunIds(report.runIds),
    analysisModelId: report.analysisModelId,
    analysisModelName: report.analysisModelName ?? null,
    prompt: report.promptText,
    analysisData: normalizeAnalysisData(report.analysisData),
    summaryMarkdown: report.summaryMarkdown,
    locale: report.locale ?? null,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

export class EvaluationAnalysisReportsService {
  private async assertReportExists(
    userId: string,
    evaluationId: string,
    reportId: string
  ): Promise<void> {
    const existing = await prisma.evaluationAnalysisReport.findFirst({
      where: {
        id: reportId,
        userId,
        evaluationId,
      },
      select: { id: true },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Analysis report not found');
    }
  }

  private async assertAnalysisModelAccessible(userId: string, modelId: string): Promise<{ name: string }> {
    const model = await prisma.model.findUnique({
      where: { id: modelId },
      select: {
        id: true,
        name: true,
        provider: {
          select: {
            userId: true,
            isSystem: true,
          },
        },
      },
    });

    if (!model) {
      throw new AppError(404, 'NOT_FOUND', 'Analysis model not found');
    }

    if (model.provider.userId !== userId && !model.provider.isSystem) {
      throw new AppError(403, 'FORBIDDEN', 'Access denied to analysis model');
    }

    return { name: model.name };
  }

  private async assertRunIdsBelongEvaluation(
    evaluationId: string,
    runIds: string[]
  ): Promise<void> {
    if (runIds.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'runIds is required');
    }

    const uniqueRunIds = [...new Set(runIds)];
    if (uniqueRunIds.length !== runIds.length) {
      throw new AppError(400, 'VALIDATION_ERROR', 'runIds must be unique');
    }
    if (uniqueRunIds.length > 20) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A maximum of 20 runs can be analyzed at once');
    }

    const matched = await prisma.evaluationRun.findMany({
      where: {
        evaluationId,
        id: { in: uniqueRunIds },
      },
      select: { id: true },
    });

    if (matched.length !== uniqueRunIds.length) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Some selected runs are invalid for this evaluation');
    }
  }

  async list(userId: string, evaluationId: string): Promise<EvaluationAnalysisReport[]> {
    await evaluationsService.assertOwner(userId, evaluationId);

    const reports = await prisma.evaluationAnalysisReport.findMany({
      where: { userId, evaluationId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return reports.map((report) =>
      mapReport({
        ...report,
        scope: report.scope === 'single' ? 'single' : 'multi',
      })
    );
  }

  async create(
    userId: string,
    evaluationId: string,
    input: CreateEvaluationAnalysisReportInput
  ): Promise<EvaluationAnalysisReport> {
    await evaluationsService.assertOwner(userId, evaluationId);
    await this.assertRunIdsBelongEvaluation(evaluationId, input.runIds);

    if (input.scope === 'single' && input.runIds.length !== 1) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Single analysis requires exactly one run');
    }
    if (input.scope === 'multi' && input.runIds.length < 2) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Multi-run analysis requires at least two runs');
    }

    const analysisModel = await this.assertAnalysisModelAccessible(userId, input.analysisModelId);

    const created = await prisma.evaluationAnalysisReport.create({
      data: {
        userId,
        evaluationId,
        scope: input.scope,
        title: input.title?.trim() || null,
        runIds: input.runIds as unknown as Prisma.JsonArray,
        analysisModelId: input.analysisModelId,
        analysisModelName: analysisModel.name,
        promptText: input.prompt,
        analysisData: input.analysisData as Prisma.JsonObject,
        summaryMarkdown: input.summaryMarkdown,
        locale: input.locale?.trim() || null,
      },
    });

    return mapReport({
      ...created,
      scope: created.scope === 'single' ? 'single' : 'multi',
    });
  }

  async updateTitle(
    userId: string,
    evaluationId: string,
    reportId: string,
    input: UpdateEvaluationAnalysisReportInput
  ): Promise<EvaluationAnalysisReport> {
    await evaluationsService.assertOwner(userId, evaluationId);
    await this.assertReportExists(userId, evaluationId, reportId);

    const updated = await prisma.evaluationAnalysisReport.update({
      where: { id: reportId },
      data: {
        title: input.title?.trim() || null,
      },
    });

    return mapReport({
      ...updated,
      scope: updated.scope === 'single' ? 'single' : 'multi',
    });
  }

  async delete(userId: string, evaluationId: string, reportId: string): Promise<void> {
    await evaluationsService.assertOwner(userId, evaluationId);
    await this.assertReportExists(userId, evaluationId, reportId);

    await prisma.evaluationAnalysisReport.delete({
      where: { id: reportId },
    });
  }
}

export const evaluationAnalysisReportsService = new EvaluationAnalysisReportsService();
