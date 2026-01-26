import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, CheckCircle2, XCircle, Loader2, Play, ChevronRight, ChevronDown, Zap, Trash2, Settings2, FileText, Bot, Scale, Paperclip, ScanText, Square, Download, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Input } from '../ui';
import type { EvaluationRun, EvaluationStatus, RunConfig } from '../../types';
import { formatDateTime } from '../../lib/date-utils';

interface RunHistoryProps {
  runs: EvaluationRun[];
  selectedRunId: string | null;
  onSelectRun: (run: EvaluationRun) => void;
  onDeleteRun?: (runId: string) => void;
  onAbortRun?: (runId: string) => void;
  onBatchExport?: (runs: EvaluationRun[]) => void;
  batchExporting?: boolean;
}

const statusConfig: Record<EvaluationStatus, { labelKey: string; variant: 'info' | 'warning' | 'success' | 'error'; icon: React.ReactNode }> = {
  pending: { labelKey: 'pending', variant: 'info', icon: <Clock className="w-4 h-4" /> },
  running: { labelKey: 'running', variant: 'warning', icon: <Loader2 className="w-4 h-4 animate-spin" /> },
  completed: { labelKey: 'completed', variant: 'success', icon: <CheckCircle2 className="w-4 h-4" /> },
  failed: { labelKey: 'failed', variant: 'error', icon: <XCircle className="w-4 h-4" /> },
};

function formatDateInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt || !startedAt) return '-';
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (isNaN(start) || isNaN(end)) return '-';
  const durationMs = end - start;
  if (durationMs < 0) return '-';

  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;
}

function getFileProcessingLabel(t: (key: string) => string, fileProcessing?: string | null): string {
  const value = fileProcessing || 'auto';
  switch (value) {
    case 'auto':
      return t('fileProcessingAuto');
    case 'vision':
      return t('fileProcessingVision');
    case 'ocr':
      return t('fileProcessingOcr');
    case 'none':
      return t('fileProcessingNone');
    default:
      return value;
  }
}

function getOcrProviderLabel(t: (key: string) => string, ocrProvider?: string | null): string {
  if (!ocrProvider) return t('ocrProviderFollow');
  switch (ocrProvider) {
    case 'paddle':
      return 'PaddleOCR';
    case 'paddle_vl':
      return t('ocrProviderPaddleVl');
    case 'datalab':
      return t('ocrProviderDatalab');
    case 'mineru':
      return t('ocrProviderMineru');
    default:
      return ocrProvider;
  }
}

