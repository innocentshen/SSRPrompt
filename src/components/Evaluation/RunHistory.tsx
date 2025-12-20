import { Clock, CheckCircle2, XCircle, Loader2, Play, ChevronRight, Zap, Square } from 'lucide-react';
import { Badge, Button } from '../ui';
import type { EvaluationRun, EvaluationStatus } from '../../types';

interface RunHistoryProps {
  runs: EvaluationRun[];
  selectedRunId: string | null;
  onSelectRun: (run: EvaluationRun) => void;
  onStopRun?: (runId: string) => void;
}

const statusConfig: Record<EvaluationStatus, { label: string; variant: 'info' | 'warning' | 'success' | 'error'; icon: React.ReactNode }> = {
  pending: { label: '等待中', variant: 'info', icon: <Clock className="w-4 h-4" /> },
  running: { label: '运行中', variant: 'warning', icon: <Loader2 className="w-4 h-4 animate-spin" /> },
  completed: { label: '已完成', variant: 'success', icon: <CheckCircle2 className="w-4 h-4" /> },
  failed: { label: '失败', variant: 'error', icon: <XCircle className="w-4 h-4" /> },
};

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return '-';
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  const durationMs = end - start;

  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;
}

export function RunHistory({ runs, selectedRunId, onSelectRun, onStopRun }: RunHistoryProps) {
  if (runs.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 light:text-slate-600 border border-dashed border-slate-700 light:border-slate-300 rounded-lg">
        <Play className="w-12 h-12 mx-auto mb-3 text-slate-600 light:text-slate-400" />
        <p>暂无执行记录</p>
        <p className="text-xs mt-1">点击"运行评测"开始第一次执行</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-300 light:text-slate-700 flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-400 light:text-slate-500" />
          执行历史
        </h3>
        <span className="text-xs text-slate-500 light:text-slate-600">共 {runs.length} 次执行</span>
      </div>

      <div className="space-y-2">
        {runs.map((run, index) => {
          const status = statusConfig[run.status];
          const isSelected = selectedRunId === run.id;
          const passRate = run.results.total_cases
            ? ((run.results.passed_cases || 0) / run.results.total_cases * 100).toFixed(0)
            : null;

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
                        第 {runs.length - index} 次执行
                      </span>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <p className="text-xs text-slate-500 light:text-slate-600 mt-1">
                      {new Date(run.started_at).toLocaleString('zh-CN')}
                    </p>
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
                      <p className="text-xs text-slate-500 light:text-slate-600">通过率</p>
                    </div>
                  )}
                  <ChevronRight className={`w-5 h-5 transition-colors ${
                    isSelected ? 'text-cyan-400 light:text-cyan-600' : 'text-slate-600 light:text-slate-400'
                  }`} />
                </div>
              </div>

              {run.status === 'completed' && run.results.total_cases && (
                <div className="mt-3 pt-3 border-t border-slate-700/50 light:border-slate-200 grid grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-slate-500 light:text-slate-600">测试用例</p>
                    <p className="text-sm text-slate-300 light:text-slate-700">{run.results.total_cases}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 light:text-slate-600">通过</p>
                    <p className="text-sm text-emerald-400 light:text-emerald-600">{run.results.passed_cases || 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 light:text-slate-600">Token 消耗</p>
                    <p className="text-sm text-cyan-400 light:text-cyan-600 flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      {((run.total_tokens_input || 0) + (run.total_tokens_output || 0)).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 light:text-slate-600">耗时</p>
                    <p className="text-sm text-slate-300 light:text-slate-700">{formatDuration(run.started_at, run.completed_at)}</p>
                  </div>
                </div>
              )}

              {run.status === 'failed' && run.error_message && (
                <div className="mt-3 pt-3 border-t border-slate-700/50 light:border-slate-200">
                  <p className="text-xs text-rose-400 light:text-rose-600 line-clamp-2">{run.error_message}</p>
                </div>
              )}

              {run.status === 'running' && (
                <div className="mt-3 pt-3 border-t border-slate-700/50 light:border-slate-200">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-700 light:bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500 light:bg-amber-400 rounded-full animate-pulse" style={{ width: '60%' }} />
                    </div>
                    <span className="text-xs text-slate-500 light:text-slate-600">执行中...</span>
                    {onStopRun && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onStopRun(run.id);
                        }}
                      >
                        <Square className="w-3 h-3" />
                        <span>中止</span>
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
