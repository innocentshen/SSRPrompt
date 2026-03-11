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
  Pencil,
  RotateCcw,
  Scale,
  Search,
  Coins,
  XCircle,
  Zap,
} from 'lucide-react';
import { Badge, Button, Collapsible, MarkdownRenderer, Modal, OutputRenderer, OutputRendererControls, StopIndicator } from '../ui';
import { AttachmentModal } from '../Prompt/AttachmentModal';
import { OcrResultsPanel } from '../Prompt/OcrResultsPanel';
import type { EvaluationCriterion, FileAttachment, OcrProvider, TestCase, TestCaseResult } from '../../types';
import { getFileIconType } from '../../lib/file-utils';
import { useOutputRenderPreferences } from '../../lib/output-renderer-prefs';
import { calculateAiCost, formatUsdCost } from '../../lib/cost';
import { useToast } from '../../store/useUIStore';

interface EvaluationResultsViewProps {
  testCases: TestCase[];
  results: TestCaseResult[];
  criteria: EvaluationCriterion[];
  pricing?: { inputPricePerM: number; outputPricePerM: number } | null;
  ocrProvider?: OcrProvider | null;
  fileProcessing?: string | null;
  downloadAttachmentBlob?: (fileId: string, options?: { signal?: AbortSignal }) => Promise<Blob>;
  canViewOcrResults?: boolean;
  onRetryOutput?: (testCaseId: string) => void;
  onRunAiEvaluation?: (testCaseId: string) => void;
  onUpdateExpectedOutput?: (testCaseId: string, expectedOutput: string | null) => Promise<void>;
  onAbortRetryOutput?: (testCaseId: string) => void;
  onAbortAiEvaluation?: (testCaseId: string) => void;
  retryingOutputTestCaseId?: string | null;
  retryingAiEvaluationTestCaseId?: string | null;
  retryOutputRefreshTick?: number;
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
  pricing = null,
  ocrProvider,
  fileProcessing,
  downloadAttachmentBlob,
  canViewOcrResults = true,
  onRetryOutput,
  onRunAiEvaluation,
  onUpdateExpectedOutput,
  onAbortRetryOutput,
  onAbortAiEvaluation,
  retryingOutputTestCaseId,
  retryingAiEvaluationTestCaseId,
  retryOutputRefreshTick = 0,
}: EvaluationResultsViewProps) {
  const { t } = useTranslation('evaluation');
  const { t: tCommon } = useTranslation('common');
  const { showToast } = useToast();
  const [outputRenderPrefs, setOutputRenderPrefs] = useOutputRenderPreferences('ssrprompt_output_render_prefs');

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachment | null>(null);
  const [copiedField, setCopiedField] = useState<'expected' | 'model' | null>(null);
  const [isEditingExpectedOutput, setIsEditingExpectedOutput] = useState(false);
  const [expectedOutputDraft, setExpectedOutputDraft] = useState('');
  const [savingExpectedOutput, setSavingExpectedOutput] = useState(false);
  const [reEvaluateConfirmOpen, setReEvaluateConfirmOpen] = useState(false);
  const [pendingReEvaluateTestCaseId, setPendingReEvaluateTestCaseId] = useState<string | null>(null);
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
  const activeOcrEligibleAttachments = useMemo(
    () => activeAttachments.filter((attachment) => attachment.type.startsWith('image/') || attachment.type === 'application/pdf'),
    [activeAttachments]
  );
  const showOcrResults = !!activeResult && activeOcrEligibleAttachments.length > 0 && (
    fileProcessing === 'ocr' ||
    activeResult.ocrLatencyMs > 0
  );
  const canEditExpectedOutput = !!onUpdateExpectedOutput && !!activeTestCase;

  useEffect(() => {
    if (!activeTestCase) {
      setIsEditingExpectedOutput(false);
      setExpectedOutputDraft('');
      return;
    }
    if (!isEditingExpectedOutput) {
      setExpectedOutputDraft(activeTestCase.expectedOutput || '');
    }
  }, [activeTestCase, isEditingExpectedOutput]);

  const handleStartEditExpectedOutput = () => {
    if (!activeTestCase || !onUpdateExpectedOutput) return;
    setExpectedOutputDraft(activeTestCase.expectedOutput || '');
    setIsEditingExpectedOutput(true);
  };

  const handleCancelEditExpectedOutput = () => {
    setExpectedOutputDraft(activeTestCase?.expectedOutput || '');
    setIsEditingExpectedOutput(false);
  };

  const handleUseModelOutputAsExpected = () => {
    if (!activeResult?.modelOutput) return;
    setExpectedOutputDraft(activeResult.modelOutput);
    if (!isEditingExpectedOutput && onUpdateExpectedOutput) {
      setIsEditingExpectedOutput(true);
    }
  };

  const handleSaveExpectedOutput = async () => {
    if (!activeResult || !onUpdateExpectedOutput || savingExpectedOutput) return;
    setSavingExpectedOutput(true);
    try {
      const nextExpectedOutput = expectedOutputDraft.trim().length > 0 ? expectedOutputDraft : null;
      await onUpdateExpectedOutput(activeResult.testCaseId, nextExpectedOutput);
      setIsEditingExpectedOutput(false);
      showToast('success', t('saveSuccess', { defaultValue: '保存成功' }));

      if (onRunAiEvaluation) {
        setPendingReEvaluateTestCaseId(activeResult.testCaseId);
        setReEvaluateConfirmOpen(true);
      }
    } catch (error) {
      console.error('Failed to update expected output:', error);
      showToast('error', t('updateFailed'));
    } finally {
      setSavingExpectedOutput(false);
    }
  };

  const closeReEvaluateConfirm = () => {
    setReEvaluateConfirmOpen(false);
    setPendingReEvaluateTestCaseId(null);
  };

  const handleConfirmReEvaluate = () => {
    if (!onRunAiEvaluation || !pendingReEvaluateTestCaseId) {
      closeReEvaluateConfirm();
      return;
    }
    onRunAiEvaluation(pendingReEvaluateTestCaseId);
    closeReEvaluateConfirm();
  };

  const enabledCriteria = criteria.filter((criterion) => criterion.enabled);
  const friendlyActiveErrorMessage = useMemo(() => {
    const raw = activeResult?.errorMessage?.trim() || '';
    if (!raw) return '';

    const normalized = raw.toLowerCase();
    const getLocalizedNetworkDetail = (detail: string): string => {
      const normalizedDetail = detail.trim().toLowerCase();
      if (!normalizedDetail) return detail;

      const isCommonNetworkDetail =
        normalizedDetail.includes('headers timeout') ||
        normalizedDetail.includes('body timeout') ||
        normalizedDetail.includes('request timeout') ||
        normalizedDetail.includes('timed out') ||
        normalizedDetail.includes('socket hang up') ||
        /\b(etimedout|econnrefused|econnreset|enotfound|eai_again)\b/.test(normalizedDetail);

      return isCommonNetworkDetail ? tCommon('errors.NETWORK_ERROR') : detail;
    };

    const providerCallPrefix = 'failed to call the model provider.';
    if (normalized.startsWith(providerCallPrefix)) {
      const detailMatch = raw.match(/\bdetail:\s*(.+)$/i);
      if (detailMatch?.[1]) {
        return t('friendlyNetworkErrorMessage', {
          detail: getLocalizedNetworkDetail(detailMatch[1].trim()),
          defaultValue: '调用模型服务失败（网络连接异常）。请检查网络、DNS、代理和服务可达性。详情：{{detail}}',
        });
      }
      return t('friendlyFetchFailedMessage', {
        defaultValue:
          '调用模型服务失败。请检查 API Key、模型服务地址、网络连接或代理设置。',
      });
    }

    if (normalized === 'fetch failed') {
      return t(
        'friendlyFetchFailedMessage',
        {
          defaultValue:
            '调用模型服务失败。请检查 API Key、模型服务地址、网络连接或代理设置。',
        }
      );
    }

    if (/\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT)\b/i.test(raw)) {
      return t('friendlyNetworkErrorMessage', {
        detail: getLocalizedNetworkDetail(raw),
        defaultValue: '调用模型服务失败（网络连接异常）。请检查网络、DNS、代理和服务可达性。详情：{{detail}}',
      });
    }

    return raw;
  }, [activeResult?.errorMessage, t, tCommon]);

  const passedCount = results.filter((result) => result.passed).length;
  const failedCount = results.length - passedCount;

  const resultCostMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateAiCost>>();
    for (const result of results) {
      map.set(result.id, calculateAiCost(result.tokensInput, result.tokensOutput, pricing));
    }
    return map;
  }, [pricing, results]);

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
                const aiCost = resultCostMap.get(result.id);

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
                          <span className="flex items-center gap-1" title={!aiCost?.hasPricing ? t('modelPriceNotConfigured', { defaultValue: '模型价格未配置' }) : undefined}>
                            <Coins className="w-3 h-3" />
                            {formatUsdCost(aiCost?.totalCost ?? null)}
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
              <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 rounded-lg border border-slate-700/60 light:border-slate-200 bg-slate-900/40 light:bg-slate-50 px-3 py-2">
                <div className="flex items-center gap-3 min-w-0">
                  {activeResult.passed ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 light:text-emerald-600 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-rose-500 light:text-rose-600 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-slate-500 light:text-slate-500">{activeTestCaseIndex + 1}</span>
                      <span className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">
                        {activeTestCase?.name || t('testCaseNum', { num: activeTestCaseIndex + 1 })}
                      </span>
                      {activeResult.errorMessage && <Badge variant="error">{tCommon('error')}</Badge>}
                    </div>
                  </div>
                </div>

                {(onRetryOutput || onRunAiEvaluation) && (
                  <div className="flex items-center gap-2 w-full lg:w-auto justify-end">
                    {onRetryOutput && (
                      <Button
                        variant={retryingOutputTestCaseId === activeResult.testCaseId ? 'danger' : 'secondary'}
                        size="sm"
                        onClick={() => {
                          if (retryingOutputTestCaseId === activeResult.testCaseId) {
                            onAbortRetryOutput?.(activeResult.testCaseId);
                            return;
                          }
                          onRetryOutput(activeResult.testCaseId);
                        }}
                        disabled={
                          retryingAiEvaluationTestCaseId === activeResult.testCaseId ||
                          (retryingOutputTestCaseId === activeResult.testCaseId && !onAbortRetryOutput)
                        }
                        title={retryingOutputTestCaseId === activeResult.testCaseId ? t('abort') : t('retryOutput')}
                      >
                        {retryingOutputTestCaseId === activeResult.testCaseId ? (
                          <StopIndicator iconSizeClassName="w-3.5 h-3.5" />
                        ) : (
                          <RotateCcw className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {retryingOutputTestCaseId === activeResult.testCaseId
                            ? `${t('abort')} ${t('retryOutput')}`
                            : t('retryOutput')}
                        </span>
                      </Button>
                    )}
                    {onRunAiEvaluation && (
                      <Button
                        variant={retryingAiEvaluationTestCaseId === activeResult.testCaseId ? 'danger' : 'secondary'}
                        size="sm"
                        onClick={() => {
                          if (retryingAiEvaluationTestCaseId === activeResult.testCaseId) {
                            onAbortAiEvaluation?.(activeResult.testCaseId);
                            return;
                          }
                          onRunAiEvaluation(activeResult.testCaseId);
                        }}
                        disabled={
                          retryingOutputTestCaseId === activeResult.testCaseId ||
                          (retryingAiEvaluationTestCaseId === activeResult.testCaseId && !onAbortAiEvaluation)
                        }
                        title={retryingAiEvaluationTestCaseId === activeResult.testCaseId ? t('abort') : t('runAiEvaluation')}
                      >
                        {retryingAiEvaluationTestCaseId === activeResult.testCaseId ? (
                          <StopIndicator iconSizeClassName="w-3.5 h-3.5" />
                        ) : (
                          <Scale className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {retryingAiEvaluationTestCaseId === activeResult.testCaseId
                            ? `${t('abort')} ${t('runAiEvaluation')}`
                            : t('runAiEvaluation')}
                        </span>
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
                {friendlyActiveErrorMessage && (
                  <div className="p-3 bg-rose-950/30 light:bg-rose-50 rounded border border-rose-900/50 light:border-rose-200">
                    <p className="text-xs text-rose-400 light:text-rose-600 mb-1">{t('errorMessage')}</p>
                    <div className="text-sm text-rose-300 light:text-rose-700">{friendlyActiveErrorMessage}</div>
                  </div>
                )}

                <div className="border border-slate-700 light:border-slate-200 rounded-lg overflow-hidden">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
                    <div className="border-b lg:border-b-0 lg:border-r border-slate-700 light:border-slate-200">
                      <div className="px-3 py-1.5 bg-slate-800 light:bg-emerald-50 border-b border-slate-700 light:border-slate-200 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-emerald-400 light:text-emerald-600">{t('expectedOutput')}</span>
                        <div className="flex items-center gap-1.5">
                          {canEditExpectedOutput && !isEditingExpectedOutput && (
                            <button
                              type="button"
                              onClick={handleUseModelOutputAsExpected}
                              disabled={!activeResult.modelOutput}
                              className="p-1 rounded hover:bg-slate-700/60 light:hover:bg-emerald-100 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={t('adoptModelOutputAsExpected', { defaultValue: '采纳模型输出为期望输出' })}
                            >
                              <Zap className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canEditExpectedOutput && !isEditingExpectedOutput && (
                            <button
                              type="button"
                              onClick={handleStartEditExpectedOutput}
                              className="p-1 rounded hover:bg-slate-700/60 light:hover:bg-emerald-100 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-emerald-600"
                              title={tCommon('edit')}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!isEditingExpectedOutput && (
                            <button
                              type="button"
                              onClick={() => handleCopy(activeTestCase?.expectedOutput || '', 'expected')}
                              disabled={!activeTestCase?.expectedOutput}
                              className="p-1 rounded hover:bg-slate-700/60 light:hover:bg-emerald-100 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={tCommon('copy')}
                            >
                              {copiedField === 'expected' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="p-3 bg-slate-900 light:bg-white text-sm max-h-80 overflow-y-auto">
                        {isEditingExpectedOutput ? (
                          <div className="space-y-3">
                            <textarea
                              value={expectedOutputDraft}
                              onChange={(event) => setExpectedOutputDraft(event.target.value)}
                              rows={12}
                              className="w-full px-3 py-2 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            />
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-slate-500 light:text-slate-600">
                                {t('expectedOutputUpdatedNeedRerun', {
                                  defaultValue: '保存后建议重新 AI 评测以刷新评分结果',
                                })}
                              </span>
                              <div className="flex items-center gap-2">
                                {activeResult.modelOutput && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleUseModelOutputAsExpected}
                                    disabled={savingExpectedOutput}
                                  >
                                    <Zap className="w-3.5 h-3.5" />
                                    <span>{t('adoptModelOutput', { defaultValue: '采纳模型输出' })}</span>
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={handleCancelEditExpectedOutput}
                                  disabled={savingExpectedOutput}
                                >
                                  <span>{tCommon('cancel')}</span>
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => void handleSaveExpectedOutput()}
                                  loading={savingExpectedOutput}
                                >
                                  <span>{tCommon('save')}</span>
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : activeTestCase?.expectedOutput ? (
                          <OutputRenderer content={activeTestCase.expectedOutput} preferences={outputRenderPrefs} />
                        ) : (
                          <span className="text-slate-500 light:text-slate-400 text-xs">{t('noExpectedOutput')}</span>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="px-3 py-1.5 bg-slate-800 light:bg-sky-50 border-b border-slate-700 light:border-slate-200 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-sky-400 light:text-sky-600">{t('modelOutput')}</span>
                        <div className="flex items-center gap-2">
                          <OutputRendererControls
                            preferences={outputRenderPrefs}
                            onChange={setOutputRenderPrefs}
                          />
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
                      </div>
                      <div className="p-3 bg-slate-900 light:bg-white text-sm max-h-80 overflow-y-auto">
                        {activeResult.modelOutput ? (
                          <OutputRenderer content={activeResult.modelOutput} preferences={outputRenderPrefs} />
                        ) : (
                          <span className="text-slate-500 light:text-slate-400 text-xs">{t('noOutput')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {showOcrResults && canViewOcrResults && (
                  <OcrResultsPanel
                    attachments={activeAttachments}
                    provider={ocrProvider}
                    refreshToken={retryOutputRefreshTick}
                    defaultOpen={true}
                  />
                )}

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
        downloadBlob={downloadAttachmentBlob}
      />

      <Modal
        isOpen={reEvaluateConfirmOpen}
        onClose={closeReEvaluateConfirm}
        title={t('reEvaluateAfterExpectedOutputUpdatedTitle', {
          defaultValue: '重新 AI 评测',
        })}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300 light:text-slate-700">
            {t('reEvaluateAfterExpectedOutputUpdated', {
              defaultValue: '期望输出已更新，是否立即重新 AI 评测当前用例？',
            })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeReEvaluateConfirm}>
              <span>{tCommon('cancel')}</span>
            </Button>
            <Button onClick={handleConfirmReEvaluate}>
              <span>{t('runAiEvaluation')}</span>
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
