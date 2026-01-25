import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Code,
  Copy,
  Eye,
  File,
  FileText,
  Image,
  Paperclip,
  RotateCcw,
  Scale,
  Search,
  Square,
  XCircle,
  Zap,
} from 'lucide-react';
import { Badge, Button, Collapsible, MarkdownRenderer } from '../ui';
import { AttachmentModal } from '../Prompt/AttachmentModal';
import { OcrResultsPanel } from '../Prompt/OcrResultsPanel';
import type { EvaluationCriterion, FileAttachment, OcrProvider, TestCase, TestCaseResult } from '../../types';
import { getFileIconType } from '../../lib/file-utils';

interface EvaluationResultsViewProps {
  testCases: TestCase[];
  results: TestCaseResult[];
  criteria: EvaluationCriterion[];
  ocrProvider?: OcrProvider | null;
  onRetryOutput?: (testCaseId: string) => void;
  onRunAiEvaluation?: (testCaseId: string) => void;
  onAbortRetryOutput?: (testCaseId: string) => void;
  onAbortAiEvaluation?: (testCaseId: string) => void;
  retryingOutputTestCaseId?: string | null;
  retryingAiEvaluationTestCaseId?: string | null;
}

type ResultFilter = 'all' | 'passed' | 'failed';

function formatMsAsSeconds(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '-';
  return `${(ms / 1000).toFixed(1)}s`;
}

