import { z } from 'zod';

export const EvaluationAnalysisScopeSchema = z.enum(['single', 'multi']);

export const CreateEvaluationAnalysisReportSchema = z.object({
  scope: EvaluationAnalysisScopeSchema,
  runIds: z
    .array(z.string().uuid())
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'runIds must be unique',
    }),
  analysisModelId: z.string().uuid(),
  prompt: z.string().min(1).max(20000),
  analysisData: z.record(z.unknown()),
  summaryMarkdown: z.string().min(1).max(200000),
  title: z.string().trim().max(200).nullable().optional(),
  locale: z.string().trim().max(32).nullable().optional(),
});

export type CreateEvaluationAnalysisReportInput = z.infer<typeof CreateEvaluationAnalysisReportSchema>;

export const UpdateEvaluationAnalysisReportSchema = z.object({
  title: z.string().trim().max(200).nullable(),
});

export type UpdateEvaluationAnalysisReportInput = z.infer<typeof UpdateEvaluationAnalysisReportSchema>;
