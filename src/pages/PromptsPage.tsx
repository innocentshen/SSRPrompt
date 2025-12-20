import { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Search,
  Play,
  Save,
  History,
  Wand2,
  FileText,
  Clock,
  Loader2,
  Paperclip,
  X,
  Image,
  File,
  Trash2,
  GripVertical,
  GitCompare,
  Cpu,
} from 'lucide-react';
import { Button, Input, Modal, Badge, Select, useToast, MarkdownRenderer } from '../components/ui';
import { getDatabase } from '../lib/database';
import { callAIModel, fileToBase64, type FileAttachment } from '../lib/ai-service';
import type { Prompt, Model, Provider, PromptVersion } from '../types';

export function PromptsPage() {
  const { showToast } = useToast();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [showNewPrompt, setShowNewPrompt] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [compareMode, setCompareMode] = useState<'models' | 'versions'>('models');
  const [compareVersion, setCompareVersion] = useState('');
  const [compareModels, setCompareModels] = useState<[string, string]>(['', '']);
  const [compareModel, setCompareModel] = useState('');
  const [compareVersions, setCompareVersions] = useState<[string, string]>(['', '']);
  const [compareInput, setCompareInput] = useState('');
  const [compareFiles, setCompareFiles] = useState<FileAttachment[]>([]);
  const [compareRunning, setCompareRunning] = useState(false);
  const [compareResults, setCompareResults] = useState<{
    left: { content: string; latency: number; tokensIn: number; tokensOut: number; error?: string } | null;
    right: { content: string; latency: number; tokensIn: number; tokensOut: number; error?: string } | null;
  }>({ left: null, right: null });
  const [searchQuery, setSearchQuery] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [promptName, setPromptName] = useState('');
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newPromptName, setNewPromptName] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [renderMarkdown, setRenderMarkdown] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const compareFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedPrompt) {
      setPromptContent(selectedPrompt.content);
      setPromptName(selectedPrompt.name);
      if (selectedPrompt.default_model_id) {
        setSelectedModel(selectedPrompt.default_model_id);
      }
      loadVersions(selectedPrompt.id);
    }
  }, [selectedPrompt]);

  const loadData = async () => {
    const [promptsRes, providersRes, modelsRes] = await Promise.all([
      getDatabase().from('prompts').select('*').order('order_index').order('updated_at', { ascending: false }),
      getDatabase().from('providers').select('*').eq('enabled', true),
      getDatabase().from('models').select('*'),
    ]);

    if (promptsRes.data) {
      setPrompts(promptsRes.data);
      if (promptsRes.data.length > 0) {
        setSelectedPrompt(promptsRes.data[0]);
      }
    }
    if (providersRes.data) setProviders(providersRes.data);
    if (modelsRes.data) {
      setModels(modelsRes.data);
      if (modelsRes.data.length > 0) setSelectedModel(modelsRes.data[0].id);
    }
  };

  const loadVersions = async (promptId: string) => {
    const { data } = await getDatabase()
      .from('prompt_versions')
      .select('*')
      .eq('prompt_id', promptId)
      .order('version', { ascending: false });
    if (data) setVersions(data);
  };

  const handleCreatePrompt = async () => {
    if (!newPromptName.trim()) return;
    try {
      const maxOrder = prompts.reduce((max, p) => Math.max(max, p.order_index || 0), 0);
      const { data, error } = await getDatabase()
        .from('prompts')
        .insert({
          name: newPromptName.trim(),
          description: '',
          content: '',
          variables: [],
          current_version: 1,
          order_index: maxOrder + 1,
        })
        .select()
        .single();

      if (error) {
        showToast('error', '创建失败: ' + error.message);
        return;
      }

      if (data) {
        setPrompts((prev) => [data, ...prev]);
        setSelectedPrompt(data);
        setNewPromptName('');
        setShowNewPrompt(false);
        showToast('success', 'Prompt 已创建');
      }
    } catch {
      showToast('error', '创建 Prompt 失败');
    }
  };

  const handleSave = async () => {
    if (!selectedPrompt) return;
    setSaving(true);
    try {
      const newVersion = selectedPrompt.current_version + 1;

      await getDatabase().from('prompt_versions').insert({
        prompt_id: selectedPrompt.id,
        version: newVersion,
        content: promptContent,
        commit_message: `Version ${newVersion}`,
      });

      const { error } = await getDatabase()
        .from('prompts')
        .update({
          name: promptName,
          content: promptContent,
          current_version: newVersion,
          default_model_id: selectedModel || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedPrompt.id);

      if (error) {
        showToast('error', '保存失败: ' + error.message);
        return;
      }

      const updated = {
        ...selectedPrompt,
        name: promptName,
        content: promptContent,
        current_version: newVersion,
        default_model_id: selectedModel || null,
        updated_at: new Date().toISOString(),
      };
      setSelectedPrompt(updated);
      setPrompts((prev) =>
        prev.map((p) => (p.id === selectedPrompt.id ? updated : p))
      );
      loadVersions(selectedPrompt.id);
      showToast('success', '已保存为 v' + newVersion);
    } catch {
      showToast('error', '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    if (!promptContent) {
      showToast('error', '请先编写 Prompt 内容');
      return;
    }

    const model = models.find((m) => m.id === selectedModel);
    const provider = providers.find((p) => p.id === model?.provider_id);

    if (!model || !provider) {
      showToast('error', '请先在设置中配置并启用模型服务商');
      return;
    }

    setRunning(true);
    setTestOutput('');

    try {
      const result = await callAIModel(
        provider,
        model.name,
        promptContent,
        testInput,
        attachedFiles.length > 0 ? attachedFiles : undefined
      );

      const outputText = `${result.content}\n\n---\n**处理时间:** ${(result.latencyMs / 1000).toFixed(2)}s\n**令牌使用:** ${result.tokensInput} 输入 / ${result.tokensOutput} 输出 (共 ${result.tokensInput + result.tokensOutput})`;
      setTestOutput(outputText);

      await getDatabase().from('traces').insert({
        prompt_id: selectedPrompt?.id,
        model_id: model.id,
        input: promptContent + (testInput ? `\n\n用户输入: ${testInput}` : ''),
        output: result.content,
        tokens_input: result.tokensInput,
        tokens_output: result.tokensOutput,
        latency_ms: result.latencyMs,
        status: 'success',
        metadata: {
          test_input: testInput,
          files: attachedFiles.map(f => ({ name: f.name, type: f.type })),
        },
      });

      showToast('success', '运行完成');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      setTestOutput(`**[错误]**\n\n${errorMessage}\n\n请检查:\n1. API Key 是否正确配置\n2. 模型名称是否正确\n3. Base URL 是否可访问\n4. 网络连接是否正常`);

      await getDatabase().from('traces').insert({
        prompt_id: selectedPrompt?.id,
        model_id: model.id,
        input: promptContent + (testInput ? `\n\n用户输入: ${testInput}` : ''),
        output: errorMessage,
        tokens_input: 0,
        tokens_output: 0,
        latency_ms: 0,
        status: 'error',
        metadata: { test_input: testInput, error: errorMessage },
      });

      showToast('error', '运行失败: ' + errorMessage);
    } finally {
      setRunning(false);
    }
  };

  const handleDeletePrompt = async () => {
    if (!selectedPrompt) return;
    try {
      const { error } = await getDatabase().from('prompts').delete().eq('id', selectedPrompt.id);
      if (error) {
        showToast('error', '删除失败: ' + error.message);
        return;
      }
      const remaining = prompts.filter((p) => p.id !== selectedPrompt.id);
      setPrompts(remaining);
      setSelectedPrompt(remaining[0] || null);
      showToast('success', 'Prompt 已删除');
    } catch {
      showToast('error', '删除失败');
    }
  };

  const handleRestoreVersion = async (version: PromptVersion) => {
    setPromptContent(version.content);
    setShowVersions(false);
    showToast('info', `已恢复到 v${version.version}`);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newPrompts = [...prompts];
    const draggedPrompt = newPrompts[draggedIndex];
    newPrompts.splice(draggedIndex, 1);
    newPrompts.splice(index, 0, draggedPrompt);

    setPrompts(newPrompts);
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null) return;

    const updates = prompts.map((p, i) => ({
      id: p.id,
      order_index: i,
    }));

    for (const update of updates) {
      await getDatabase()
        .from('prompts')
        .update({ order_index: update.order_index })
        .eq('id', update.id);
    }

    setDraggedIndex(null);
  };

  const filteredPrompts = prompts.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const enabledModels = models.filter((m) => {
    const provider = providers.find((p) => p.id === m.provider_id);
    return provider?.enabled;
  });

  const getModelName = (modelId: string | null) => {
    if (!modelId) return null;
    return models.find((m) => m.id === modelId)?.name;
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const maxSize = 20 * 1024 * 1024;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

    for (const file of Array.from(files)) {
      if (file.size > maxSize) {
        showToast('error', `${file.name} 超过 20MB 限制`);
        continue;
      }
      if (!allowedTypes.includes(file.type)) {
        showToast('error', `${file.name} 不支持的文件类型`);
        continue;
      }

      try {
        const attachment = await fileToBase64(file);
        setAttachedFiles((prev) => [...prev, attachment]);
      } catch {
        showToast('error', `${file.name} 读取失败`);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return Image;
    return File;
  };

  const handleRunComparison = async () => {
    if (compareMode === 'models') {
      if (!compareVersion || !compareModels[0] || !compareModels[1]) {
        showToast('error', '请选择版本和两个模型');
        return;
      }
    } else {
      if (!compareModel || !compareVersions[0] || !compareVersions[1]) {
        showToast('error', '请选择模型和两个版本');
        return;
      }
    }

    setCompareRunning(true);
    setCompareResults({ left: null, right: null });

    try {
      if (compareMode === 'models') {
        const version = versions.find((v) => v.id === compareVersion);
        if (!version) return;

        const model1 = models.find((m) => m.id === compareModels[0]);
        const model2 = models.find((m) => m.id === compareModels[1]);
        const provider1 = providers.find((p) => p.id === model1?.provider_id);
        const provider2 = providers.find((p) => p.id === model2?.provider_id);

        if (!model1 || !model2 || !provider1 || !provider2) {
          showToast('error', '模型或服务商配置错误');
          return;
        }

        const [result1, result2] = await Promise.allSettled([
          callAIModel(provider1, model1.name, version.content, compareInput, compareFiles.length > 0 ? compareFiles : undefined),
          callAIModel(provider2, model2.name, version.content, compareInput, compareFiles.length > 0 ? compareFiles : undefined),
        ]);

        setCompareResults({
          left: result1.status === 'fulfilled'
            ? { content: result1.value.content, latency: result1.value.latencyMs, tokensIn: result1.value.tokensInput, tokensOut: result1.value.tokensOutput }
            : { content: '', latency: 0, tokensIn: 0, tokensOut: 0, error: result1.reason?.message || '执行失败' },
          right: result2.status === 'fulfilled'
            ? { content: result2.value.content, latency: result2.value.latencyMs, tokensIn: result2.value.tokensInput, tokensOut: result2.value.tokensOutput }
            : { content: '', latency: 0, tokensIn: 0, tokensOut: 0, error: result2.reason?.message || '执行失败' },
        });
      } else {
        const model = models.find((m) => m.id === compareModel);
        const provider = providers.find((p) => p.id === model?.provider_id);

        if (!model || !provider) {
          showToast('error', '模型或服务商配置错误');
          return;
        }

        const version1 = versions.find((v) => v.id === compareVersions[0]);
        const version2 = versions.find((v) => v.id === compareVersions[1]);

        if (!version1 || !version2) return;

        const [result1, result2] = await Promise.allSettled([
          callAIModel(provider, model.name, version1.content, compareInput, compareFiles.length > 0 ? compareFiles : undefined),
          callAIModel(provider, model.name, version2.content, compareInput, compareFiles.length > 0 ? compareFiles : undefined),
        ]);

        setCompareResults({
          left: result1.status === 'fulfilled'
            ? { content: result1.value.content, latency: result1.value.latencyMs, tokensIn: result1.value.tokensInput, tokensOut: result1.value.tokensOutput }
            : { content: '', latency: 0, tokensIn: 0, tokensOut: 0, error: result1.reason?.message || '执行失败' },
          right: result2.status === 'fulfilled'
            ? { content: result2.value.content, latency: result2.value.latencyMs, tokensIn: result2.value.tokensInput, tokensOut: result2.value.tokensOutput }
            : { content: '', latency: 0, tokensIn: 0, tokensOut: 0, error: result2.reason?.message || '执行失败' },
        });
      }

      showToast('success', '比对完成');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      showToast('error', '比对失败: ' + errorMessage);
    } finally {
      setCompareRunning(false);
    }
  };

  const handleCompareFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const maxSize = 20 * 1024 * 1024;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

    for (const file of Array.from(files)) {
      if (file.size > maxSize) {
        showToast('error', `${file.name} 超过 20MB 限制`);
        continue;
      }
      if (!allowedTypes.includes(file.type)) {
        showToast('error', `${file.name} 不支持的文件类型`);
        continue;
      }

      try {
        const attachment = await fileToBase64(file);
        setCompareFiles((prev) => [...prev, attachment]);
      } catch {
        showToast('error', `${file.name} 读取失败`);
      }
    }
  };

  const removeCompareFile = (index: number) => {
    setCompareFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="h-full flex bg-slate-950 light:bg-slate-50">
      <div className="w-72 bg-slate-900/50 light:bg-white border-r border-slate-700 light:border-slate-200 flex flex-col">
        <div className="p-4 space-y-3 border-b border-slate-700 light:border-slate-200">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 light:text-slate-400" />
            <input
              type="text"
              placeholder="搜索 Prompt..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-300 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <Button className="w-full" onClick={() => setShowNewPrompt(true)}>
            <Plus className="w-4 h-4" />
            <span>新建 Prompt</span>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredPrompts.map((prompt, index) => {
            const modelName = getModelName(prompt.default_model_id);
            return (
              <div
                key={prompt.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onClick={() => setSelectedPrompt(prompt)}
                className={`w-full flex items-start gap-2 p-3 rounded-lg text-left transition-colors cursor-pointer ${
                  selectedPrompt?.id === prompt.id
                    ? 'bg-slate-800 light:bg-cyan-50 border border-slate-600 light:border-cyan-200'
                    : 'hover:bg-slate-800/50 light:hover:bg-slate-100 border border-transparent'
                } ${draggedIndex === index ? 'opacity-50' : ''}`}
              >
                <GripVertical className="w-4 h-4 text-slate-600 light:text-slate-400 mt-0.5 flex-shrink-0 cursor-grab active:cursor-grabbing" />
                <FileText className="w-5 h-5 text-slate-500 light:text-slate-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">
                    {prompt.name}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs text-slate-500 light:text-slate-600">v{prompt.current_version}</span>
                    <span className="text-xs text-slate-600 light:text-slate-400">|</span>
                    <span className="text-xs text-slate-500 light:text-slate-600 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatRelativeTime(prompt.updated_at)}
                    </span>
                  </div>
                  {modelName && (
                    <div className="flex items-center gap-1 mt-1.5">
                      <Cpu className="w-3 h-3 text-cyan-500 light:text-cyan-600" />
                      <span className="text-xs text-cyan-400 light:text-cyan-600 truncate">{modelName}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {selectedPrompt ? (
          <>
            <div className="h-14 px-6 flex items-center justify-between border-b border-slate-700 light:border-slate-200">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={promptName}
                  onChange={(e) => setPromptName(e.target.value)}
                  className="text-lg font-medium text-white light:text-slate-900 bg-transparent border-none focus:outline-none"
                />
                <Badge variant="info">v{selectedPrompt.current_version}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowCompare(true)}>
                  <GitCompare className="w-4 h-4" />
                  <span>比对</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowVersions(true)}>
                  <History className="w-4 h-4" />
                  <span>历史</span>
                </Button>
                <Button variant="ghost" size="sm">
                  <Wand2 className="w-4 h-4" />
                  <span>优化</span>
                </Button>
                <Button variant="secondary" size="sm" onClick={handleSave} loading={saving}>
                  <Save className="w-4 h-4" />
                  <span>保存</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDeletePrompt}>
                  <Trash2 className="w-4 h-4 text-red-400" />
                </Button>
              </div>
            </div>

            <div className="flex-1 flex">
              <div className="flex-1 flex flex-col border-r border-slate-700 light:border-slate-200">
                <div className="p-4 border-b border-slate-700 light:border-slate-200">
                  <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">Prompt 编辑器</h3>
                  <p className="text-xs text-slate-500 light:text-slate-600 mt-1">
                    使用 {'{{变量名}}'} 定义变量
                  </p>
                </div>
                <div className="flex-1 p-4">
                  <textarea
                    value={promptContent}
                    onChange={(e) => setPromptContent(e.target.value)}
                    placeholder="在这里编写你的 Prompt...&#10;&#10;示例:&#10;你是一个专业的 {{role}}。用户会向你提问，请根据以下上下文回答:&#10;&#10;上下文: {{context}}&#10;&#10;问题: {{question}}"
                    className="w-full h-full p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 resize-none focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>

              <div className="w-96 flex flex-col bg-slate-900/30 light:bg-slate-100">
                <div className="p-4 border-b border-slate-700 light:border-slate-200">
                  <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">测试运行</h3>
                </div>
                <div className="p-4 space-y-4">
                  <Select
                    label="选择模型 (保存后将作为默认模型)"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    options={
                      enabledModels.length > 0
                        ? enabledModels.map((m) => ({ value: m.id, label: m.name }))
                        : [{ value: '', label: '请先配置并启用模型服务商' }]
                    }
                  />
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                      测试输入
                    </label>
                    <textarea
                      value={testInput}
                      onChange={(e) => setTestInput(e.target.value)}
                      placeholder="输入测试内容..."
                      rows={3}
                      className="w-full p-3 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 resize-none focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                        附件
                      </label>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        添加文件
                      </button>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    {attachedFiles.length > 0 ? (
                      <div className="space-y-1.5">
                        {attachedFiles.map((file, index) => {
                          const FileIcon = getFileIcon(file.type);
                          return (
                            <div
                              key={index}
                              className="flex items-center gap-2 p-2 bg-slate-800 border border-slate-700 rounded-lg"
                            >
                              {file.type.startsWith('image/') ? (
                                <img
                                  src={`data:${file.type};base64,${file.base64}`}
                                  alt={file.name}
                                  className="w-8 h-8 object-cover rounded"
                                />
                              ) : (
                                <FileIcon className="w-4 h-4 text-slate-400" />
                              )}
                              <span className="flex-1 text-xs text-slate-300 truncate">
                                {file.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeFile(index)}
                                className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-3 border border-dashed border-slate-700 rounded-lg text-center">
                        <p className="text-xs text-slate-500">
                          支持图片 (JPG, PNG, GIF, WebP) 和 PDF
                        </p>
                      </div>
                    )}
                  </div>
                  <Button className="w-full" onClick={handleRun} loading={running}>
                    <Play className="w-4 h-4" />
                    <span>运行</span>
                  </Button>
                </div>
                <div className="flex-1 p-4 border-t border-slate-700 light:border-slate-200 flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                      输出结果
                    </label>
                    <button
                      type="button"
                      onClick={() => setRenderMarkdown(!renderMarkdown)}
                      className={`text-xs px-2 py-1 rounded transition-colors ${
                        renderMarkdown
                          ? 'bg-cyan-500/20 text-cyan-400'
                          : 'bg-slate-700 light:bg-slate-200 text-slate-400 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
                      }`}
                    >
                      {renderMarkdown ? 'Markdown' : '纯文本'}
                    </button>
                  </div>
                  <div className="flex-1 min-h-[200px] max-h-64 p-3 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-300 light:text-slate-700 overflow-y-auto">
                    {running ? (
                      <div className="flex items-center gap-2 text-slate-500 light:text-slate-600">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>生成中...</span>
                      </div>
                    ) : testOutput ? (
                      renderMarkdown ? (
                        <MarkdownRenderer content={testOutput} />
                      ) : (
                        <pre className="whitespace-pre-wrap font-mono">{testOutput}</pre>
                      )
                    ) : (
                      <span className="text-slate-500 light:text-slate-600">点击运行查看结果</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText className="w-16 h-16 mx-auto mb-4 text-slate-700 light:text-slate-400" />
              <p className="text-slate-500 light:text-slate-600">选择一个 Prompt 开始编辑</p>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={showNewPrompt} onClose={() => setShowNewPrompt(false)} title="新建 Prompt">
        <div className="space-y-4">
          <Input
            label="Prompt 名称"
            value={newPromptName}
            onChange={(e) => setNewPromptName(e.target.value)}
            placeholder="给 Prompt 起个名字"
            autoFocus
          />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setShowNewPrompt(false)}>
              取消
            </Button>
            <Button onClick={handleCreatePrompt} disabled={!newPromptName.trim()}>
              创建
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showVersions}
        onClose={() => setShowVersions(false)}
        title="版本历史"
        size="lg"
      >
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {versions.map((version) => (
            <div
              key={version.id}
              className="flex items-center justify-between p-4 bg-slate-800/50 border border-slate-700 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center">
                  <span className="text-sm font-medium text-slate-300">
                    v{version.version}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    {version.commit_message || `Version ${version.version}`}
                  </p>
                  <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                    <Clock className="w-3 h-3" />
                    {new Date(version.created_at).toLocaleString('zh-CN')}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => handleRestoreVersion(version)}>
                恢复
              </Button>
            </div>
          ))}
          {versions.length === 0 && (
            <p className="text-center text-slate-500 py-8">暂无历史版本</p>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={showCompare}
        onClose={() => {
          setShowCompare(false);
          setCompareResults({ left: null, right: null });
        }}
        title="Prompt 比对"
        size="xl"
      >
        <div className="space-y-4">
          <div className="flex gap-2 p-1 bg-slate-800 rounded-lg">
            <button
              onClick={() => setCompareMode('models')}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                compareMode === 'models'
                  ? 'bg-cyan-500 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              相同版本不同模型
            </button>
            <button
              onClick={() => setCompareMode('versions')}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                compareMode === 'versions'
                  ? 'bg-cyan-500 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              相同模型不同版本
            </button>
          </div>

          {compareMode === 'models' ? (
            <div className="space-y-3">
              <Select
                label="选择版本"
                value={compareVersion}
                onChange={(e) => setCompareVersion(e.target.value)}
                options={[
                  { value: '', label: '选择版本' },
                  ...versions.map((v) => ({
                    value: v.id,
                    label: `v${v.version} - ${new Date(v.created_at).toLocaleString('zh-CN')}`,
                  })),
                ]}
              />
              <div className="grid grid-cols-2 gap-4">
                <Select
                  label="模型 A"
                  value={compareModels[0]}
                  onChange={(e) => setCompareModels([e.target.value, compareModels[1]])}
                  options={[
                    { value: '', label: '选择模型' },
                    ...enabledModels.map((m) => ({ value: m.id, label: m.name })),
                  ]}
                />
                <Select
                  label="模型 B"
                  value={compareModels[1]}
                  onChange={(e) => setCompareModels([compareModels[0], e.target.value])}
                  options={[
                    { value: '', label: '选择模型' },
                    ...enabledModels.map((m) => ({ value: m.id, label: m.name })),
                  ]}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Select
                label="选择模型"
                value={compareModel}
                onChange={(e) => setCompareModel(e.target.value)}
                options={[
                  { value: '', label: '选择模型' },
                  ...enabledModels.map((m) => ({ value: m.id, label: m.name })),
                ]}
              />
              <div className="grid grid-cols-2 gap-4">
                <Select
                  label="版本 A"
                  value={compareVersions[0]}
                  onChange={(e) => setCompareVersions([e.target.value, compareVersions[1]])}
                  options={[
                    { value: '', label: '选择版本' },
                    ...versions.map((v) => ({
                      value: v.id,
                      label: `v${v.version} - ${new Date(v.created_at).toLocaleString('zh-CN')}`,
                    })),
                  ]}
                />
                <Select
                  label="版本 B"
                  value={compareVersions[1]}
                  onChange={(e) => setCompareVersions([compareVersions[0], e.target.value])}
                  options={[
                    { value: '', label: '选择版本' },
                    ...versions.map((v) => ({
                      value: v.id,
                      label: `v${v.version} - ${new Date(v.created_at).toLocaleString('zh-CN')}`,
                    })),
                  ]}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300">测试输入</label>
            <textarea
              value={compareInput}
              onChange={(e) => setCompareInput(e.target.value)}
              placeholder="输入测试内容..."
              rows={3}
              className="w-full p-3 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-300">附件</label>
              <button
                type="button"
                onClick={() => compareFileInputRef.current?.click()}
                className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                <Paperclip className="w-3.5 h-3.5" />
                添加文件
              </button>
            </div>
            <input
              ref={compareFileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={handleCompareFileSelect}
              className="hidden"
            />
            {compareFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {compareFiles.map((file, index) => {
                  const FileIcon = getFileIcon(file.type);
                  return (
                    <div
                      key={index}
                      className="flex items-center gap-2 p-2 bg-slate-800 border border-slate-700 rounded-lg"
                    >
                      {file.type.startsWith('image/') ? (
                        <img
                          src={`data:${file.type};base64,${file.base64}`}
                          alt={file.name}
                          className="w-8 h-8 object-cover rounded"
                        />
                      ) : (
                        <FileIcon className="w-4 h-4 text-slate-400" />
                      )}
                      <span className="text-xs text-slate-300 truncate max-w-[120px]">
                        {file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeCompareFile(index)}
                        className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Button className="w-full" onClick={handleRunComparison} loading={compareRunning}>
            <Play className="w-4 h-4" />
            <span>运行比对</span>
          </Button>

          {(compareResults.left || compareResults.right) && (
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-700">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="info">
                      {compareMode === 'models'
                        ? models.find((m) => m.id === compareModels[0])?.name || 'A'
                        : `v${versions.find((v) => v.id === compareVersions[0])?.version || 'A'}`}
                    </Badge>
                  </div>
                  {compareResults.left && !compareResults.left.error && (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Clock className="w-3 h-3" />
                      <span>{(compareResults.left.latency / 1000).toFixed(2)}s</span>
                      <span>|</span>
                      <span>{compareResults.left.tokensIn + compareResults.left.tokensOut} tokens</span>
                    </div>
                  )}
                </div>
                <div className="h-96 p-3 bg-slate-800/50 border border-slate-700 rounded-lg overflow-y-auto">
                  {compareResults.left?.error ? (
                    <div className="text-red-400 text-sm">
                      <p className="font-medium">错误</p>
                      <p className="mt-1 text-xs">{compareResults.left.error}</p>
                    </div>
                  ) : compareResults.left ? (
                    <MarkdownRenderer content={compareResults.left.content} />
                  ) : (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>运行中...</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="success">
                      {compareMode === 'models'
                        ? models.find((m) => m.id === compareModels[1])?.name || 'B'
                        : `v${versions.find((v) => v.id === compareVersions[1])?.version || 'B'}`}
                    </Badge>
                  </div>
                  {compareResults.right && !compareResults.right.error && (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Clock className="w-3 h-3" />
                      <span>{(compareResults.right.latency / 1000).toFixed(2)}s</span>
                      <span>|</span>
                      <span>{compareResults.right.tokensIn + compareResults.right.tokensOut} tokens</span>
                    </div>
                  )}
                </div>
                <div className="h-96 p-3 bg-slate-800/50 border border-slate-700 rounded-lg overflow-y-auto">
                  {compareResults.right?.error ? (
                    <div className="text-red-400 text-sm">
                      <p className="font-medium">错误</p>
                      <p className="mt-1 text-xs">{compareResults.right.error}</p>
                    </div>
                  ) : compareResults.right ? (
                    <MarkdownRenderer content={compareResults.right.content} />
                  ) : (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>运行中...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
