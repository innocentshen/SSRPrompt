import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Loader2, X, XCircle } from 'lucide-react';
import { Button } from '../ui';
import { useAnalysisTaskStore } from '../../store/useAnalysisTaskStore';

export function GlobalAnalysisTaskWidget() {
  const { t } = useTranslation('evaluation');
  const navigate = useNavigate();
  const task = useAnalysisTaskStore((state) => state.task);
  const collapsed = useAnalysisTaskStore((state) => state.collapsed);
  const setCollapsed = useAnalysisTaskStore((state) => state.setCollapsed);
  const clearTask = useAnalysisTaskStore((state) => state.clearTask);

  const statusInfo = useMemo(() => {
    if (!task) return null;

    switch (task.status) {
      case 'running':
        return {
          label: t('analysisTaskStatusRunning'),
          icon: <Loader2 className="w-4 h-4 animate-spin text-cyan-300 light:text-cyan-700" />,
          colorClass: 'text-cyan-200 light:text-cyan-800',
        };
      case 'completed':
        return {
          label: t('analysisTaskStatusCompleted'),
          icon: <CheckCircle2 className="w-4 h-4 text-emerald-300 light:text-emerald-700" />,
          colorClass: 'text-emerald-200 light:text-emerald-800',
        };
      case 'aborted':
        return {
          label: t('analysisTaskStatusAborted'),
          icon: <AlertCircle className="w-4 h-4 text-amber-300 light:text-amber-700" />,
          colorClass: 'text-amber-200 light:text-amber-800',
        };
      default:
        return {
          label: t('analysisTaskStatusFailed'),
          icon: <XCircle className="w-4 h-4 text-rose-300 light:text-rose-700" />,
          colorClass: 'text-rose-200 light:text-rose-800',
        };
    }
  }, [task, t]);

  if (!task || !statusInfo) return null;

  const statusDetail =
    task.status === 'running'
      ? task.phase === 'saving'
        ? t('analysisRunningSaving')
        : t('analysisRunningGenerating')
      : task.status === 'failed' && task.errorMessage
        ? task.errorMessage
        : t('analysisTaskIdleHint');

  const jumpToResult = () => {
    const params = new URLSearchParams({
      evaluationId: task.evaluationId,
      tab: 'results',
      subtab: 'analysis',
    });
    if (task.reportId) {
      params.set('analysisReportId', task.reportId);
    }
    if (task.runIds.length > 0) {
      params.set('runId', task.runIds[0]);
    }
    clearTask();
    navigate(`/evaluation?${params.toString()}`);
  };

  if (collapsed) {
    return (
      <div className="fixed bottom-6 right-6 z-40">
        <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-700/80 light:border-slate-300 bg-slate-900/95 light:bg-white/95 backdrop-blur shadow-2xl">
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-slate-200 light:text-slate-700 hover:bg-slate-800 light:hover:bg-slate-100 transition-colors"
            onClick={jumpToResult}
            title={t('analysisTaskQuickView')}
          >
            {statusInfo.icon}
            <span className={`${statusInfo.colorClass} font-medium`}>{statusInfo.label}</span>
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-200 light:hover:text-slate-700 hover:bg-slate-800 light:hover:bg-slate-100 transition-colors"
            onClick={() => setCollapsed(false)}
            title={t('analysisTaskExpand')}
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-200 light:hover:text-slate-700 hover:bg-slate-800 light:hover:bg-slate-100 transition-colors"
            onClick={clearTask}
            title={t('analysisTaskDismiss')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-cyan-500/30 bg-slate-900/95 light:bg-white/95 backdrop-blur p-3 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-sm font-medium flex items-center gap-2 ${statusInfo.colorClass}`}>
            {statusInfo.icon}
            <span>{t('analysisRunningBannerTitle')}</span>
          </div>
          <div className="text-xs text-slate-400 light:text-slate-600 mt-1 truncate">
            {t('analysisRunningBannerMeta', {
              scope: task.scope === 'single' ? t('singleRunAnalysis') : t('multiRunAnalysis'),
              label: task.runLabel,
            })}
          </div>
          <div className="text-xs text-slate-500 light:text-slate-600 mt-0.5 truncate">
            {statusDetail}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-200 light:hover:text-slate-700 hover:bg-slate-800 light:hover:bg-slate-100 transition-colors"
            onClick={() => setCollapsed(true)}
            title={t('analysisTaskCollapse')}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-200 light:hover:text-slate-700 hover:bg-slate-800 light:hover:bg-slate-100 transition-colors"
            onClick={clearTask}
            title={t('analysisTaskDismiss')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end">
        <Button variant="secondary" size="sm" onClick={jumpToResult}>
          <ExternalLink className="w-4 h-4" />
          {t('analysisTaskQuickView')}
        </Button>
      </div>
    </div>
  );
}
