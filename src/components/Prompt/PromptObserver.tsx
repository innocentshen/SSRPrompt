import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Eye,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  RefreshCw,
  Activity,
  Coins,
  TrendingUp,
  Paperclip,
  Loader2,
} from 'lucide-react';
import { Button, Badge, Select, Modal } from '../ui';
import { getDatabase } from '../../lib/database';
import { AttachmentList } from './AttachmentPreview';
import { AttachmentModal } from './AttachmentModal';
import type { Trace, Model, FileAttachment } from '../../types';

interface TraceStats {
  totalCalls: number;
  totalTokensIn: number;
  totalTokensOut: number;
  avgLatencyMs: number;
  successRate: number;
  errorCount: number;
}

interface PromptObserverProps {
  promptId: string;
  models: Model[];
}

function calculateStats(traces: Trace[]): TraceStats {
  if (traces.length === 0) {
    return {
      totalCalls: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      avgLatencyMs: 0,
      successRate: 100,
      errorCount: 0,
    };
  }

  const successCount = traces.filter((t) => t.status === 'success').length;
  return {
    totalCalls: traces.length,
    totalTokensIn: traces.reduce((sum, t) => sum + t.tokens_input, 0),
    totalTokensOut: traces.reduce((sum, t) => sum + t.tokens_output, 0),
    avgLatencyMs: Math.round(traces.reduce((sum, t) => sum + t.latency_ms, 0) / traces.length),
    successRate: Math.round((successCount / traces.length) * 100),
    errorCount: traces.length - successCount,
  };
}

