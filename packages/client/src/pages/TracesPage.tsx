import { useState, useEffect, useMemo, useCallback } from 'react';
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
  FileText,
  Search,
  Trash2,
  History,
  Paperclip,
  Loader2,
} from 'lucide-react';
import { Button, Badge, Select, Modal, Input, useToast } from '../components/ui';
import { tracesApi, promptsApi, modelsApi } from '../api';
import type { Trace, TraceListItem, PromptListItem, Model, OcrProvider } from '../types';
import type { FileAttachment } from '../lib/ai-service';
import { AttachmentList } from '../components/Prompt/AttachmentPreview';
import { AttachmentModal } from '../components/Prompt/AttachmentModal';
import { ChatTranscript, type ChatTranscriptMessage } from '../components/Prompt/ChatTranscript';
import { OcrResultsPanel } from '../components/Prompt/OcrResultsPanel';

// API returns camelCase, use directly

interface PromptStats {
  promptId: string | null;
  promptName: string;
  count: number;
  totalTokens: number;
  avgLatency: number;
  errorCount: number;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripOcrFileBlocks = (content: string, fileNames: string[]) => {
  if (!content || fileNames.length === 0) return content;
  const escaped = fileNames.map(escapeRegExp).join('|');
  if (!escaped) return content;
  const pattern = new RegExp(`\\[File: (?:${escaped})\\]\\r?\\n\`\`\`[\\s\\S]*?\`\`\`\\r?\\n?`, 'g');
  const cleaned = content.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
};

export function TracesPage() {
  const { showToast } = useToast();
  const { t } = useTranslation('traces');
  const { t: tCommon } = useTranslation('common');
  const { t: tPrompts } = useTranslation('prompts');
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [prompts, setPrompts] = useState<PromptListItem[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachment | null>(null);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);

  // Safe date formatting helper
  const formatDate = (dateString: string | undefined | null) => {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '-';
      return date.toLocaleString('zh-CN');
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

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tracesRes, promptsRes, modelsRes] = await Promise.all([
        tracesApi.list({ limit: 100 }),
        promptsApi.list(),
        modelsApi.list(),
      ]);

      setTraces(tracesRes.data);
      setPrompts(promptsRes);
      setModels(modelsRes);
    } catch (e) {
      console.error('Failed to load data:', e);
      showToast('error', t('loadFailed'));
    }
    setLoading(false);
  }, [showToast, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDeleteTraces = async () => {
    if (!selectedPromptId) return;

    setDeleting(true);
    try {
      await tracesApi.deleteByPrompt(selectedPromptId === '__all__' ? null : selectedPromptId);
      showToast('success', t('historyDeleted'));
      setShowDeleteConfirm(false);
      setSelectedPromptId(null);
      await loadData();
    } catch {
      showToast('error', t('deleteFailed'));
    }
    setDeleting(false);
  };

  const handleDeleteSingleTrace = async (traceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await tracesApi.delete(traceId);
      setTraces((prev) => prev.filter((t) => t.id !== traceId));
      if (selectedTrace?.id === traceId) {
        setSelectedTrace(null);
      }
      showToast('success', t('recordDeleted'));
    } catch {
      showToast('error', t('deleteFailed'));
    }
  };

  const getPromptName = useCallback(
    (id: string | null) => prompts.find((p) => p.id === id)?.name || t('notLinked'),
    [prompts, t]
  );
  const getModelName = useCallback((id: string | null) => models.find((m) => m.id === id)?.name || '-', [models]);


  // 检查 trace 是否有附件
  const hasAttachments = (trace: Trace): boolean => {
    // Check both attachments array and metadata.files
    if (trace.attachments && trace.attachments.length > 0) {
      return true;
    }
    const metadata = trace.metadata as { files?: { name: string; type: string }[] } | null;
    return !!(metadata?.files && metadata.files.length > 0);
  };

  // 获取附件数量
  const getAttachmentCount = (trace: Trace): number => {
    if (trace.attachments && trace.attachments.length > 0) {
      return trace.attachments.length;
    }
    const metadata = trace.metadata as { files?: { name: string; type: string }[] } | null;
    return metadata?.files?.length || 0;
  };

  // 点击查看详情时加载完整数据（包括 input, output, attachments）
  const handleSelectTrace = async (traceItem: TraceListItem) => {
    setSelectedTrace(null);
    setAttachmentsLoading(true);
    try {
      const fullTrace = await tracesApi.getById(traceItem.id);
      setSelectedTrace(fullTrace);
    } catch (e) {
      console.error('Failed to load trace details:', e);
      showToast('error', t('loadFailed'));
    } finally {
      setAttachmentsLoading(false);
    }
  };

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
      { label: tPrompts('temperature'), value: candidate.temperature },
      { label: tPrompts('topP'), value: candidate.top_p ?? candidate.topP },
      { label: tPrompts('maxTokens'), value: candidate.max_tokens ?? candidate.maxTokens },
      { label: tPrompts('frequencyPenalty'), value: candidate.frequency_penalty ?? candidate.frequencyPenalty },
      { label: tPrompts('presencePenalty'), value: candidate.presence_penalty ?? candidate.presencePenalty },
    ].filter((item) => item.value !== undefined && item.value !== null);
  }, [selectedTrace, tPrompts]);

  const displayInput = useMemo(() => {
    if (!selectedTrace) return '';
    if (!selectedTraceOcr.hasOcr || selectedTraceOcr.attachments.length === 0) {
      return selectedTrace.input;
    }
    const fileNames = selectedTraceOcr.attachments.map((attachment) => attachment.name).filter(Boolean);
    return stripOcrFileBlocks(selectedTrace.input, fileNames);
  }, [selectedTrace, selectedTraceOcr]);

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
        return { id: `${selectedTrace.id}_ctx_${idx}`, role, content };
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
      content: selectedTrace.output || '',
      thinking: selectedTrace.thinkingContent || undefined,
    });

    return messages;
  }, [selectedTrace, selectedTraceOcr]);

  // Group traces by prompt and calculate stats
  const promptStatsList = useMemo(() => {
    const statsMap = new Map<string | null, PromptStats>();

    // Initialize with "all" option
    statsMap.set('__all__', {
      promptId: '__all__',
      promptName: t('all'),
      count: traces.length,
      totalTokens: traces.reduce((acc, t) => acc + t.tokensInput + t.tokensOutput, 0),
      avgLatency: traces.length
        ? Math.round(traces.reduce((acc, t) => acc + t.latencyMs, 0) / traces.length)
        : 0,
      errorCount: traces.filter((t) => t.status === 'error').length,
    });

    // Group by prompt
    for (const trace of traces) {
      const key = trace.promptId;
      if (!statsMap.has(key)) {
        statsMap.set(key, {
          promptId: key,
          promptName: getPromptName(key),
          count: 0,
          totalTokens: 0,
          avgLatency: 0,
          errorCount: 0,
        });
      }
      const stats = statsMap.get(key)!;
      stats.count++;
      stats.totalTokens += trace.tokensInput + trace.tokensOutput;
      if (trace.status === 'error') stats.errorCount++;
    }

    // Calculate average latency for each prompt
    for (const [key, stats] of statsMap.entries()) {
      if (key === '__all__') continue;
      const promptTraces = traces.filter((t) => t.promptId === key);
      stats.avgLatency = promptTraces.length
        ? Math.round(promptTraces.reduce((acc, t) => acc + t.latencyMs, 0) / promptTraces.length)
        : 0;
    }

    // Convert to array and sort by count (descending)
    const list = Array.from(statsMap.values());
    const allStats = list.find((s) => s.promptId === '__all__')!;
    const otherStats = list
      .filter((s) => s.promptId !== '__all__')
      .sort((a, b) => b.count - a.count);

    return [allStats, ...otherStats];
  }, [traces, getPromptName, t]);

  // Filter prompts by search query
  const filteredPromptStats = useMemo(() => {
    if (!searchQuery) return promptStatsList;
    const query = searchQuery.toLowerCase();
    return promptStatsList.filter(
      (s) => s.promptId === '__all__' || s.promptName.toLowerCase().includes(query)
    );
  }, [promptStatsList, searchQuery]);

  // Filter traces by selected prompt and status
  const filteredTraces = useMemo(() => {
    let result = traces;

    // Filter by prompt
    if (selectedPromptId && selectedPromptId !== '__all__') {
      result = result.filter((t) => t.promptId === selectedPromptId);
    }

    // Filter by status
    if (filterStatus !== 'all') {
      result = result.filter((t) => t.status === filterStatus);
    }

    return result;
  }, [traces, selectedPromptId, filterStatus]);

  // Get current stats based on selection
  const currentStats = useMemo(() => {
    if (!selectedPromptId || selectedPromptId === '__all__') {
      return promptStatsList.find((s) => s.promptId === '__all__')!;
    }
    return promptStatsList.find((s) => s.promptId === selectedPromptId) || {
      promptId: selectedPromptId,
      promptName: getPromptName(selectedPromptId),
      count: 0,
      totalTokens: 0,
      avgLatency: 0,
      errorCount: 0,
    };
  }, [selectedPromptId, promptStatsList, getPromptName]);

  const errorRate = currentStats.count
    ? ((currentStats.errorCount / currentStats.count) * 100).toFixed(1)
    : '0';

  return (
    <div className="h-full flex overflow-hidden bg-slate-950 light:bg-slate-50">
      {/* Left sidebar - Prompt list */}
      <div className="w-64 flex-shrink-0 border-r border-slate-700 light:border-slate-200 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-700 light:border-slate-200">
          <h3 className="text-sm font-medium text-slate-300 light:text-slate-700 mb-3">{t("filterByPrompt")}</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="pl-9"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredPromptStats.map((stats) => (
            <button
              key={stats.promptId || 'null'}
              onClick={() => setSelectedPromptId(stats.promptId === '__all__' ? null : stats.promptId)}
              className={`w-full px-4 py-3 text-left border-b border-slate-800 light:border-slate-100 transition-colors ${
                (selectedPromptId === stats.promptId) ||
                (selectedPromptId === null && stats.promptId === '__all__')
                  ? 'bg-cyan-500/10 border-l-2 border-l-cyan-500'
                  : 'hover:bg-slate-800/50 light:hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {stats.promptId === '__all__' ? (
                    <History className="w-4 h-4 flex-shrink-0 text-slate-400" />
                  ) : (
                    <FileText className={`w-4 h-4 flex-shrink-0 ${
                      stats.promptId === null
                        ? 'text-amber-400'
                        : 'text-cyan-400'
                    }`} />
                  )}
                  <span className="text-sm text-slate-200 light:text-slate-800 truncate">
                    {stats.promptName}
                  </span>
                </div>
                <Badge variant="info">
                  {stats.count}
                </Badge>
              </div>
              {stats.promptId !== '__all__' && (
                <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500">
                  <span>{stats.totalTokens.toLocaleString()} tokens</span>
                  <span>{stats.avgLatency}ms</span>
                  {stats.errorCount > 0 && (
                    <span className="text-rose-400">{stats.errorCount} {t('errors')}</span>
                  )}
                </div>
              )}
            </button>
          ))}
          {filteredPromptStats.length === 1 && filteredPromptStats[0].promptId === '__all__' && (
            <div className="p-4 text-center text-sm text-slate-500">
              {t('noRecords')}
            </div>
          )}
        </div>
      </div>

      {/* Right content - Stats and traces */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 p-6 border-b border-slate-700 light:border-slate-200">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-white light:text-slate-900">{t("title")}</h2>
              {selectedPromptId && selectedPromptId !== '__all__' && (
                <p className="text-sm text-slate-400 light:text-slate-600 mt-1">
                  {currentStats.promptName}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {selectedPromptId && selectedPromptId !== '__all__' && currentStats.count > 0 && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{tCommon("delete")}</span>
                </Button>
              )}
              <Select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                options={[
                  { value: 'all', label: t('allStatus') },
                  { value: 'success', label: t('success') },
                  { value: 'error', label: t('failed') },
                ]}
              />
              <Button variant="secondary" onClick={loadData} loading={loading}>
                <RefreshCw className="w-4 h-4" />
                <span>{tCommon("refresh")}</span>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-2">
                <Activity className="w-4 h-4" />
                <span className="text-xs">{t("allRecords")}</span>
              </div>
              <p className="text-2xl font-bold text-white light:text-slate-900">{currentStats.count}</p>
            </div>
            <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-2">
                <Coins className="w-4 h-4" />
                <span className="text-xs">{t("tokens")}</span>
              </div>
              <p className="text-2xl font-bold text-white light:text-slate-900">{currentStats.totalTokens.toLocaleString()}</p>
            </div>
            <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-2">
                <Clock className="w-4 h-4" />
                <span className="text-xs">{t("latency")}</span>
              </div>
              <p className="text-2xl font-bold text-white light:text-slate-900">{currentStats.avgLatency}ms</p>
            </div>
            <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-2">
                <AlertCircle className="w-4 h-4" />
                <span className="text-xs">{tCommon("error")}</span>
              </div>
              <p className="text-2xl font-bold text-white light:text-slate-900">{errorRate}%</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-slate-900 light:bg-slate-100 border-b border-slate-700 light:border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 light:text-slate-600 uppercase tracking-wider">{t("status")}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 light:text-slate-600 uppercase tracking-wider">{t("timestamp")}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 light:text-slate-600 uppercase tracking-wider">{t("model")}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 light:text-slate-600 uppercase tracking-wider">
                    Tokens
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 light:text-slate-600 uppercase tracking-wider">{t("latency")}</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 light:divide-slate-200">
                {filteredTraces.map((trace) => (
                  <tr
                    key={trace.id}
                    className="hover:bg-slate-800/30 light:hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => handleSelectTrace(trace)}
                  >
                    <td className="px-6 py-4">
                      {trace.status === 'success' ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      ) : (
                        <XCircle className="w-5 h-5 text-rose-500" />
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400 light:text-slate-600">
                      {formatDate(trace.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300 light:text-slate-800">
                      {getModelName(trace.modelId)}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      <span className="text-cyan-400 light:text-cyan-600">{trace.tokensInput}</span>
                      <span className="mx-1 light:text-slate-400">/</span>
                      <span className="text-teal-400 light:text-teal-600">{trace.tokensOutput}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400 light:text-slate-600">
                      {trace.latencyMs}ms
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => handleDeleteSingleTrace(trace.id, e)}
                          className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                          title={t("deleteThisRecord")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-slate-600 light:text-slate-400" />
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredTraces.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500 light:text-slate-600">
                      <Eye className="w-12 h-12 mx-auto mb-3 text-slate-700 light:text-slate-400" />
                      <p>{t("noRecords")}</p>
                      <p className="text-xs mt-1"></p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal
        isOpen={!!selectedTrace}
        onClose={() => setSelectedTrace(null)}
        title={t("traceDetail")}
        size="wide"
      >
        {selectedTrace && (
          <div className="h-[72vh] overflow-hidden">
            <div className="h-full grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="h-full overflow-y-auto space-y-4 pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t("status")}</p>
                  <Badge variant={selectedTrace.status === 'success' ? 'success' : 'error'}>
                    {selectedTrace.status === 'success' ? t('success') : t('failed')}
                  </Badge>
                </div>
                <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t("latency")}</p>
                  <p className="text-sm font-medium text-slate-200 light:text-slate-800">{selectedTrace.latencyMs}ms</p>
                </div>
                <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t("input")} Tokens</p>
                  <p className="text-sm font-medium text-cyan-400 light:text-cyan-600">{selectedTrace.tokensInput}</p>
                </div>
                <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t("output")} Tokens</p>
                  <p className="text-sm font-medium text-teal-400 light:text-teal-600">{selectedTrace.tokensOutput}</p>
                </div>
              </div>

              <div className="p-3 bg-slate-800/40 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t("prompt")}</p>
                <p className="text-sm text-slate-200 light:text-slate-800">{getPromptName(selectedTrace.promptId)}</p>
              </div>

              <div className="p-3 bg-slate-800/40 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t("model")}</p>
                <p className="text-sm text-slate-200 light:text-slate-800">{getModelName(selectedTrace.modelId)}</p>
              </div>

              <div className="p-3 bg-slate-800/40 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{tPrompts("modelParameters")}</p>
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
                  <h4 className="text-sm font-medium text-rose-400 light:text-rose-600 mb-2">{tCommon("error")}</h4>
                  <div className="p-4 bg-rose-500/10 light:bg-rose-50 border border-rose-500/30 light:border-rose-200 rounded-lg">
                    <pre className="text-sm text-rose-300 light:text-rose-700 whitespace-pre-wrap font-mono">
                      {selectedTrace.errorMessage}
                    </pre>
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-slate-700 light:border-slate-200">
                <p className="text-xs text-slate-500 light:text-slate-600">
                  {t('createdAt')}: {formatDate(selectedTrace.createdAt)}
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
                      content: selectedTrace.output || '',
                      thinking: selectedTrace.thinkingContent || undefined,
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

      {/* Delete confirmation modal */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title={t("confirmDelete")}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300 light:text-slate-700">
            {t('confirmDeletePromptHistory', { name: currentStats.promptName })}
          </p>
          <p className="text-sm text-slate-500 light:text-slate-600">
            {t('recordsWillBeDeleted', { count: currentStats.count })}
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
              {tCommon('cancel')}
            </Button>
            <Button variant="danger" onClick={handleDeleteTraces} loading={deleting}>
              <Trash2 className="w-4 h-4" />
              {t('confirmDeleteBtn')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Attachment preview modal */}
      <AttachmentModal
        attachment={previewAttachment}
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
