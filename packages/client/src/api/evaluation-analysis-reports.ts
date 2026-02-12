import apiClient from './client';
import type {
  CreateEvaluationAnalysisReportDto,
  EvaluationAnalysisReport,
  UpdateEvaluationAnalysisReportDto,
} from '@ssrprompt/shared';

export const evaluationAnalysisReportsApi = {
  list: (evaluationId: string) =>
    apiClient.get<EvaluationAnalysisReport[]>(`/evaluations/${evaluationId}/analysis-reports`),

  create: (evaluationId: string, data: CreateEvaluationAnalysisReportDto) =>
    apiClient.post<EvaluationAnalysisReport>(`/evaluations/${evaluationId}/analysis-reports`, data),

  updateTitle: (evaluationId: string, reportId: string, data: UpdateEvaluationAnalysisReportDto) =>
    apiClient.put<EvaluationAnalysisReport>(`/evaluations/${evaluationId}/analysis-reports/${reportId}`, data),

  delete: (evaluationId: string, reportId: string) =>
    apiClient.delete<void>(`/evaluations/${evaluationId}/analysis-reports/${reportId}`),
};