export function PromptObserver({ promptId, models }: PromptObserverProps) {
  const { t } = useTranslation('prompts');
  const [traces, setTraces] = useState<Trace[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const [stats, setStats] = useState<TraceStats | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachment | null>(null);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);

  // Check if trace has attachments (via metadata.files)
  const hasAttachments = (trace: Trace): boolean => {
    const metadata = trace.metadata as { files?: { name: string; type: string }[] } | null;
    return !!(metadata?.files && metadata.files.length > 0);
  };

  // Get attachment count from metadata
  const getAttachmentCount = (trace: Trace): number => {
    const metadata = trace.metadata as { files?: { name: string; type: string }[] } | null;
    return metadata?.files?.length || 0;
  };

  // Handle trace selection with async attachment loading
  const handleSelectTrace = async (trace: Trace) => {
    setSelectedTrace(trace);
    setAttachmentsLoading(false);

    if (hasAttachments(trace)) {
      setAttachmentsLoading(true);
      try {
        const { data } = await getDatabase()
          .from('traces')
          .select('attachments')
          .eq('id', trace.id)
          .single();

        if (data?.attachments) {
          setSelectedTrace(prev => prev ? { ...prev, attachments: data.attachments } : null);
        }
      } catch (e) {
        console.error('Failed to load attachments:', e);
      } finally {
        setAttachmentsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadTraces();
  }, [promptId]);

  const loadTraces = async () => {
    setLoading(true);
    try {
      // Exclude attachments field from initial query for better performance
      const { data, error } = await getDatabase()
        .from('traces')
        .select('id,user_id,prompt_id,model_id,input,output,tokens_input,tokens_output,latency_ms,status,error_message,metadata,created_at')
        .eq('prompt_id', promptId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('Failed to load traces:', error);
      }
      if (data) {
        setTraces(data);
        setStats(calculateStats(data));
      }
    } catch (e) {
      console.error('Failed to load traces:', e);
    }
    setLoading(false);
  };

  const getModelName = (id: string | null) => models.find((m) => m.id === id)?.name || '-';

  const filteredTraces = traces.filter((t) => {
    if (filterStatus === 'all') return true;
    return t.status === filterStatus;
  });

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Stats Cards */}
      <div className="flex-shrink-0 p-4 border-b border-slate-700 light:border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-cyan-400 light:text-cyan-600" />
            <h3 className="text-lg font-medium text-slate-200 light:text-slate-800">
              {t('callRecords')}
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <Select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              options={[
                { value: 'all', label: t('allStatus') },
                { value: 'success', label: t('success') },
                { value: 'error', label: t('error') },
              ]}
            />
            <Button variant="secondary" size="sm" onClick={loadTraces} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-4 gap-3">
            <div className="p-3 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg">
              <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-1">
                <Activity className="w-3.5 h-3.5" />
                <span className="text-xs">{t('callCount')}</span>
              </div>
              <p className="text-xl font-bold text-white light:text-slate-900">{stats.totalCalls}</p>
            </div>
            <div className="p-3 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg">
              <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-1">
                <Coins className="w-3.5 h-3.5" />
                <span className="text-xs">{t('tokenConsumption')}</span>
              </div>
              <p className="text-xl font-bold text-white light:text-slate-900">
                {(stats.totalTokensIn + stats.totalTokensOut).toLocaleString()}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {t('in')} {stats.totalTokensIn.toLocaleString()} / {t('out')} {stats.totalTokensOut.toLocaleString()}
              </p>
            </div>
            <div className="p-3 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg">
              <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-1">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-xs">{t('avgLatency')}</span>
              </div>
              <p className="text-xl font-bold text-white light:text-slate-900">{stats.avgLatencyMs}ms</p>
            </div>
            <div className="p-3 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg">
              <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-1">
                <TrendingUp className="w-3.5 h-3.5" />
                <span className="text-xs">{t('successRate')}</span>
              </div>
              <p className={`text-xl font-bold ${stats.successRate >= 90 ? 'text-green-400' : stats.successRate >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
                {stats.successRate}%
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Trace List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="w-8 h-8 text-slate-600 animate-spin" />
          </div>
        ) : filteredTraces.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <Eye className="w-12 h-12 text-slate-600 light:text-slate-400 mb-4" />
            <h4 className="text-lg font-medium text-slate-300 light:text-slate-700 mb-2">
              {t('noCallRecords')}
            </h4>
            <p className="text-sm text-slate-500 light:text-slate-500 max-w-md">
              {t('runPromptToShowRecords')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800 light:divide-slate-200">
            {filteredTraces.map((trace) => (
              <div
                key={trace.id}
                className="px-4 py-3 hover:bg-slate-800/30 light:hover:bg-slate-50 cursor-pointer transition-colors flex items-center gap-4"
                onClick={() => handleSelectTrace(trace)}
              >
                <div className="flex-shrink-0">
                  {trace.status === 'success' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-rose-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm text-slate-300 light:text-slate-800 font-medium truncate">
                      {getModelName(trace.model_id)}
                    </span>
                    <span className="text-xs text-slate-500">{formatTime(trace.created_at)}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {trace.input.substring(0, 100)}...
                  </p>
                </div>
                <div className="flex-shrink-0 flex items-center gap-4 text-xs">
                  <span className="text-slate-400">
                    <span className="text-cyan-400 light:text-cyan-600">{trace.tokens_input}</span>
                    <span className="mx-1">/</span>
                    <span className="text-teal-400 light:text-teal-600">{trace.tokens_output}</span>
                  </span>
                  <span className="text-slate-400 light:text-slate-600">{trace.latency_ms}ms</span>
                  <ChevronRight className="w-4 h-4 text-slate-600 light:text-slate-400" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Trace Detail Modal */}
      <Modal
        isOpen={!!selectedTrace}
        onClose={() => setSelectedTrace(null)}
        title={t('callDetails')}
        size="lg"
      >
        {selectedTrace && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('status')}</p>
                <Badge variant={selectedTrace.status === 'success' ? 'success' : 'error'}>
                  {selectedTrace.status === 'success' ? t('success') : t('error')}
                </Badge>
              </div>
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('latency')}</p>
                <p className="text-sm font-medium text-slate-200 light:text-slate-800">
                  {selectedTrace.latency_ms}ms
                </p>
              </div>
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('inputTokens')}</p>
                <p className="text-sm font-medium text-cyan-400 light:text-cyan-600">
                  {selectedTrace.tokens_input}
                </p>
              </div>
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('outputTokens')}</p>
                <p className="text-sm font-medium text-teal-400 light:text-teal-600">
                  {selectedTrace.tokens_output}
                </p>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-slate-300 light:text-slate-700 mb-2">{t('input')}</h4>
              <div className="p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg max-h-40 overflow-y-auto">
                <pre className="text-sm text-slate-300 light:text-slate-700 whitespace-pre-wrap font-mono">
                  {selectedTrace.input}
                </pre>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-slate-300 light:text-slate-700 mb-2">{t('output')}</h4>
              <div className="p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg max-h-40 overflow-y-auto">
                <pre className="text-sm text-slate-300 light:text-slate-700 whitespace-pre-wrap font-mono">
                  {selectedTrace.output || t('empty')}
                </pre>
              </div>
            </div>

            {selectedTrace.error_message && (
              <div>
                <h4 className="text-sm font-medium text-rose-400 light:text-rose-600 mb-2">
                  {t('errorMessage')}
                </h4>
                <div className="p-4 bg-rose-500/10 light:bg-rose-50 border border-rose-500/30 light:border-rose-200 rounded-lg">
                  <pre className="text-sm text-rose-300 light:text-rose-700 whitespace-pre-wrap font-mono">
                    {selectedTrace.error_message}
                  </pre>
                </div>
              </div>
            )}

            {/* Attachments Section */}
            {hasAttachments(selectedTrace) && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Paperclip className="w-4 h-4 text-slate-400" />
                  <h4 className="text-sm font-medium text-slate-300 light:text-slate-700">
                    {t('attachments')} ({getAttachmentCount(selectedTrace)})
                  </h4>
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg min-h-[60px]">
                  {attachmentsLoading ? (
                    <div className="flex items-center gap-2 text-slate-400 light:text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">{t('loadingAttachments')}</span>
                    </div>
                  ) : selectedTrace.attachments && selectedTrace.attachments.length > 0 ? (
                    <AttachmentList
                      attachments={selectedTrace.attachments as FileAttachment[]}
                      size="md"
                      maxVisible={10}
                      onPreview={setPreviewAttachment}
                    />
                  ) : (
                    <div className="flex items-center gap-2 text-slate-500 light:text-slate-400">
                      <span className="text-sm">{t('attachmentLoadFailed')}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-slate-700 light:border-slate-200">
              <p className="text-xs text-slate-500 light:text-slate-600">
                {t('createdAt')}: {new Date(selectedTrace.created_at).toLocaleString()}
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Attachment Preview Modal */}
      <AttachmentModal
        attachment={previewAttachment}
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
