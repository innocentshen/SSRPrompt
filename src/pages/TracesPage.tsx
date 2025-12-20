import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Button, Badge, Select, Modal, useToast } from '../components/ui';
import { getDatabase } from '../lib/database';
import type { Trace, Prompt, Model } from '../types';

export function TracesPage() {
  const { showToast } = useToast();
  const [traces, setTraces] = useState<Trace[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tracesRes, promptsRes, modelsRes] = await Promise.all([
        getDatabase().from('traces').select('*').order('created_at', { ascending: false }).limit(100),
        getDatabase().from('prompts').select('*'),
        getDatabase().from('models').select('*'),
      ]);

      if (tracesRes.data) setTraces(tracesRes.data);
      if (promptsRes.data) setPrompts(promptsRes.data);
      if (modelsRes.data) setModels(modelsRes.data);
    } catch {
      showToast('error', '加载数据失败');
    }
    setLoading(false);
  };

  const getPromptName = (id: string | null) => prompts.find((p) => p.id === id)?.name || '-';
  const getModelName = (id: string | null) => models.find((m) => m.id === id)?.name || '-';

  const filteredTraces = traces.filter((t) => {
    if (filterStatus === 'all') return true;
    return t.status === filterStatus;
  });

  const totalTokens = traces.reduce((acc, t) => acc + t.tokens_input + t.tokens_output, 0);
  const avgLatency = traces.length
    ? Math.round(traces.reduce((acc, t) => acc + t.latency_ms, 0) / traces.length)
    : 0;
  const errorRate = traces.length
    ? ((traces.filter((t) => t.status === 'error').length / traces.length) * 100).toFixed(1)
    : '0';

  return (
    <div className="h-full flex flex-col bg-slate-950 light:bg-slate-50">
      <div className="p-6 border-b border-slate-700 light:border-slate-200">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white light:text-slate-900">观测中心</h2>
          <div className="flex items-center gap-3">
            <Select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'success', label: '成功' },
                { value: 'error', label: '失败' },
              ]}
            />
            <Button variant="secondary" onClick={loadData}>
              <RefreshCw className="w-4 h-4" />
              <span>刷新</span>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-2">
              <Activity className="w-4 h-4" />
              <span className="text-xs">总请求数</span>
            </div>
            <p className="text-2xl font-bold text-white light:text-slate-900">{traces.length}</p>
          </div>
          <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-2">
              <Coins className="w-4 h-4" />
              <span className="text-xs">总 Token 消耗</span>
            </div>
            <p className="text-2xl font-bold text-white light:text-slate-900">{totalTokens.toLocaleString()}</p>
          </div>
          <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 mb-2">
              <Clock className="w-4 h-4" />
              <span className="text-xs">平均延迟</span>
            </div>
            <p className="text-2xl font-bold text-white light:text-slate-900">{avgLatency}ms</p>
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
                  Prompt
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
                  onClick={() => setSelectedTrace(trace)}
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
                    {getPromptName(trace.prompt_id)}
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
                    <ChevronRight className="w-4 h-4 text-slate-600 light:text-slate-400" />
                  </td>
                </tr>
              ))}
              {filteredTraces.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500 light:text-slate-600">
                    <Eye className="w-12 h-12 mx-auto mb-3 text-slate-700 light:text-slate-400" />
                    <p>暂无追踪数据</p>
                    <p className="text-xs mt-1">运行 Prompt 测试后将在此显示记录</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
              <div className="p-3 bg-slate-800/50 border border-slate-700 rounded-lg">
                <p className="text-xs text-slate-500 mb-1">状态</p>
                <Badge variant={selectedTrace.status === 'success' ? 'success' : 'error'}>
                  {selectedTrace.status === 'success' ? '成功' : '失败'}
                </Badge>
              </div>
              <div className="p-3 bg-slate-800/50 border border-slate-700 rounded-lg">
                <p className="text-xs text-slate-500 mb-1">延迟</p>
                <p className="text-sm font-medium text-slate-200">{selectedTrace.latency_ms}ms</p>
              </div>
              <div className="p-3 bg-slate-800/50 border border-slate-700 rounded-lg">
                <p className="text-xs text-slate-500 mb-1">输入 Tokens</p>
                <p className="text-sm font-medium text-cyan-400">{selectedTrace.tokens_input}</p>
              </div>
              <div className="p-3 bg-slate-800/50 border border-slate-700 rounded-lg">
                <p className="text-xs text-slate-500 mb-1">输出 Tokens</p>
                <p className="text-sm font-medium text-teal-400">{selectedTrace.tokens_output}</p>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-slate-300 mb-2">输入</h4>
              <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-lg max-h-40 overflow-y-auto">
                <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono">
                  {selectedTrace.input}
                </pre>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-slate-300 mb-2">输出</h4>
              <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-lg max-h-40 overflow-y-auto">
                <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono">
                  {selectedTrace.output || '(空)'}
                </pre>
              </div>
            </div>

            {selectedTrace.error_message && (
              <div>
                <h4 className="text-sm font-medium text-rose-400 mb-2">错误信息</h4>
                <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg">
                  <pre className="text-sm text-rose-300 whitespace-pre-wrap font-mono">
                    {selectedTrace.error_message}
                  </pre>
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-slate-700">
              <p className="text-xs text-slate-500">
                创建时间: {new Date(selectedTrace.created_at).toLocaleString('zh-CN')}
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
