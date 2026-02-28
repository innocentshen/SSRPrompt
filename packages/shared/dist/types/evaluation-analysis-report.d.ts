export type EvaluationAnalysisScope = 'single' | 'multi';
export interface EvaluationAnalysisReport {
    id: string;
    userId: string;
    evaluationId: string;
    scope: EvaluationAnalysisScope;
    title: string | null;
    runIds: string[];
    analysisModelId: string;
    analysisModelName: string | null;
    prompt: string;
    analysisData: Record<string, unknown>;
    summaryMarkdown: string;
    locale: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface CreateEvaluationAnalysisReportDto {
    scope: EvaluationAnalysisScope;
    runIds: string[];
    analysisModelId: string;
    prompt: string;
    analysisData: Record<string, unknown>;
    summaryMarkdown: string;
    title?: string | null;
    locale?: string | null;
}
export interface UpdateEvaluationAnalysisReportDto {
    title: string | null;
}
//# sourceMappingURL=evaluation-analysis-report.d.ts.map