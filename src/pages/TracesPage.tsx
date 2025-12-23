import { useState, useEffect, useMemo } from 'react';
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
  Copy,
  Check,
  Maximize2,
  Paperclip,
  Loader2,
} from 'lucide-react';
import { Button, Badge, Select, Modal, Input, useToast, MarkdownRenderer } from '../components/ui';
import { getDatabase, isDatabaseConfigured } from '../lib/database';
import type { Trace, Prompt, Model } from '../types';
import type { FileAttachment } from '../lib/ai-service';
import { AttachmentList } from '../components/Prompt/AttachmentPreview';
import { AttachmentModal } from '../components/Prompt/AttachmentModal';

interface PromptStats {
  promptId: string | null;
  promptName: string;
  count: number;
  totalTokens: number;
  avgLatency: number;
  errorCount: number;
}

export function TracesPage() {
  const { showToast } = useToast();
  const [traces, setTraces] = useState<Trace[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedField, setCopiedField] = useState<'input' | 'output' | null>(null);
  const [expandedField, setExpandedField] = useState<'input' | 'output' | null>(null);
  const [expandedContent, setExpandedContent] = useState('');
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachment | null>(null);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    // 检查数据库是否已配置
    if (!isDatabaseConfigured()) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // 查询列表时不加载 attachments 字段，避免内存问题
      const [tracesRes, promptsRes, modelsRes] = await Promise.all([
        getDatabase().from('traces').select('id,user_id,prompt_id,model_id,input,output,tokens_input,tokens_output,latency_ms,status,error_message,metadata,created_at').order('created_at', { ascending: false }).limit(500),
        getDatabase().from('prompts').select('*'),
        getDatabase().from('models').select('*'),
      ]);

      if (tracesRes.data) setTraces(tracesRes.data);
      if (promptsRes.data) setPrompts(promptsRes.data);
      if (modelsRes.data) setModels(modelsRes.data);
    } catch {
      showToast('error', '请先在设置中配置数据库连接');
    }
    setLoading(false);
  };

  const handleDeleteTraces = async () => {
    if (!selectedPromptId) return;

    setDeleting(true);
    try {
      // Delete traces for selected prompt (or unlinked traces if promptId is null)
      const query = getDatabase().from('traces').delete();

      if (selectedPromptId === null) {
        // Delete traces with null prompt_id
        await query.is('prompt_id', null);
      } else {
        await query.eq('prompt_id', selectedPromptId);
      }

      showToast('success', '历史记录已删除');
      setShowDeleteConfirm(false);
      setSelectedPromptId(null);
      await loadData();
    } catch {
      showToast('error', '删除失败');
    }
    setDeleting(false);
  };

  const handleDeleteSingleTrace = async (traceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { error } = await getDatabase().from('traces').delete().eq('id', traceId);
      if (error) {
        showToast('error', '删除失败');
        return;
      }
      setTraces((prev) => prev.filter((t) => t.id !== traceId));
      if (selectedTrace?.id === traceId) {
        setSelectedTrace(null);
      }
      showToast('success', '记录已删除');
    } catch {
      showToast('error', '删除失败');
    }
  };

  const getPromptName = (id: string | null) => prompts.find((p) => p.id === id)?.name || '未关联';
  const getModelName = (id: string | null) => models.find((m) => m.id === id)?.name || '-';

  const handleCopy = async (text: string, field: 'input' | 'output') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      showToast('error', '复制失败');
    }
  };

  const handleExpand = (content: string, field: 'input' | 'output') => {
    setExpandedContent(content);
    setExpandedField(field);
  };

  // 检查 trace 是否有附件（通过 metadata.files 判断）
  const hasAttachments = (trace: Trace): boolean => {
    const metadata = trace.metadata as { files?: { name: string; type: string }[] } | null;
    return !!(metadata?.files && metadata.files.length > 0);
  };

  // 获取附件数量
  const getAttachmentCount = (trace: Trace): number => {
    const metadata = trace.metadata as { files?: { name: string; type: string }[] } | null;
    return metadata?.files?.length || 0;
  };

  // 点击查看详情时加载完整数据（包括 attachments）
  const handleSelectTrace = async (trace: Trace) => {
    // 先显示基本信息
    setSelectedTrace(trace);
    setAttachmentsLoading(false);

    // 检查是否有附件，如果有则异步加载
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

  // Group traces by prompt and calculate stats
  const promptStatsList = useMemo(() => {
    const statsMap = new Map<string | null, PromptStats>();

    // Initialize with "all" option
    statsMap.set('__all__', {
      promptId: '__all__',
      promptName: '全部',
      count: traces.length,
      totalTokens: traces.reduce((acc, t) => acc + t.tokens_input + t.tokens_output, 0),
      avgLatency: traces.length
        ? Math.round(traces.reduce((acc, t) => acc + t.latency_ms, 0) / traces.length)
        : 0,
      errorCount: traces.filter((t) => t.status === 'error').length,
    });

    // Group by prompt
    for (const trace of traces) {
      const key = trace.prompt_id;
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
      stats.totalTokens += trace.tokens_input + trace.tokens_output;
      if (trace.status === 'error') stats.errorCount++;
    }

    // Calculate average latency for each prompt
    for (const [key, stats] of statsMap.entries()) {
      if (key === '__all__') continue;
      const promptTraces = traces.filter((t) => t.prompt_id === key);
      stats.avgLatency = promptTraces.length
        ? Math.round(promptTraces.reduce((acc, t) => acc + t.latency_ms, 0) / promptTraces.length)
        : 0;
    }

    // Convert to array and sort by count (descending)
    const list = Array.from(statsMap.values());
    const allStats = list.find((s) => s.promptId === '__all__')!;
    const otherStats = list
      .filter((s) => s.promptId !== '__all__')
      .sort((a, b) => b.count - a.count);

    return [allStats, ...otherStats];
  }, [traces, prompts]);

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
      result = result.filter((t) => t.prompt_id === selectedPromptId);
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
  }, [selectedPromptId, promptStatsList]);

  const errorRate = currentStats.count
    ? ((currentStats.errorCount / currentStats.count) * 100).toFixed(1)
    : '0';

  return (
    <div className="h-full flex overflow-hidden bg-slate-950 light:bg-slate-50">
      {/* Left sidebar - Prompt list */}
      <div className="w-64 flex-shrink-0 border-r border-slate-700 light:border-slate-200 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-700 light:border-slate-200">
          <h3 className="text-sm font-medium text-slate-300 light:text-slate-700 mb-3">按 Prompt 筛选</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 Prompt..."
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
                <Badge variant="secondary" className="flex-shrink-0 ml-2">
                  {stats.count}
                </Badge>
              </div>
              {stats.promptId !== '__all__' && (
                <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500">
                  <span>{stats.totalTokens.toLocaleString()} tokens</span>
                  <span>{stats.avgLatency}ms</span>
                  {stats.errorCount > 0 && (
                    <span className="text-rose-400">{stats.errorCount} 错误</span>
                  )}
                </div>
              )}
            </button>
          ))}
          {filteredPromptStats.length === 1 && filteredPromptStats[0].promptId === '__all__' && (
            <div className="p-4 text-center text-sm text-slate-500">
              暂无历史记录
            </div>
          )}
        </div>
      </div>

      {/* Right content - Stats and traces */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 p-6 border-b border-slate-700 light:border-slate-200">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-white light:text-slate-900">历史记录</h2>
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
                  <span>删除全部</span>
                </Button>
              )}
              <Select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                options={[
                  { value: 'all', label: '全部状态' },
                  { value: 'success', label: '成功' },
                  { value: 'error', label: '失败' },
                ]}
              />
              <Button variant="secondary" onClick={loadData} loading={loading}>
                <RefreshCw className="w-4 h-4" />
                <span>刷新</span>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-2">
                <Activity className="w-4 h-4" />
                <span className="text-xs">请求数</span>
              </div>
              <p className="text-2xl font-bold text-white light:text-slate-900">{currentStats.count}</p>
            </div>
            <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-2">
                <Coins className="w-4 h-4" />
                <span className="text-xs">Token 消耗</span>
              </div>
              <p className="text-2xl font-bold text-white light:text-slate-900">{currentStats.totalTokens.toLocaleString()}</p>
            </div>
            <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-2">
                <Clock className="w-4 h-4" />
                <span className="text-xs">平均延迟</span>
              </div>
              <p className="text-2xl font-bold text-white light:text-slate-900">{currentStats.avgLatency}ms</p>
            </div>
            <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-2">
                <AlertCircle className="w-4 h-4" />
                <span className="text-xs">错误率</span>
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 light:text-slate-600 uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 light:text-slate-600 uppercase tracking-wider">
                    时间
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 light:text-slate-600 uppercase tracking-wider">
                    模型
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 light:text-slate-600 uppercase tracking-wider">
                    Tokens
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 light:text-slate-600 uppercase tracking-wider">
                    延迟
                  </th>
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
                      {new Date(trace.created_at).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300 light:text-slate-800">
                      {getModelName(trace.model_id)}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      <span className="text-cyan-400 light:text-cyan-600">{trace.tokens_input}</span>
                      <span className="mx-1 light:text-slate-400">/</span>
                      <span className="text-teal-400 light:text-teal-600">{trace.tokens_output}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400 light:text-slate-600">
                      {trace.latency_ms}ms
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => handleDeleteSingleTrace(trace.id, e)}
                          className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                          title="删除此记录"
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
                      <p>暂无历史记录</p>
                      <p className="text-xs mt-1">运行 Prompt 测试后将在此显示记录</p>
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
        title="Trace 详情"
        size="lg"
      >
        {selectedTrace && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">状态</p>
                <Badge variant={selectedTrace.status === 'success' ? 'success' : 'error'}>
                  {selectedTrace.status === 'success' ? '成功' : '失败'}
                </Badge>
              </div>
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">延迟</p>
                <p className="text-sm font-medium text-slate-200 light:text-slate-800">{selectedTrace.latency_ms}ms</p>
              </div>
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">输入 Tokens</p>
                <p className="text-sm font-medium text-cyan-400 light:text-cyan-600">{selectedTrace.tokens_input}</p>
              </div>
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">输出 Tokens</p>
                <p className="text-sm font-medium text-teal-400 light:text-teal-600">{selectedTrace.tokens_output}</p>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-slate-300 light:text-slate-700 mb-2">Prompt</h4>
              <p className="text-sm text-slate-400 light:text-slate-600">
                {getPromptName(selectedTrace.prompt_id)}
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-slate-300 light:text-slate-700">输入</h4>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleExpand(selectedTrace.input, 'input')}
                    className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors"
                    title="放大查看"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleCopy(selectedTrace.input, 'input')}
                    className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors"
                    title="复制"
                  >
                    {copiedField === 'input' ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg max-h-40 overflow-y-auto">
                <MarkdownRenderer content={selectedTrace.input} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-slate-300 light:text-slate-700">输出</h4>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleExpand(selectedTrace.output || '', 'output')}
                    className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors"
                    title="放大查看"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleCopy(selectedTrace.output || '', 'output')}
                    className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors"
                    title="复制"
                  >
                    {copiedField === 'output' ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg max-h-40 overflow-y-auto">
                {selectedTrace.output ? (
                  <MarkdownRenderer content={selectedTrace.output} />
                ) : (
                  <span className="text-sm text-slate-500 light:text-slate-400">(空)</span>
                )}
              </div>
            </div>

            {hasAttachments(selectedTrace) && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Paperclip className="w-4 h-4 text-slate-400" />
                  <h4 className="text-sm font-medium text-slate-300 light:text-slate-700">
                    附件 ({getAttachmentCount(selectedTrace)})
                  </h4>
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg min-h-[60px]">
                  {attachmentsLoading ? (
                    <div className="flex items-center gap-2 text-slate-400 light:text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">正在加载附件...</span>
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
                      <span className="text-sm">附件加载失败</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {selectedTrace.error_message && (
              <div>
                <h4 className="text-sm font-medium text-rose-400 light:text-rose-600 mb-2">错误信息</h4>
                <div className="p-4 bg-rose-500/10 light:bg-rose-50 border border-rose-500/30 light:border-rose-200 rounded-lg">
                  <pre className="text-sm text-rose-300 light:text-rose-700 whitespace-pre-wrap font-mono">
                    {selectedTrace.error_message}
                  </pre>
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-slate-700 light:border-slate-200">
              <p className="text-xs text-slate-500 light:text-slate-600">
                创建时间: {new Date(selectedTrace.created_at).toLocaleString('zh-CN')}
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="确认删除"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300 light:text-slate-700">
            确定要删除 <span className="font-medium text-white light:text-slate-900">{currentStats.promptName}</span> 的所有历史记录吗？
          </p>
          <p className="text-sm text-slate-500 light:text-slate-600">
            共 {currentStats.count} 条记录将被永久删除，此操作不可恢复。
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
              取消
            </Button>
            <Button variant="danger" onClick={handleDeleteTraces} loading={deleting}>
              <Trash2 className="w-4 h-4" />
              确认删除
            </Button>
          </div>
        </div>
      </Modal>

      {/* Expanded content modal */}
      <Modal
        isOpen={!!expandedField}
        onClose={() => {
          setExpandedField(null);
          setExpandedContent('');
        }}
        title={expandedField === 'input' ? '输入内容' : '输出内容'}
        size="xl"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <button
              onClick={() => handleCopy(expandedContent, expandedField!)}
              className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-700 light:bg-slate-200 text-slate-300 light:text-slate-700 hover:bg-slate-600 light:hover:bg-slate-300 transition-colors text-sm"
            >
              {copiedField === expandedField ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>已复制</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>复制</span>
                </>
              )}
            </button>
          </div>
          <div className="p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg max-h-[60vh] overflow-y-auto">
            {expandedContent ? (
              <MarkdownRenderer content={expandedContent} />
            ) : (
              <span className="text-sm text-slate-500 light:text-slate-400">(空)</span>
            )}
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