export function EvaluationResultsView({
  testCases,
  results,
  criteria,
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

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachment | null>(null);
  const [copiedField, setCopiedField] = useState<'expected' | 'model' | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async (text: string, field: 'expected' | 'model') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
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

  const testCaseMap = useMemo(() => {
    return new Map(testCases.map((testCase) => [testCase.id, testCase]));
  }, [testCases]);

  const testCaseIndexMap = useMemo(() => {
    return new Map(testCases.map((testCase, index) => [testCase.id, index]));
  }, [testCases]);

  const sortedResults = useMemo(() => {
    const indexFallback = Number.MAX_SAFE_INTEGER;
    return [...results].sort((a, b) => {
      const ai = testCaseIndexMap.get(a.testCaseId) ?? indexFallback;
      const bi = testCaseIndexMap.get(b.testCaseId) ?? indexFallback;
      if (ai !== bi) return ai - bi;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }, [results, testCaseIndexMap]);

  const filteredResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sortedResults.filter((result) => {
      if (filter === 'passed' && !result.passed) return false;
      if (filter === 'failed' && result.passed) return false;

      if (!normalized) return true;
      const testCase = testCaseMap.get(result.testCaseId);
      const name = testCase?.name?.toLowerCase() ?? '';
      const inputText = testCase?.inputText?.toLowerCase() ?? '';
      const notes = testCase?.notes?.toLowerCase() ?? '';
      const errorMessage = result.errorMessage?.toLowerCase() ?? '';
      return (
        name.includes(normalized) ||
        inputText.includes(normalized) ||
        notes.includes(normalized) ||
        errorMessage.includes(normalized)
      );
    });
  }, [sortedResults, query, filter, testCaseMap]);

  useEffect(() => {
    if (filteredResults.length === 0) {
      setActiveResultId(null);
      return;
    }
    if (!activeResultId || !filteredResults.some((result) => result.id === activeResultId)) {
      setActiveResultId(filteredResults[0].id);
    }
  }, [filteredResults, activeResultId]);

  const activeResult = useMemo(() => {
    if (!activeResultId) return null;
    return filteredResults.find((result) => result.id === activeResultId) ?? null;
  }, [filteredResults, activeResultId]);

  const activeTestCase = activeResult ? (testCaseMap.get(activeResult.testCaseId) ?? null) : null;
  const activeTestCaseIndex = activeResult ? (testCaseIndexMap.get(activeResult.testCaseId) ?? 0) : 0;
  const activeAttachments = activeTestCase?.attachments ?? [];
  const showOcrResults = !!activeResult && activeResult.ocrLatencyMs > 0 && activeAttachments.length > 0;

  const enabledCriteria = criteria.filter((criterion) => criterion.enabled);

  const passedCount = results.filter((result) => result.passed).length;
  const failedCount = results.length - passedCount;

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

  const filterButtonClassName = (value: ResultFilter) => {
    const base = 'w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 rounded-md text-[11px] leading-none border transition-colors';
    const isActive = filter === value;
    if (isActive) {
      return `${base} bg-cyan-500/15 text-cyan-300 light:text-cyan-700 border-cyan-500/40`;
    }
    return `${base} bg-slate-800/40 light:bg-slate-50 text-slate-400 light:text-slate-600 border-slate-700/60 light:border-slate-200 hover:text-slate-200 light:hover:text-slate-800 hover:border-slate-600 light:hover:border-slate-300`;
  };

  return (
    <div className="h-full min-h-0">
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] h-full min-h-0">
          <div className="flex flex-col gap-3 rounded-xl border border-slate-700/60 light:border-slate-200 bg-slate-900/30 light:bg-white p-3 shadow-sm h-full min-h-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">
              {t('detailedResults')} ({filteredResults.length}/{results.length})
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 light:text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchTestCases')}
                aria-label={tCommon('search')}
                className="w-full pl-7 pr-2 py-1.5 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-md text-xs text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            <button type="button" className={filterButtonClassName('all')} onClick={() => setFilter('all')}>
              {tCommon('all')}
              <span className="opacity-70 tabular-nums text-[10px]">{results.length}</span>
            </button>
            <button type="button" className={filterButtonClassName('passed')} onClick={() => setFilter('passed')}>
              {t('passed')}
              <span className="opacity-70 tabular-nums text-[10px]">{passedCount}</span>
            </button>
            <button
              type="button"
              className={`${filterButtonClassName('failed')} col-span-2 sm:col-span-1`}
              onClick={() => setFilter('failed')}
            >
              {t('failed')}
              <span className="opacity-70 tabular-nums text-[10px]">{failedCount}</span>
            </button>
          </div>

          {filteredResults.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-500 light:text-slate-600 text-sm border border-dashed border-slate-700 light:border-slate-300 rounded-lg">
              {t('noResults')}
            </div>
          ) : (
            <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
              {filteredResults.map((result) => {
                const isActive = result.id === activeResultId;
                const testCase = testCaseMap.get(result.testCaseId);
                const index = testCaseIndexMap.get(result.testCaseId) ?? 0;
                const attachmentsCount = testCase?.attachments?.length ?? 0;
                const totalTokens = result.tokensInput + result.tokensOutput;

                return (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => setActiveResultId(result.id)}
                    className={`w-full text-left border rounded-lg px-3 py-2 transition-colors ${
                      isActive
                        ? 'border-cyan-500/50 bg-cyan-500/10'
                        : 'border-slate-700/80 bg-slate-800/40 hover:bg-slate-800/60 light:bg-white light:border-slate-200 light:hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {result.passed ? (
                        <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-500 light:text-emerald-600 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 mt-0.5 text-rose-500 light:text-rose-600 flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs text-slate-500 light:text-slate-500">{index + 1}</span>
                            <span className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">
                              {testCase?.name || t('testCaseNum', { num: index + 1 })}
                            </span>
                          </div>
                          {result.errorMessage && <Badge variant="error">{tCommon('error')}</Badge>}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 light:text-slate-600">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatMsAsSeconds(result.latencyMs)}
                          </span>
                          {result.ocrLatencyMs > 0 && (
                            <span className="flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              {formatMsAsSeconds(result.ocrLatencyMs)}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {totalTokens.toLocaleString()}
                          </span>
                          {attachmentsCount > 0 && (
                            <span className="flex items-center gap-1">
                              <Paperclip className="w-3 h-3" />
                              {attachmentsCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-slate-700/60 light:border-slate-200 bg-slate-900/30 light:bg-white p-3 shadow-sm h-full min-h-0">
          {activeResult ? (
            <>
              <div className="flex flex-wrap lg:flex-nowrap items-start justify-between gap-2 rounded-lg border border-slate-700/60 light:border-slate-200 bg-slate-900/40 light:bg-slate-50 px-3 py-2">
                <div className="flex items-start gap-3 min-w-0">
                  {activeResult.passed ? (
                    <CheckCircle2 className="w-5 h-5 mt-0.5 text-emerald-500 light:text-emerald-600 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 mt-0.5 text-rose-500 light:text-rose-600 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-slate-500 light:text-slate-500">{activeTestCaseIndex + 1}</span>
                      <span className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">
                        {activeTestCase?.name || t('testCaseNum', { num: activeTestCaseIndex + 1 })}
                      </span>
                      {activeResult.errorMessage && <Badge variant="error">{tCommon('error')}</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 light:text-slate-600">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {t('llmTime')}: {formatMsAsSeconds(activeResult.latencyMs)}
                      </span>
                      {activeResult.ocrLatencyMs > 0 && (
                        <span className="flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5" />
                          {t('ocrTime')}: {formatMsAsSeconds(activeResult.ocrLatencyMs)}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5" />
                        {(activeResult.tokensInput + activeResult.tokensOutput).toLocaleString()} tokens
                      </span>
                      {activeAttachments.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Paperclip className="w-3.5 h-3.5" />
                          {activeAttachments.length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {(onRetryOutput || onRunAiEvaluation) && (
                  <div className="flex items-center gap-2 w-full lg:w-auto justify-end">
                    {onRunAiEvaluation && (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onRunAiEvaluation(activeResult.testCaseId)}
                          loading={retryingAiEvaluationTestCaseId === activeResult.testCaseId}
                          disabled={retryingOutputTestCaseId === activeResult.testCaseId}
                          title={t('runAiEvaluation')}
                        >
                          <Scale className="w-3.5 h-3.5" />
                          <span>{t('runAiEvaluation')}</span>
                        </Button>
                        {retryingAiEvaluationTestCaseId === activeResult.testCaseId && onAbortAiEvaluation && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onAbortAiEvaluation(activeResult.testCaseId)}
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
                          onClick={() => onRetryOutput(activeResult.testCaseId)}
                          loading={retryingOutputTestCaseId === activeResult.testCaseId}
                          disabled={retryingAiEvaluationTestCaseId === activeResult.testCaseId}
                          title={t('retryOutput')}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>{t('retryOutput')}</span>
                        </Button>
                        {retryingOutputTestCaseId === activeResult.testCaseId && onAbortRetryOutput && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onAbortRetryOutput(activeResult.testCaseId)}
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
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
                {activeResult.errorMessage && (
                  <div className="p-3 bg-rose-950/30 light:bg-rose-50 rounded border border-rose-900/50 light:border-rose-200">
                    <p className="text-xs text-rose-400 light:text-rose-600 mb-1">{t('errorMessage')}</p>
                    <div className="text-sm text-rose-300 light:text-rose-700">{activeResult.errorMessage}</div>
                  </div>
                )}

                <div className="border border-slate-700 light:border-slate-200 rounded-lg overflow-hidden">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
                    <div className="border-b lg:border-b-0 lg:border-r border-slate-700 light:border-slate-200">
                      <div className="px-3 py-1.5 bg-slate-800 light:bg-emerald-50 border-b border-slate-700 light:border-slate-200 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-emerald-400 light:text-emerald-600">{t('expectedOutput')}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(activeTestCase?.expectedOutput || '', 'expected')}
                          disabled={!activeTestCase?.expectedOutput}
                          className="p-1 rounded hover:bg-slate-700/60 light:hover:bg-emerald-100 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
                          title={tCommon('copy')}
                        >
                          {copiedField === 'expected' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <div className="p-3 bg-slate-900 light:bg-white text-sm max-h-80 overflow-y-auto">
                        {activeTestCase?.expectedOutput ? (
                          <MarkdownRenderer content={activeTestCase.expectedOutput} />
                        ) : (
                          <span className="text-slate-500 light:text-slate-400 text-xs">{t('noExpectedOutput')}</span>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="px-3 py-1.5 bg-slate-800 light:bg-sky-50 border-b border-slate-700 light:border-slate-200 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-sky-400 light:text-sky-600">{t('modelOutput')}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(activeResult.modelOutput || '', 'model')}
                          disabled={!activeResult.modelOutput}
                          className="p-1 rounded hover:bg-slate-700/60 light:hover:bg-sky-100 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-sky-600 disabled:opacity-40 disabled:cursor-not-allowed"
                          title={tCommon('copy')}
                        >
                          {copiedField === 'model' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <div className="p-3 bg-slate-900 light:bg-white text-sm max-h-80 overflow-y-auto">
                        {activeResult.modelOutput ? (
                          <MarkdownRenderer content={activeResult.modelOutput} />
                        ) : (
                          <span className="text-slate-500 light:text-slate-400 text-xs">{t('noOutput')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {enabledCriteria.length > 0 && Object.keys(activeResult.scores || {}).length > 0 && (
                  <Collapsible
                    title={t('scoreDetails')}
                    defaultOpen={true}
                    icon={<Scale className="w-4 h-4 text-slate-400 light:text-slate-500" />}
                  >
                    <div className="space-y-2">
                      {enabledCriteria.map((criterion) => (
                        <div
                          key={criterion.id}
                          className="p-3 bg-slate-800 light:bg-slate-50 rounded border border-slate-700 light:border-slate-200"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-slate-300 light:text-slate-700">{criterion.name}</span>
                            <Badge
                              variant={
                                (activeResult.scores[criterion.name] || 0) >= 0.7
                                  ? 'success'
                                  : (activeResult.scores[criterion.name] || 0) >= 0.4
                                    ? 'warning'
                                    : 'error'
                              }
                            >
                              {((activeResult.scores[criterion.name] || 0) * 10).toFixed(1)}/10
                            </Badge>
                          </div>
                          {activeResult.aiFeedback[criterion.name] && (
                            <p className="text-xs text-slate-400 light:text-slate-600">{activeResult.aiFeedback[criterion.name]}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </Collapsible>
                )}

                {activeTestCase?.inputText && (
                  <Collapsible
                    title={t('inputText')}
                    defaultOpen={false}
                    icon={<FileText className="w-4 h-4 text-slate-400 light:text-slate-500" />}
                  >
                    <div className="text-sm text-slate-300 light:text-slate-700">
                      <MarkdownRenderer content={activeTestCase.inputText} />
                    </div>
                  </Collapsible>
                )}

                {activeTestCase?.notes && (
                  <Collapsible
                    title={t('testNotes')}
                    defaultOpen={false}
                    icon={<FileText className="w-4 h-4 text-slate-400 light:text-slate-500" />}
                  >
                    <p className="text-sm text-slate-300 light:text-slate-700 whitespace-pre-wrap">{activeTestCase.notes}</p>
                  </Collapsible>
                )}

                <Collapsible
                  title={`${t('attachments')} (${activeAttachments.length})`}
                  defaultOpen={false}
                  disabled={activeAttachments.length === 0}
                  icon={<Paperclip className="w-4 h-4 text-slate-400 light:text-slate-500" />}
                >
                  <div className="space-y-3">
                    {activeAttachments.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {activeAttachments.map((attachment, i) => {
                          const Icon = getFileIcon(attachment);
                          return (
                            <button
                              key={i}
                              onClick={() => setPreviewAttachment(attachment)}
                              className="flex items-center gap-2 px-3 py-2 bg-slate-800 light:bg-slate-50 rounded border border-slate-700 light:border-slate-200 hover:border-cyan-500 light:hover:border-cyan-400 transition-colors"
                              title={t('clickToPreview')}
                              type="button"
                            >
                              <Icon className="w-4 h-4 text-slate-400 light:text-slate-500" />
                              <span className="text-sm text-slate-300 light:text-slate-700 max-w-[160px] truncate">
                                {attachment.name}
                              </span>
                              <Eye className="w-3 h-3 text-cyan-400 light:text-cyan-600" />
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {showOcrResults && <OcrResultsPanel attachments={activeAttachments} provider={ocrProvider} />}
                  </div>
                </Collapsible>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 light:text-slate-600 text-sm border border-dashed border-slate-700 light:border-slate-300 rounded-lg">
              <div className="text-center">
                <AlertCircle className="w-10 h-10 mx-auto mb-2 text-slate-600 light:text-slate-400" />
                <p>{t('noResults')}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <AttachmentModal
        attachment={previewAttachment}
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