export function RunHistory({ runs, selectedRunId, onSelectRun, onDeleteRun, onAbortRun, onBatchExport, batchExporting }: RunHistoryProps) {
  const { t } = useTranslation('evaluation');
  const { t: tCommon } = useTranslation('common');
  const [modelQuery, setModelQuery] = useState('');
  const [statusFilters, setStatusFilters] = useState<Array<'completed' | 'failed' | 'inProgress'>>([]);
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const [startDate, setStartDate] = useState(() => formatDateInputValue(new Date()));
  const [endDate, setEndDate] = useState(() => formatDateInputValue(new Date()));

  useEffect(() => {
    if (!isStatusMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!statusMenuRef.current?.contains(event.target as Node)) {
        setIsStatusMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsStatusMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isStatusMenuOpen]);

  const statusOptions = [
    { value: 'completed' as const, label: t('completed') },
    { value: 'failed' as const, label: t('failed') },
    { value: 'inProgress' as const, label: t('inProgress') },
  ];

  const statusLabel = statusFilters.length
    ? statusOptions
      .filter((option) => statusFilters.includes(option.value))
      .map((option) => option.label)
      .join(', ')
    : tCommon('all');

  const filteredRuns = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    const activeStatuses = new Set(statusFilters);
    const startTimestamp = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const endTimestamp = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;
    const hasStart = startTimestamp !== null && !Number.isNaN(startTimestamp);
    const hasEnd = endTimestamp !== null && !Number.isNaN(endTimestamp);

    return runs.filter((run) => {
      const runConfig = run.runConfig as RunConfig | null;
      const modelLabel = [runConfig?.modelName, runConfig?.modelId].filter(Boolean).join(' ').toLowerCase();
      const matchesModel = !query || modelLabel.includes(query);

      if (!matchesModel) return false;

      if (hasStart || hasEnd) {
        const runDateValue = run.startedAt ?? run.createdAt ?? run.completedAt ?? null;
        if (!runDateValue) return false;
        const runTimestamp = new Date(runDateValue).getTime();
        if (Number.isNaN(runTimestamp)) return false;
        if (hasStart && runTimestamp < (startTimestamp as number)) return false;
        if (hasEnd && runTimestamp > (endTimestamp as number)) return false;
      }

      if (activeStatuses.size === 0) return true;
      if (activeStatuses.has('completed') && run.status === 'completed') return true;
      if (activeStatuses.has('failed') && run.status === 'failed') return true;
      if (activeStatuses.has('inProgress') && (run.status === 'running' || run.status === 'pending')) return true;
      return false;
    });
  }, [endDate, modelQuery, runs, startDate, statusFilters]);

  const toggleStatusFilter = (value: 'completed' | 'failed' | 'inProgress') => {
    setStatusFilters((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value]
    );
  };

  if (runs.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 light:text-slate-600 border border-dashed border-slate-700 light:border-slate-300 rounded-lg">
        <Play className="w-12 h-12 mx-auto mb-3 text-slate-600 light:text-slate-400" />
        <p>{t('noExecutionRecords')}</p>
        <p className="text-xs mt-1">{t('clickRunToStart')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full sm:w-64">
            <Input
              label={t('targetModel')}
              value={modelQuery}
              onChange={(e) => setModelQuery(e.target.value)}
              placeholder={tCommon('searchModels')}
            />
          </div>
          <div ref={statusMenuRef} className="relative w-full sm:w-48">
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-1.5">
              {t('executionResult')}
            </label>
            <button
              type="button"
              onClick={() => setIsStatusMenuOpen((prev) => !prev)}
              className="w-full px-3 py-2 bg-slate-800 light:bg-white border rounded-lg text-sm text-slate-200 light:text-slate-800 flex items-center justify-between gap-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all border-slate-700 light:border-slate-300"
            >
              <span className="truncate">{statusLabel}</span>
              <ChevronDown className={`w-4 h-4 text-slate-500 light:text-slate-400 transition-transform ${isStatusMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {isStatusMenuOpen && (
              <div className="absolute z-20 mt-2 w-full rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900 light:bg-white shadow-lg overflow-hidden">
                {statusOptions.map((option) => {
                  const selected = statusFilters.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => toggleStatusFilter(option.value)}
                      className={`w-full px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                        selected
                          ? 'bg-slate-800/70 light:bg-slate-100 text-slate-100 light:text-slate-800'
                          : 'text-slate-300 light:text-slate-700 hover:bg-slate-800/50 light:hover:bg-slate-100'
                      }`}
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                        selected
                          ? 'border-cyan-500 bg-cyan-500 text-white'
                          : 'border-slate-600 light:border-slate-400'
                      }`}>
                        {selected && <Check className="w-3 h-3" />}
                      </span>
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <div className="w-full sm:w-40">
              <Input
                label={t('startDate')}
                type="date"
                value={startDate}
                max={endDate || undefined}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-40">
              <Input
                label={t('endDate')}
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="text-xs text-slate-500 light:text-slate-600">
            {t('totalExecutions', { count: filteredRuns.length })}
          </span>
          {onBatchExport && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onBatchExport(filteredRuns)}
              loading={batchExporting}
              disabled={filteredRuns.length === 0}
            >
              <Download className="w-4 h-4" />
              <span>{t('batchExport')}</span>
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {filteredRuns.length === 0 ? (
          <div className="text-center py-12 text-slate-500 light:text-slate-600 border border-dashed border-slate-700 light:border-slate-300 rounded-lg">
            <Play className="w-12 h-12 mx-auto mb-3 text-slate-600 light:text-slate-400" />
            <p>{t('noExecutionRecords')}</p>
          </div>
        ) : (
          filteredRuns.map((run, index) => {
            const status = statusConfig[run.status];
            const isSelected = selectedRunId === run.id;
            const runConfig = run.runConfig as RunConfig | null;
            const hasConfigSummary = !!runConfig;
            const fileProcessing = runConfig?.fileProcessing || 'auto';
            const fileProcessingLabel = runConfig ? getFileProcessingLabel(t, fileProcessing) : null;
            const showOcrProvider = fileProcessing === 'ocr' || fileProcessing === 'auto';
            const totalCases = (run.results as { totalCases?: number }).totalCases;
            const completedCases = (run.results as { completedCases?: number }).completedCases;
            const passedCases = (run.results as { passedCases?: number }).passedCases;
            const llmTimeMs = (run.results as { llmTimeMs?: number }).llmTimeMs;
            const ocrTimeMs = (run.results as { ocrTimeMs?: number }).ocrTimeMs;
            const passRate = totalCases
              ? (((passedCases || 0) / totalCases) * 100).toFixed(0)
              : null;
            const progressPct = totalCases
              ? Math.min(100, Math.max(0, Math.round((((completedCases || 0) as number) / totalCases) * 100)))
              : 0;

            return (
              <button
              key={run.id}
              onClick={() => onSelectRun(run)}
              className={`w-full p-4 rounded-lg border transition-all text-left ${
                isSelected
                  ? 'bg-slate-800 light:bg-cyan-50 border-cyan-500/50 light:border-cyan-400 ring-1 ring-cyan-500/20 light:ring-cyan-400/30'
                  : 'bg-slate-800/30 light:bg-white border-slate-700 light:border-slate-200 hover:bg-slate-800/50 light:hover:bg-slate-50 hover:border-slate-600 light:hover:border-slate-300 light:shadow-sm'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    run.status === 'completed' ? 'bg-emerald-500/10 light:bg-emerald-100 text-emerald-400 light:text-emerald-600' :
                    run.status === 'failed' ? 'bg-rose-500/10 light:bg-rose-100 text-rose-400 light:text-rose-600' :
                    run.status === 'running' ? 'bg-amber-500/10 light:bg-amber-100 text-amber-400 light:text-amber-600' :
                    'bg-slate-700 light:bg-slate-100 text-slate-400 light:text-slate-500'
                  }`}>
                    {status.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200 light:text-slate-800">
                        {t('executionNum', { num: filteredRuns.length - index })}
                      </span>
                      <Badge variant={status.variant}>{t(status.labelKey)}</Badge>
                    </div>
                    <p className="text-xs text-slate-500 light:text-slate-600 mt-1">
                      {formatDateTime(run.startedAt)}
                    </p>
                    {/* 显示运行配置摘要 */}
                    {hasConfigSummary && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {runConfig?.modelName && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-cyan-500/10 text-cyan-400 light:bg-cyan-100 light:text-cyan-700 rounded">
                            <Bot className="w-3 h-3" />
                            {runConfig.modelName}
                          </span>
                        )}
                        {runConfig?.judgeModelName && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-purple-500/10 text-purple-400 light:bg-purple-100 light:text-purple-700 rounded">
                            <Scale className="w-3 h-3" />
                            {runConfig.judgeModelName}
                          </span>
                        )}
                        {runConfig?.promptName && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-amber-500/10 text-amber-400 light:bg-amber-100 light:text-amber-700 rounded">
                            <FileText className="w-3 h-3" />
                            {runConfig.promptName}
                            {runConfig.promptVersion && ` v${runConfig.promptVersion}`}
                          </span>
                        )}
                        {runConfig && fileProcessingLabel && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-emerald-500/10 text-emerald-400 light:bg-emerald-100 light:text-emerald-700 rounded">
                            <Paperclip className="w-3 h-3" />
                            {fileProcessingLabel}
                          </span>
                        )}
                        {runConfig && showOcrProvider && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-sky-500/10 text-sky-400 light:bg-sky-100 light:text-sky-700 rounded">
                            <ScanText className="w-3 h-3" />
                            {getOcrProviderLabel(t, runConfig.ocrProviderResolved ?? runConfig.ocrProvider)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {run.status === 'completed' && passRate !== null && (
                    <div className="text-right">
                      <p className={`text-lg font-semibold ${
                        parseInt(passRate) >= 80 ? 'text-emerald-400 light:text-emerald-600' :
                        parseInt(passRate) >= 60 ? 'text-amber-400 light:text-amber-600' :
                        'text-rose-400 light:text-rose-600'
                      }`}>
                        {passRate}%
                      </p>
                      <p className="text-xs text-slate-500 light:text-slate-600">{t('passRate')}</p>
                    </div>
                  )}
                  {onDeleteRun && run.status !== 'running' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteRun(run.id);
                      }}
                      className="p-1.5 text-slate-500 hover:text-red-400 transition-colors rounded hover:bg-slate-700/50 light:hover:bg-slate-100"
                      title={t('deleteRecord')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  {onAbortRun && run.status === 'running' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAbortRun(run.id);
                      }}
                      className="p-1.5 text-rose-400 hover:text-rose-300 transition-colors rounded hover:bg-rose-500/10"
                      title={t('abort')}
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  )}
                  <ChevronRight className={`w-5 h-5 transition-colors ${
                    isSelected ? 'text-cyan-400 light:text-cyan-600' : 'text-slate-600 light:text-slate-400'
                  }`} />
                </div>
              </div>

              {run.status === 'completed' && totalCases && (
                <div className="mt-3 pt-3 border-t border-slate-700/50 light:border-slate-200 grid grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-slate-500 light:text-slate-600">{t('testCases')}</p>
                    <p className="text-sm text-slate-300 light:text-slate-700">{totalCases}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 light:text-slate-600">{t('passed')}</p>
                    <p className="text-sm text-emerald-400 light:text-emerald-600">{passedCases || 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 light:text-slate-600">{t('tokenConsumption')}</p>
                    <p className="text-sm text-cyan-400 light:text-cyan-600 flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      {((run.totalTokensInput || 0) + (run.totalTokensOutput || 0)).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 light:text-slate-600">{t('duration')}</p>
                    <p className="text-sm text-slate-300 light:text-slate-700">{formatDuration(run.startedAt, run.completedAt)}</p>
                    {(typeof llmTimeMs === 'number' || typeof ocrTimeMs === 'number') && (
                      <p className="text-[10px] text-slate-500 light:text-slate-600 mt-0.5">
                        {t('llmCumulative')}: {((llmTimeMs || 0) / 1000).toFixed(1)}s · {t('ocrCumulative')}: {((ocrTimeMs || 0) / 1000).toFixed(1)}s
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* 显示执行时的模型参数 */}
              {run.modelParameters && (
                <div className="mt-3 pt-3 border-t border-slate-700/50 light:border-slate-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Settings2 className="w-3 h-3 text-slate-500 light:text-slate-400" />
                    <span className="text-xs text-slate-500 light:text-slate-600">{t('modelParameters')}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {run.modelParameters.temperature !== undefined && (
                      <span className="px-2 py-0.5 text-xs bg-slate-700/50 light:bg-slate-100 text-slate-300 light:text-slate-600 rounded">
                        temp: {run.modelParameters.temperature}
                      </span>
                    )}
                    {run.modelParameters.max_tokens !== undefined && (
                      <span className="px-2 py-0.5 text-xs bg-slate-700/50 light:bg-slate-100 text-slate-300 light:text-slate-600 rounded">
                        max: {run.modelParameters.max_tokens}
                      </span>
                    )}
                    {run.modelParameters.top_p !== undefined && (
                      <span className="px-2 py-0.5 text-xs bg-slate-700/50 light:bg-slate-100 text-slate-300 light:text-slate-600 rounded">
                        top_p: {run.modelParameters.top_p}
                      </span>
                    )}
                    {run.modelParameters.frequency_penalty !== undefined && run.modelParameters.frequency_penalty !== 0 && (
                      <span className="px-2 py-0.5 text-xs bg-slate-700/50 light:bg-slate-100 text-slate-300 light:text-slate-600 rounded">
                        freq: {run.modelParameters.frequency_penalty}
                      </span>
                    )}
                    {run.modelParameters.presence_penalty !== undefined && run.modelParameters.presence_penalty !== 0 && (
                      <span className="px-2 py-0.5 text-xs bg-slate-700/50 light:bg-slate-100 text-slate-300 light:text-slate-600 rounded">
                        pres: {run.modelParameters.presence_penalty}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {run.status === 'failed' && run.errorMessage && (
                <div className="mt-3 pt-3 border-t border-slate-700/50 light:border-slate-200">
                  <p className="text-xs text-rose-400 light:text-rose-600 line-clamp-2">{run.errorMessage}</p>
                </div>
              )}

              {run.status === 'running' && (
                <div className="mt-3 pt-3 border-t border-slate-700/50 light:border-slate-200">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-700 light:bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 light:bg-amber-400 rounded-full transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-500 light:text-slate-600">
                      {completedCases !== undefined && totalCases
                        ? `${completedCases}/${totalCases} (${progressPct}%)`
                        : `${progressPct}%`}
                    </span>
                    <span className="text-xs text-slate-500 light:text-slate-600">{t('executing')}</span>
                  </div>
                </div>
              )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
