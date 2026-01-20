import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle, ChevronDown, ChevronRight, Clock, Zap, Paperclip, Eye, FileText, Image, Code, File, RotateCcw, Scale, Copy, Check, Square } from 'lucide-react';
import { Badge, Button, MarkdownRenderer } from '../ui';
import { AttachmentModal } from '../Prompt/AttachmentModal';
import { OcrResultsPanel } from '../Prompt/OcrResultsPanel';
import type { TestCase, TestCaseResult, EvaluationCriterion, FileAttachment, OcrProvider } from '../../types';
import { getFileIconType } from '../../lib/file-utils';

interface EvaluationResultsViewProps {
  testCases: TestCase[];
  results: TestCaseResult[];
  criteria: EvaluationCriterion[];
  overallScores: Record<string, number>;
  summary?: string;
  ocrProvider?: OcrProvider | null;
  onRetryOutput?: (testCaseId: string) => void;
  onRunAiEvaluation?: (testCaseId: string) => void;
  onAbortRetryOutput?: (testCaseId: string) => void;
  onAbortAiEvaluation?: (testCaseId: string) => void;
  retryingOutputTestCaseId?: string | null;
  retryingAiEvaluationTestCaseId?: string | null;
}

export function EvaluationResultsView({
  testCases,
  results,
  criteria,
  overallScores,
  summary,
  ocrProvider,
  onRetryOutput,
  onRunAiEvaluation,
  onAbortRetryOutput,
  onAbortAiEvaluation,
  retryingOutputTestCaseId,
  retryingAiEvaluationTestCaseId,
}: EvaluationResultsViewProps) {
  const { t } = useTranslation('evaluation');
  const { t: tCommon } = useTranslation('common');
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null);
  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(new Set());
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachment | null>(null);
  const [copiedField, setCopiedField] = useState<{ resultId: string; field: 'expected' | 'model' } | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async (text: string, resultId: string, field: 'expected' | 'model') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField({ resultId, field });
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedField(null);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy text:', error);
    }
  };

  // 使用 Map 索引优化查询性能，避免 O(n²) 的查找问题
  const testCaseMap = useMemo(() => {
    return new Map(testCases.map(tc => [tc.id, tc]));
  }, [testCases]);

  const getTestCase = (testCaseId: string) => testCaseMap.get(testCaseId);

  const getTestCaseName = (testCaseId: string, index: number) => {
    const testCase = getTestCase(testCaseId);
    return testCase?.name || t('testCaseNum', { num: index + 1 });
  };

  const getExpectedOutput = (testCaseId: string) => {
    const testCase = getTestCase(testCaseId);
    return testCase?.expectedOutput || null;
  };

  const getTestCaseNotes = (testCaseId: string) => {
    const testCase = getTestCase(testCaseId);
    return testCase?.notes || null;
  };

  const getTestCaseAttachments = (testCaseId: string) => {
    const testCase = getTestCase(testCaseId);
    return testCase?.attachments || [];
  };

  const getFileIcon = (attachment: { type: string; name?: string }) => {
    const iconType = getFileIconType(attachment);
    switch (iconType) {
      case 'image':
        return Image;
      case 'pdf':
        return FileText;
      case 'code':
        return Code;
      case 'text':
        return FileText;
      default:
        return File;
    }
  };

  const toggleOutputExpanded = (resultId: string) => {
    setExpandedOutputs((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) {
        next.delete(resultId);
      } else {
        next.add(resultId);
      }
      return next;
    });
  };

  const enabledCriteria = criteria.filter((c) => c.enabled);

  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  const passRate = totalCount > 0 ? (passedCount / totalCount) * 100 : 0;
  const totalLlmMs = results.reduce((sum, r) => sum + (r.latencyMs || 0), 0);
  const totalOcrMs = results.reduce((sum, r) => sum + (r.ocrLatencyMs || 0), 0);
  const totalMs = totalLlmMs + totalOcrMs;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="p-4 bg-slate-800/50 light:bg-emerald-50 border border-slate-700 light:border-emerald-200 rounded-lg text-center">
          <p className="text-3xl font-bold text-emerald-400 light:text-emerald-600">{passedCount}</p>
          <p className="text-xs text-slate-500 light:text-slate-600 mt-1">{t('passed')}</p>
        </div>
        <div className="p-4 bg-slate-800/50 light:bg-rose-50 border border-slate-700 light:border-rose-200 rounded-lg text-center">
          <p className="text-3xl font-bold text-rose-400 light:text-rose-600">{totalCount - passedCount}</p>
          <p className="text-xs text-slate-500 light:text-slate-600 mt-1">{t('failed')}</p>
        </div>
        <div className="p-4 bg-slate-800/50 light:bg-cyan-50 border border-slate-700 light:border-cyan-200 rounded-lg text-center">
          <p className="text-3xl font-bold text-cyan-400 light:text-cyan-600">{passRate.toFixed(0)}%</p>
          <p className="text-xs text-slate-500 light:text-slate-600 mt-1">{t('passRate')}</p>
        </div>
        <div className="p-4 bg-slate-800/50 light:bg-teal-50 border border-slate-700 light:border-teal-200 rounded-lg text-center">
          <p className="text-3xl font-bold text-teal-400 light:text-teal-600">
            {results.reduce((sum, r) => sum + r.tokensInput, 0).toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 light:text-slate-600 mt-1">{t('inputTokens')}</p>
        </div>
        <div className="p-4 bg-slate-800/50 light:bg-sky-50 border border-slate-700 light:border-sky-200 rounded-lg text-center">
          <p className="text-3xl font-bold text-sky-400 light:text-sky-600">
            {results.reduce((sum, r) => sum + r.tokensOutput, 0).toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 light:text-slate-600 mt-1">{t('outputTokens')}</p>
        </div>
        <div className="p-4 bg-slate-800/50 light:bg-amber-50 border border-slate-700 light:border-amber-200 rounded-lg text-center">
          <p className="text-3xl font-bold text-amber-400 light:text-amber-600">
            {(totalMs / 1000).toFixed(1)}s
          </p>
          <p className="text-xs text-slate-500 light:text-slate-600 mt-1">{t('totalTime')}</p>
          <p className="text-[10px] text-slate-500 light:text-slate-600 mt-1">
            {t('llmTime')}: {(totalLlmMs / 1000).toFixed(1)}s · {t('ocrTime')}: {(totalOcrMs / 1000).toFixed(1)}s
          </p>
        </div>
      </div>

      {Object.keys(overallScores).length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-slate-300 light:text-slate-700 mb-3">{t('scoreOverview')}</h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(overallScores).map(([key, value]) => (
              <div
                key={key}
                className="p-3 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400 light:text-slate-600">{key}</span>
                  <span className="text-lg font-semibold text-cyan-400 light:text-cyan-600">
                    {(value * 10).toFixed(1)}
                  </span>
                </div>
                <div className="mt-2 h-1.5 bg-slate-700 light:bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 light:from-cyan-500 light:to-cyan-400 rounded-full"
                    style={{ width: `${value * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary && (
        <div className="p-4 bg-slate-800/50 light:bg-slate-50 border border-slate-700 light:border-slate-200 rounded-lg">
          <h4 className="text-sm font-medium text-slate-300 light:text-slate-700 mb-2">{t('evaluationSummary')}</h4>
          <p className="text-sm text-slate-400 light:text-slate-600">{summary}</p>
        </div>
      )}

      <div>
        <h4 className="text-sm font-medium text-slate-300 light:text-slate-700 mb-3">{t('detailedResults')}</h4>
        <div className="space-y-2">
          {results.map((result, index) => {
            const attachments = getTestCaseAttachments(result.testCaseId);
            const showOcrResults = result.ocrLatencyMs > 0 && attachments.length > 0;
            return (
            <div
              key={result.id}
              className="border border-slate-700 light:border-slate-200 rounded-lg bg-slate-800/30 light:bg-white overflow-hidden light:shadow-sm"
            >
              <button
                onClick={() =>
                  setExpandedResultId(expandedResultId === result.id ? null : result.id)
                }
                className="w-full flex items-center gap-3 p-4 hover:bg-slate-800/50 light:hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {result.passed ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 light:text-emerald-600 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-rose-500 light:text-rose-600 flex-shrink-0" />
                  )}
                  <span className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">
                    {getTestCaseName(result.testCaseId, index)}
                  </span>
                  {attachments.length > 0 && (
                    <span className="flex items-center gap-1 text-xs text-slate-500 light:text-slate-600">
                      <Paperclip className="w-3 h-3" />
                      {attachments.length}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500 light:text-slate-600">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {t('llmTime')}: {result.latencyMs}ms
                  </span>
                  {result.ocrLatencyMs > 0 && (
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {t('ocrTime')}: {result.ocrLatencyMs}ms
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    {result.tokensInput + result.tokensOutput} tokens
                  </span>
                  {expandedResultId === result.id ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </div>
              </button>

              {expandedResultId === result.id && (
                <div className="p-4 pt-0 space-y-4 border-t border-slate-700/50 light:border-slate-200">
                  {(onRetryOutput || onRunAiEvaluation) && (
                    <div className="flex items-center justify-end gap-2 pt-2">
                      {onRunAiEvaluation && (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onRunAiEvaluation(result.testCaseId)}
                            loading={retryingAiEvaluationTestCaseId === result.testCaseId}
                            disabled={retryingOutputTestCaseId === result.testCaseId}
                            title={t('runAiEvaluation')}
                          >
                            <Scale className="w-3.5 h-3.5" />
                            <span>{t('runAiEvaluation')}</span>
                          </Button>
                          {retryingAiEvaluationTestCaseId === result.testCaseId && onAbortAiEvaluation && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onAbortAiEvaluation(result.testCaseId)}
                              title={t('abort')}
                              aria-label={t('abort')}
                              className="px-2"
                            >
                              <Square className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </>
                      )}
                      {onRetryOutput && (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onRetryOutput(result.testCaseId)}
                            loading={retryingOutputTestCaseId === result.testCaseId}
                            disabled={retryingAiEvaluationTestCaseId === result.testCaseId}
                            title={t('retryOutput')}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>{t('retryOutput')}</span>
                          </Button>
                          {retryingOutputTestCaseId === result.testCaseId && onAbortRetryOutput && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onAbortRetryOutput(result.testCaseId)}
                              title={t('abort')}
                              aria-label={t('abort')}
                              className="px-2"
                            >
                              <Square className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  <div>
                    <button
                      onClick={() => toggleOutputExpanded(result.id)}
                      className="w-full flex items-center justify-between p-2 bg-slate-800/50 light:bg-slate-100 rounded-t border border-slate-700 light:border-slate-200 hover:bg-slate-800 light:hover:bg-slate-200 transition-colors"
                    >
                      <span className="text-xs font-medium text-slate-400 light:text-slate-600">{t('outputComparison')}</span>
                      {expandedOutputs.has(result.id) ? (
                        <ChevronDown className="w-4 h-4 text-slate-500 light:text-slate-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-500 light:text-slate-400" />
                      )}
                    </button>
                    {expandedOutputs.has(result.id) && (
                      <div className="grid grid-cols-2 gap-0 border border-t-0 border-slate-700 light:border-slate-200 rounded-b overflow-hidden">
                        <div className="border-r border-slate-700 light:border-slate-200">
                          <div className="px-3 py-1.5 bg-slate-800 light:bg-emerald-50 border-b border-slate-700 light:border-slate-200 flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-emerald-400 light:text-emerald-600">{t('expectedOutput')}</span>
                            <button
                              type="button"
                              onClick={() => handleCopy(getExpectedOutput(result.testCaseId) || '', result.id, 'expected')}
                              disabled={!getExpectedOutput(result.testCaseId)}
                              className="p-1 rounded hover:bg-slate-700/60 light:hover:bg-emerald-100 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={tCommon('copy')}
                            >
                              {copiedField?.resultId === result.id && copiedField.field === 'expected' ? (
                                <Check className="w-3.5 h-3.5" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                          <div className="p-3 bg-slate-900 light:bg-white text-sm max-h-64 overflow-y-auto">
                            {getExpectedOutput(result.testCaseId) ? (
                              <MarkdownRenderer content={getExpectedOutput(result.testCaseId)!} />
                            ) : (
                              <span className="text-slate-500 light:text-slate-400 text-xs">{t('noExpectedOutput')}</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="px-3 py-1.5 bg-slate-800 light:bg-cyan-50 border-b border-slate-700 light:border-slate-200 flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-cyan-400 light:text-cyan-600">{t('modelOutput')}</span>
                            <button
                              type="button"
                              onClick={() => handleCopy(result.modelOutput || '', result.id, 'model')}
                              disabled={!result.modelOutput}
                              className="p-1 rounded hover:bg-slate-700/60 light:hover:bg-cyan-100 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={tCommon('copy')}
                            >
                              {copiedField?.resultId === result.id && copiedField.field === 'model' ? (
                                <Check className="w-3.5 h-3.5" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                          <div className="p-3 bg-slate-900 light:bg-white text-sm max-h-64 overflow-y-auto">
                            {result.modelOutput ? (
                              <MarkdownRenderer content={result.modelOutput} />
                            ) : (
                              <span className="text-slate-500 light:text-slate-400 text-xs">{t('noOutput')}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {result.errorMessage && (
                    <div>
                      <p className="text-xs text-rose-400 light:text-rose-600 mb-1">{t('errorMessage')}</p>
                      <div className="p-3 bg-rose-950/30 light:bg-rose-50 rounded border border-rose-900/50 light:border-rose-200 text-sm text-rose-300 light:text-rose-700">
                        {result.errorMessage}
                      </div>
                    </div>
                  )}

                  {enabledCriteria.length > 0 && Object.keys(result.scores).length > 0 && (
                    <div>
                      <p className="text-xs text-slate-500 light:text-slate-600 mb-2">{t('scoreDetails')}</p>
                      <div className="space-y-2">
                        {enabledCriteria.map((criterion) => (
                          <div
                            key={criterion.id}
                            className="p-3 bg-slate-800 light:bg-slate-50 rounded border border-slate-700 light:border-slate-200"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-slate-300 light:text-slate-700">
                                {criterion.name}
                              </span>
                              <Badge
                                variant={
                                  (result.scores[criterion.name] || 0) >= 0.7
                                    ? 'success'
                                    : (result.scores[criterion.name] || 0) >= 0.4
                                    ? 'warning'
                                    : 'error'
                                }
                              >
                                {((result.scores[criterion.name] || 0) * 10).toFixed(1)}/10
                              </Badge>
                            </div>
                            {result.aiFeedback[criterion.name] && (
                              <p className="text-xs text-slate-400 light:text-slate-600">
                                {result.aiFeedback[criterion.name]}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {getTestCaseNotes(result.testCaseId) && (
                    <div>
                      <p className="text-xs text-slate-500 light:text-slate-600 mb-2">{t('testNotes')}</p>
                      <div className="p-3 bg-slate-800/50 light:bg-amber-50 rounded border border-slate-700 light:border-amber-200">
                        <p className="text-sm text-slate-400 light:text-amber-700 whitespace-pre-wrap">
                          {getTestCaseNotes(result.testCaseId)}
                        </p>
                      </div>
                    </div>
                  )}

                  {attachments.length > 0 && (
                    <div>
                      <p className="text-xs text-slate-500 light:text-slate-600 mb-2 flex items-center gap-1">
                        <Paperclip className="w-3 h-3" />
                        {t('attachments')} ({attachments.length})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {attachments.map((attachment, i) => {
                          const Icon = getFileIcon(attachment);
                          return (
                            <button
                              key={i}
                              onClick={() => setPreviewAttachment(attachment)}
                              className="flex items-center gap-2 px-3 py-2 bg-slate-800 light:bg-slate-50 rounded border border-slate-700 light:border-slate-200 hover:border-cyan-500 light:hover:border-cyan-400 transition-colors"
                              title={t('clickToPreview')}
                            >
                              <Icon className="w-4 h-4 text-slate-400 light:text-slate-500" />
                              <span className="text-sm text-slate-300 light:text-slate-700 max-w-[150px] truncate">
                                {attachment.name}
                              </span>
                              <Eye className="w-3 h-3 text-cyan-400 light:text-cyan-600" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {showOcrResults && (
                    <OcrResultsPanel attachments={attachments} provider={ocrProvider} />
                  )}
                </div>
              )}
            </div>
          );
          })}
        </div>
      </div>

      {/* Attachment Preview Modal */}
      <AttachmentModal
        attachment={previewAttachment}
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
