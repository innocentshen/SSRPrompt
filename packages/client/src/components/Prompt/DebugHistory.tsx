import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { History, Clock, CheckCircle, XCircle, RotateCcw, Trash2, Eye, Paperclip, Brain } from 'lucide-react';
import { Collapsible, Button, Badge } from '../ui';
import { AttachmentList } from './AttachmentPreview';
import type { FileAttachment } from '../../lib/ai-service';

export interface DebugRun {
  id: string;
  input: string;
  inputVariables: Record<string, string>;
  output: string;
  status: 'success' | 'error';
  errorMessage?: string;
  latencyMs: number;
  tokensInput: number;
  tokensOutput: number;
  timestamp: Date;
  attachments?: FileAttachment[];
  thinking?: string;
}

interface DebugHistoryProps {
  runs: DebugRun[];
  onReplay: (run: DebugRun) => void;
  onClear: () => void;
  onDelete: (runId: string) => void;
  onSelect: (run: DebugRun) => void;
  onViewDetails?: (run: DebugRun) => void;
  onPreviewAttachment?: (attachment: FileAttachment) => void;
  selectedRunId?: string;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// Memoized debug run item for better performance
const DebugRunItem = memo(function DebugRunItem({
  run,
  isSelected,
  onSelect,
  onReplay,
  onDelete,
  onViewDetails,
  onPreviewAttachment,
}: {
  run: DebugRun;
  isSelected: boolean;
  onSelect: () => void;
  onReplay: () => void;
  onDelete: () => void;
  onViewDetails?: () => void;
  onPreviewAttachment?: (attachment: FileAttachment) => void;
}) {
  const { t } = useTranslation('prompts');

  return (
    <div
      onClick={onSelect}
      className={`p-2 rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? 'bg-cyan-500/10 border border-cyan-500/30'
          : 'bg-slate-800/50 light:bg-slate-50 border border-slate-700 light:border-slate-200 hover:bg-slate-800 light:hover:bg-slate-100'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        {run.status === 'success' ? (
          <CheckCircle className="w-3.5 h-3.5 text-green-400 light:text-green-600" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-red-400 light:text-red-600" />
        )}
        <span className="text-xs text-slate-400 light:text-slate-500 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTime(run.timestamp)}
        </span>
        <Badge variant={run.status === 'success' ? 'success' : 'error'} className="text-xs">
          {formatLatency(run.latencyMs)}
        </Badge>
        <div className="flex-1" />
        {onViewDetails && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onViewDetails();
            }}
            className="p-1"
            title={t('viewDetails')}
          >
            <Eye className="w-3 h-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onReplay();
          }}
          className="p-1"
          title={t('replayInput')}
        >
          <RotateCcw className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1 text-red-400 hover:text-red-300"
          title={t('deleteRecord')}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>

      {/* Input preview */}
      <div className="text-xs text-slate-300 light:text-slate-700 truncate">
        {run.input.slice(0, 60)}
        {run.input.length > 60 && '...'}
      </div>

      {/* Attachments and thinking indicators */}
      {(run.attachments?.length || run.thinking) && (
        <div className="flex items-center gap-2 mt-1">
          {run.attachments && run.attachments.length > 0 && (
            <div className="flex items-center gap-1">
              <Paperclip className="w-3 h-3 text-slate-500" />
              <AttachmentList
                attachments={run.attachments}
                size="sm"
                maxVisible={2}
                onPreview={onPreviewAttachment}
              />
            </div>
          )}
          {run.thinking && (
            <div className="flex items-center gap-1 text-purple-400 light:text-purple-600">
              <Brain className="w-3 h-3" />
              <span className="text-xs">{t('hasThinking')}</span>
            </div>
          )}
        </div>
      )}

      {/* Error or token counts */}
      {run.status === 'error' ? (
        <div className="text-xs text-red-400 light:text-red-500 truncate mt-1">
          {run.errorMessage}
        </div>
      ) : (
        <div className="flex gap-2 mt-1 text-xs text-slate-500">
          <span>{run.tokensInput} / {run.tokensOutput} tokens</span>
        </div>
      )}
    </div>
  );
});

export const DebugHistory = memo(function DebugHistory({
  runs,
  onReplay,
  onClear,
  onDelete,
  onSelect,
  onViewDetails,
  onPreviewAttachment,
  selectedRunId,
}: DebugHistoryProps) {
  const { t } = useTranslation('prompts');

  // Use callbacks to avoid creating new function references
  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClear();
  }, [onClear]);

  return (
    <Collapsible
      title={`${t('debugHistory')} (${runs.length})`}
      icon={<History className="w-4 h-4 text-cyan-400 light:text-cyan-600" />}
      action={
        runs.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="text-xs text-red-400 hover:text-red-300"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            {t('clearHistory')}
          </Button>
        )
      }
    >
      <div className="space-y-2 max-h-[200px] overflow-y-auto">
        {runs.length === 0 ? (
          <div className="text-center py-3 text-slate-500 light:text-slate-500 text-sm">
            {t('runPromptToShowHistory')}
          </div>
        ) : (
          runs.map((run) => (
            <DebugRunItem
              key={run.id}
              run={run}
              isSelected={selectedRunId === run.id}
              onSelect={() => onSelect(run)}
              onReplay={() => onReplay(run)}
              onDelete={() => onDelete(run.id)}
              onViewDetails={onViewDetails ? () => onViewDetails(run) : undefined}
              onPreviewAttachment={onPreviewAttachment}
            />
          ))
        )}
      </div>
    </Collapsible>
  );
});
