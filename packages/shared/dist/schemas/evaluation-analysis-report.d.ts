import { z } from 'zod';
export declare const EvaluationAnalysisScopeSchema: z.ZodEnum<["single", "multi"]>;
export declare const CreateEvaluationAnalysisReportSchema: z.ZodObject<{
    scope: z.ZodEnum<["single", "multi"]>;
    runIds: z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], string[]>;
    analysisModelId: z.ZodString;
    prompt: z.ZodString;
    analysisData: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    summaryMarkdown: z.ZodString;
    title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    locale: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    prompt: string;
    scope: "single" | "multi";
    runIds: string[];
    analysisModelId: string;
    analysisData: Record<string, unknown>;
    summaryMarkdown: string;
    title?: string | null | undefined;
    locale?: string | null | undefined;
}, {
    prompt: string;
    scope: "single" | "multi";
    runIds: string[];
    analysisModelId: string;
    analysisData: Record<string, unknown>;
    summaryMarkdown: string;
    title?: string | null | undefined;
    locale?: string | null | undefined;
}>;
export type CreateEvaluationAnalysisReportInput = z.infer<typeof CreateEvaluationAnalysisReportSchema>;
export declare const UpdateEvaluationAnalysisReportSchema: z.ZodObject<{
    title: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    title: string | null;
}, {
    title: string | null;
}>;
export type UpdateEvaluationAnalysisReportInput = z.infer<typeof UpdateEvaluationAnalysisReportSchema>;
//# sourceMappingURL=evaluation-analysis-report.d.ts.map