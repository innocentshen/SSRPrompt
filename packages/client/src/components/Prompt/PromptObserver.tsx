import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Eye,
  Clock,
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
import { tracesApi } from '../../api';
import { AttachmentList } from './AttachmentPreview';
import { AttachmentModal } from './AttachmentModal';
import { ChatTranscript, type ChatTranscriptMessage } from './ChatTranscript';
import { OcrResultsPanel } from './OcrResultsPanel';
import type { Trace, Model, FileAttachment, OcrProvider } from '../../types';
import { extractThinking } from '../../lib/ai-service';

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
  promptName?: string;
  models: Model[];
}

// API now returns camelCase, no transformation needed
const transformTrace = (t: unknown): Trace => t as Trace;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripOcrFileBlocks = (content: string, fileNames: string[]) => {
  if (!content || fileNames.length === 0) return content;
  const escaped = fileNames.map(escapeRegExp).join('|');
  if (!escaped) return content;
  const pattern = new RegExp(`\\[File: (?:${escaped})\\]\\r?\\n\`\`\`[\\s\\S]*?\`\`\`\\r?\\n?`, 'g');
  const cleaned = content.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
};

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
    totalTokensIn: traces.reduce((sum, t) => sum + (t.tokensInput || 0), 0),
    totalTokensOut: traces.reduce((sum, t) => sum + (t.tokensOutput || 0), 0),
    avgLatencyMs: Math.round(traces.reduce((sum, t) => sum + (t.latencyMs || 0), 0) / traces.length),
    successRate: Math.round((successCount / traces.length) * 100),
    errorCount: traces.length - successCount,
  };
}

