import { type CreateEvaluationAnalysisReportInput, type EvaluationAnalysisReport, type UpdateEvaluationAnalysisReportInput } from '@ssrprompt/shared';
export declare class EvaluationAnalysisReportsService {
    private assertReportExists;
    private assertAnalysisModelAccessible;
    private assertRunIdsBelongEvaluation;
    list(userId: string, evaluationId: string): Promise<EvaluationAnalysisReport[]>;
    create(userId: string, evaluationId: string, input: CreateEvaluationAnalysisReportInput): Promise<EvaluationAnalysisReport>;
    updateTitle(userId: string, evaluationId: string, reportId: string, input: UpdateEvaluationAnalysisReportInput): Promise<EvaluationAnalysisReport>;
    delete(userId: string, evaluationId: string, reportId: string): Promise<void>;
}
export declare const evaluationAnalysisReportsService: EvaluationAnalysisReportsService;
//# sourceMappingURL=evaluation-analysis-reports.service.d.ts.map