export function PromptObserver({ promptId, promptName, models }: PromptObserverProps) {
  const { t } = useTranslation('prompts');
  const { t: tCommon } = useTranslation('common');
  const { t: tTraces } = useTranslation('traces');
  const [traces, setTraces] = useState<Trace[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const [stats, setStats] = useState<TraceStats | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachment | null>(null);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);

  const hasAttachments = (trace: Trace): boolean => {
    // Check both attachments array and metadata.files
    if (trace.attachments && trace.attachments.length > 0) {
      return true;
    }
    const metadata = trace.metadata as { files?: { name: string; type: string }[] } | null;
    return !!(metadata?.files && metadata.files.length > 0);
  };

  const getAttachmentCount = (trace: Trace): number => {
    if (trace.attachments && trace.attachments.length > 0) {
      return trace.attachments.length;
    }
    const metadata = trace.metadata as { files?: { name: string; type: string }[] } | null;
    return metadata?.files?.length || 0;
  };

  const handleSelectTrace = async (trace: Trace) => {
    // Always fetch full trace details (list doesn't include output field)
    setSelectedTrace(trace);
    setAttachmentsLoading(true);
    try {
      const fullTrace = await tracesApi.getById(trace.id);
      setSelectedTrace(transformTrace(fullTrace));
    } catch (e) {
      console.error('Failed to load full trace:', e);
    } finally {
      setAttachmentsLoading(false);
    }
  };

  const loadTraces = useCallback(async () => {
    setLoading(true);
    try {
      const response = await tracesApi.list({
        promptId,
        limit: 100,
        status: filterStatus !== 'all' ? (filterStatus as 'success' | 'error') : undefined,
      });

      const transformedTraces = response.data.map(transformTrace);
      setTraces(transformedTraces);
      setStats(calculateStats(transformedTraces));
    } catch (e) {
      console.error('Failed to load traces:', e);
    }
    setLoading(false);
  }, [filterStatus, promptId]);

  useEffect(() => {
    loadTraces();
  }, [loadTraces]);

  const getModelName = (id: string | null) => models.find((m) => m.id === id)?.name || '-';

  const selectedTraceOcr = useMemo(() => {
    if (!selectedTrace) {
      return { hasOcr: false, provider: undefined as OcrProvider | undefined, attachments: [] as FileAttachment[] };
    }
    const metadata = selectedTrace.metadata as {
      ocrProvider?: string;
      ocrFileIds?: string[];
      timings?: { ocrLatencyMs?: number };
    } | null;
    const ocrFileIds = Array.isArray(metadata?.ocrFileIds) ? metadata!.ocrFileIds! : [];
    const hasOcr = ocrFileIds.length > 0 || ((metadata?.timings?.ocrLatencyMs ?? 0) > 0);
    const attachments = (selectedTrace.attachments || []) as FileAttachment[];
    const filtered = ocrFileIds.length > 0 ? attachments.filter((a) => ocrFileIds.includes(a.fileId)) : attachments;
    return { hasOcr, provider: metadata?.ocrProvider as OcrProvider | undefined, attachments: filtered };
  }, [selectedTrace]);

  const selectedTraceParameters = useMemo(() => {
    if (!selectedTrace) return [];
    const metadata = selectedTrace.metadata as Record<string, unknown> | null;
    const candidate =
      (metadata?.modelParameters as Record<string, unknown> | undefined) ||
      (metadata?.model_parameters as Record<string, unknown> | undefined) ||
      (metadata?.parameters as Record<string, unknown> | undefined);

    if (!candidate || typeof candidate !== 'object') return [];

    return [
      { label: t('temperature'), value: candidate.temperature },
      { label: t('topP'), value: candidate.top_p ?? candidate.topP },
      { label: t('maxTokens'), value: candidate.max_tokens ?? candidate.maxTokens },
      { label: t('frequencyPenalty'), value: candidate.frequency_penalty ?? candidate.frequencyPenalty },
      { label: t('presencePenalty'), value: candidate.presence_penalty ?? candidate.presencePenalty },
    ].filter((item) => item.value !== undefined && item.value !== null);
  }, [selectedTrace, t]);

  const displayInput = useMemo(() => {
    if (!selectedTrace) return '';
    if (!selectedTraceOcr.hasOcr || selectedTraceOcr.attachments.length === 0) {
      return selectedTrace.input;
    }
    const fileNames = selectedTraceOcr.attachments.map((attachment) => attachment.name).filter(Boolean);
    return stripOcrFileBlocks(selectedTrace.input, fileNames);
  }, [selectedTrace, selectedTraceOcr]);

  const assistantResponse = useMemo(() => {
    if (!selectedTrace) {
      return { content: '', thinking: undefined as string | undefined };
    }

    const rawOutput = selectedTrace.output || '';
    const extracted = extractThinking(rawOutput);
    const storedThinking = (selectedTrace.thinkingContent ?? '').trim();
    const mergedThinking = [storedThinking, extracted.thinking].filter(Boolean).join('\n\n').trim();
    return {
      content: extracted.content,
      thinking: mergedThinking ? mergedThinking : undefined,
    };
  }, [selectedTrace]);

  const transcriptMessages = useMemo(() => {
    if (!selectedTrace) return null;

    const metadata = selectedTrace.metadata as Record<string, unknown> | null;
    const rawMessages = (metadata?.messages as unknown) ?? null;
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) return null;

    const fileNames =
      selectedTraceOcr.hasOcr && selectedTraceOcr.attachments.length > 0
        ? selectedTraceOcr.attachments.map((attachment) => attachment.name).filter(Boolean)
        : [];
    const normalizeContent = (content: string) => (fileNames.length > 0 ? stripOcrFileBlocks(content, fileNames) : content);

    const base = rawMessages
      .map((item, idx): ChatTranscriptMessage | null => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const roleValue = record.role;
        if (roleValue !== 'system' && roleValue !== 'user' && roleValue !== 'assistant') return null;
        const role = roleValue as ChatTranscriptMessage['role'];
        const content = typeof record.content === 'string' ? normalizeContent(record.content) : '';
        const modelId = typeof record.modelId === 'string' ? record.modelId : undefined;
        const thinking = typeof record.thinking === 'string' ? record.thinking : undefined;
        const resolvedAssistantLabel = role === 'assistant' && modelId ? getModelName(modelId) : undefined;
        return { id: `${selectedTrace.id}_ctx_${idx}`, role, content, thinking, modelId, assistantLabel: resolvedAssistantLabel };
      })
      .filter((message): message is ChatTranscriptMessage => message !== null);

    if (base.length === 0) return null;

    const messages: ChatTranscriptMessage[] = base.slice();
    const attachments = selectedTrace.attachments ?? undefined;
    if (attachments && attachments.length > 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          messages[i] = { ...messages[i], attachments };
          break;
        }
      }
    }

    messages.push({
      id: `${selectedTrace.id}_assistant`,
      role: 'assistant',
      content: assistantResponse.content,
      thinking: assistantResponse.thinking,
      modelId: selectedTrace.modelId || undefined,
      assistantLabel: getModelName(selectedTrace.modelId),
    });

    return messages;
  }, [assistantResponse.content, assistantResponse.thinking, selectedTrace, selectedTraceOcr]);

  const filteredTraces = traces.filter((t) => {
    if (filterStatus === 'all') return true;
    return t.status === filterStatus;
  });

  const formatTime = (dateString: string | undefined | null) => {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '-';
      return date.toLocaleString(undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '-';
    }
  };

  const formatParamValue = (value: unknown) => {
    if (value === undefined || value === null) return '-';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  return (
    <div className="h-full flex flex-col">
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
                      {getModelName(trace.modelId)}
                    </span>
                    <span className="text-xs text-slate-500">{formatTime(trace.createdAt)}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {trace.input ? `${trace.input.substring(0, 100)}...` : '-'}
                  </p>
                </div>
                <div className="flex-shrink-0 flex items-center gap-4 text-xs">
                  <span className="text-slate-400">
                    <span className="text-cyan-400 light:text-cyan-600">{trace.tokensInput}</span>
                    <span className="mx-1">/</span>
                    <span className="text-teal-400 light:text-teal-600">{trace.tokensOutput}</span>
                  </span>
                  <span className="text-slate-400 light:text-slate-600">{trace.latencyMs}ms</span>
                  <ChevronRight className="w-4 h-4 text-slate-600 light:text-slate-400" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={!!selectedTrace}
        onClose={() => setSelectedTrace(null)}
        title={t('callDetails')}
        size="wide"
      >
        {selectedTrace && (
          <div className="h-[72vh] overflow-hidden">
            <div className="h-full grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="h-full overflow-y-auto space-y-4 pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('status')}</p>
                  <Badge variant={selectedTrace.status === 'success' ? 'success' : 'error'}>
                    {selectedTrace.status === 'success' ? t('success') : t('error')}
                  </Badge>
                </div>
                <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('latency')}</p>
                  <p className="text-sm font-medium text-slate-200 light:text-slate-800">{selectedTrace.latencyMs}ms</p>
                </div>
                <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('input')} Tokens</p>
                  <p className="text-sm font-medium text-cyan-400 light:text-cyan-600">{selectedTrace.tokensInput}</p>
                </div>
                <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('output')} Tokens</p>
                  <p className="text-sm font-medium text-teal-400 light:text-teal-600">{selectedTrace.tokensOutput}</p>
                </div>
              </div>

              <div className="p-3 bg-slate-800/40 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{tTraces('prompt')}</p>
                <p className="text-sm text-slate-200 light:text-slate-800">{promptName || promptId}</p>
              </div>

              <div className="p-3 bg-slate-800/40 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('model')}</p>
                <p className="text-sm text-slate-200 light:text-slate-800">{getModelName(selectedTrace.modelId)}</p>
              </div>

              <div className="p-3 bg-slate-800/40 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('modelParameters')}</p>
                <div className="mt-2 space-y-1 text-xs">
                  {selectedTraceParameters.length > 0 ? (
                    selectedTraceParameters.map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-3 text-slate-300 light:text-slate-700">
                        <span className="text-slate-500 light:text-slate-600">{item.label}</span>
                        <span className="text-slate-200 light:text-slate-800">{formatParamValue(item.value)}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-slate-500 light:text-slate-600">{t('empty')}</span>
                  )}
                </div>
              </div>

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

              {selectedTraceOcr.hasOcr && selectedTraceOcr.attachments.length > 0 && (
                <OcrResultsPanel
                  attachments={selectedTraceOcr.attachments}
                  provider={selectedTraceOcr.provider}
                  defaultOpen={true}
                  heightClassName="h-[260px]"
                />
              )}

              {selectedTrace.errorMessage && (
                <div>
                  <h4 className="text-sm font-medium text-rose-400 light:text-rose-600 mb-2">{tCommon('error')}</h4>
                  <div className="p-4 bg-rose-500/10 light:bg-rose-50 border border-rose-500/30 light:border-rose-200 rounded-lg">
                    <pre className="text-sm text-rose-300 light:text-rose-700 whitespace-pre-wrap font-mono">
                      {selectedTrace.errorMessage}
                    </pre>
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-slate-700 light:border-slate-200">
                <p className="text-xs text-slate-500 light:text-slate-600">
                  {t('createdAt')}: {formatTime(selectedTrace.createdAt)}
                </p>
              </div>
            </div>

            <div className="h-full min-h-0 p-4 bg-slate-800/30 light:bg-slate-50 border border-slate-700 light:border-slate-200 rounded-lg overflow-y-auto">
              <ChatTranscript
                messages={
                  transcriptMessages ?? [
                    {
                      id: `${selectedTrace.id}_user`,
                      role: 'user',
                      content: displayInput,
                      attachments: selectedTrace.attachments ?? undefined,
                    },
                    {
                      id: `${selectedTrace.id}_assistant`,
                      role: 'assistant',
                      content: assistantResponse.content,
                      thinking: assistantResponse.thinking,
                      modelId: selectedTrace.modelId || undefined,
                      assistantLabel: getModelName(selectedTrace.modelId),
                    },
                  ]
                }
                assistantLabel={getModelName(selectedTrace.modelId)}
                onPreviewAttachment={setPreviewAttachment}
              />
            </div>
            </div>
          </div>
        )}
      </Modal>

      <AttachmentModal
        attachment={previewAttachment}
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
