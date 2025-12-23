import { useState, useEffect, useRef, useMemo, useCallback, MutableRefObject } from 'react';
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
  Eye,
  Sparkles,
  Check,
  Cloud,
  CloudOff,
  Copy,
  Maximize2,
} from 'lucide-react';
import { Button, Input, Modal, Badge, Select, useToast, MarkdownRenderer, Tabs, Collapsible } from '../components/ui';
import { MessageList, ParameterPanel, VariableEditor, DebugHistory, PromptOptimizer, PromptObserver, StructuredOutputEditor, ThinkingBlock, AttachmentModal } from '../components/Prompt';
import type { DebugRun } from '../components/Prompt';
import { getDatabase, isDatabaseConfigured } from '../lib/database';
import { callAIModel, streamAIModel, fileToBase64, extractThinking, type FileAttachment, type StreamUsage } from '../lib/ai-service';
import { analyzePrompt, type PromptAnalysisResult } from '../lib/prompt-analyzer';
import { toResponseFormat } from '../lib/schema-utils';
import { getFileInputAccept, isSupportedFileType } from '../lib/file-utils';
import type { Prompt, Model, Provider, PromptVersion, PromptMessage, PromptConfig, PromptVariable } from '../types';
import { DEFAULT_PROMPT_CONFIG } from '../types/database';

type TabType = 'edit' | 'observe' | 'optimize';

// Debounce helper with cancel support
function debounce<T extends (...args: never[]) => unknown>(
  fn: T,
  delay: number,
  cancelRef?: MutableRefObject<(() => void) | null>
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  const debouncedFn = (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
  // Expose cancel function via ref
  if (cancelRef) {
    cancelRef.current = () => clearTimeout(timeoutId);
  }
  return debouncedFn;
}

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
  const [promptMessages, setPromptMessages] = useState<PromptMessage[]>([]);
  const [promptConfig, setPromptConfig] = useState<PromptConfig>(DEFAULT_PROMPT_CONFIG);
  const [promptVariables, setPromptVariables] = useState<PromptVariable[]>([]);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newPromptName, setNewPromptName] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [renderMarkdown, setRenderMarkdown] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('edit');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
  const [debugRuns, setDebugRuns] = useState<DebugRun[]>([]);
  const [selectedDebugRun, setSelectedDebugRun] = useState<DebugRun | null>(null);
  const [showDebugDetail, setShowDebugDetail] = useState<DebugRun | null>(null);
  const [debugDetailCopied, setDebugDetailCopied] = useState<'input' | 'output' | null>(null);
  const [debugDetailExpanded, setDebugDetailExpanded] = useState<{ field: 'input' | 'output'; content: string } | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<PromptAnalysisResult | null>(null);
  const [optimizeModelId, setOptimizeModelId] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const compareFileInputRef = useRef<HTMLInputElement>(null);
  const cancelAutoSaveRef = useRef<(() => void) | null>(null);
  const lastSyncedPromptIdRef = useRef<string | null>(null);
  const isPromptSwitchingRef = useRef(false);

  // Auto-save debounced function
  const debouncedAutoSave = useMemo(
    () =>
      debounce(async (promptId: string, data: Partial<Prompt>) => {
        // Validate that we're still on the same prompt before saving
        if (lastSyncedPromptIdRef.current !== promptId || isPromptSwitchingRef.current) {
          return;
        }

        setAutoSaveStatus('saving');
        try {
          const { error } = await getDatabase()
            .from('prompts')
            .update({
              ...data,
              updated_at: new Date().toISOString(),
            })
            .eq('id', promptId);

          // Double-check we're still on the same prompt after async operation
          if (lastSyncedPromptIdRef.current !== promptId) {
            return;
          }

          if (error) {
            setAutoSaveStatus('error');
          } else {
            setAutoSaveStatus('saved');
            // Update prompts list and selectedPrompt to keep them in sync
            setPrompts((prev) =>
              prev.map((p) =>
                p.id === promptId
                  ? { ...p, ...data, updated_at: new Date().toISOString() }
                  : p
              )
            );
            setSelectedPrompt((prev) =>
              prev && prev.id === promptId
                ? { ...prev, ...data, updated_at: new Date().toISOString() }
                : prev
            );
          }
        } catch {
          if (lastSyncedPromptIdRef.current === promptId) {
            setAutoSaveStatus('error');
          }
        }
      }, 2000, cancelAutoSaveRef),
    []
  );

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedPrompt) {
      // Mark that we're switching prompts - block auto-save
      isPromptSwitchingRef.current = true;

      // Cancel any pending auto-save from the previous prompt
      if (cancelAutoSaveRef.current) {
        cancelAutoSaveRef.current();
      }

      // Reset prompt content and configuration
      setPromptContent(selectedPrompt.content);
      setPromptName(selectedPrompt.name);
      setPromptMessages(selectedPrompt.messages || []);
      setPromptConfig(selectedPrompt.config || DEFAULT_PROMPT_CONFIG);
      setPromptVariables(selectedPrompt.variables || []);
      if (selectedPrompt.default_model_id) {
        setSelectedModel(selectedPrompt.default_model_id);
      }
      loadVersions(selectedPrompt.id);
      setAutoSaveStatus('saved');

      // Reset test & output states - each prompt should have independent test data
      setVariableValues({});
      setTestInput('');
      setTestOutput('');
      setAttachedFiles([]);
      setDebugRuns([]);
      setSelectedDebugRun(null);
      setShowDebugDetail(null);
      setThinkingContent('');
      setIsThinking(false);

      // Use setTimeout to ensure state updates are processed before allowing auto-save
      // This runs after React has batched and applied all the setState calls above
      setTimeout(() => {
        lastSyncedPromptIdRef.current = selectedPrompt.id;
        isPromptSwitchingRef.current = false;
      }, 0);
    } else {
      // Clear the refs when no prompt is selected
      lastSyncedPromptIdRef.current = null;
      isPromptSwitchingRef.current = false;
    }
  }, [selectedPrompt]);

  // Auto-save when content changes
  useEffect(() => {
    // Skip auto-save if:
    // 1. No selected prompt
    // 2. Currently saving
    // 3. Currently switching prompts (state not yet synced)
    // 4. The synced prompt ID doesn't match (safety check)
    if (
      !selectedPrompt ||
      autoSaveStatus === 'saving' ||
      isPromptSwitchingRef.current ||
      lastSyncedPromptIdRef.current !== selectedPrompt.id
    ) {
      return;
    }

    const hasChanges =
      promptContent !== selectedPrompt.content ||
      promptName !== selectedPrompt.name ||
      JSON.stringify(promptMessages) !== JSON.stringify(selectedPrompt.messages || []) ||
      JSON.stringify(promptConfig) !== JSON.stringify(selectedPrompt.config || DEFAULT_PROMPT_CONFIG) ||
      JSON.stringify(promptVariables) !== JSON.stringify(selectedPrompt.variables || []);

    if (hasChanges) {
      setAutoSaveStatus('unsaved');
      debouncedAutoSave(selectedPrompt.id, {
        content: promptContent,
        name: promptName,
        messages: promptMessages,
        config: promptConfig,
        variables: promptVariables,
      });
    }
  }, [promptContent, promptName, promptMessages, promptConfig, promptVariables, selectedPrompt, debouncedAutoSave, autoSaveStatus]);

  const loadData = async () => {
    // 检查数据库是否已配置
    if (!isDatabaseConfigured()) {
      return;
    }

    try {
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
        if (modelsRes.data.length > 0) {
          setSelectedModel(modelsRes.data[0].id);
          setOptimizeModelId(modelsRes.data[0].id);
        }
      }
    } catch {
      showToast('error', '请先在设置中配置数据库连接');
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
          messages: [],
          config: DEFAULT_PROMPT_CONFIG,
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
        content: promptMessages.length > 0 ? JSON.stringify(promptMessages) : promptContent,
        commit_message: `Version ${newVersion}`,
      });

      const { error } = await getDatabase()
        .from('prompts')
        .update({
          name: promptName,
          content: promptContent,
          messages: promptMessages,
          config: promptConfig,
          variables: promptVariables,
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
        messages: promptMessages,
        config: promptConfig,
        variables: promptVariables,
        current_version: newVersion,
        default_model_id: selectedModel || null,
        updated_at: new Date().toISOString(),
      };
      setSelectedPrompt(updated);
      setPrompts((prev) =>
        prev.map((p) => (p.id === selectedPrompt.id ? updated : p))
      );
      loadVersions(selectedPrompt.id);
      setAutoSaveStatus('saved');
      showToast('success', '已保存为 v' + newVersion);
    } catch {
      showToast('error', '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // Build prompt from messages
  const buildPromptFromMessages = useCallback(() => {
    if (promptMessages.length > 0) {
      return promptMessages.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n');
    }
    return promptContent;
  }, [promptMessages, promptContent]);

  // Replace variables in prompt
  const replaceVariables = useCallback((prompt: string, values: Record<string, string>) => {
    let result = prompt;
    for (const [key, value] of Object.entries(values)) {
      result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
    }
    // Also replace variables from promptVariables with their default values if not provided
    for (const variable of promptVariables) {
      if (!values[variable.name] && variable.default_value) {
        result = result.replace(new RegExp(`\\{\\{\\s*${variable.name}\\s*\\}\\}`, 'g'), variable.default_value);
      }
    }
    return result;
  }, [promptVariables]);

  const handleRun = async () => {
    let finalPrompt = buildPromptFromMessages();
    if (!finalPrompt) {
      showToast('error', '请先编写 Prompt 内容');
      return;
    }

    // Replace variables
    finalPrompt = replaceVariables(finalPrompt, variableValues);

    const model = models.find((m) => m.id === selectedModel);
    const provider = providers.find((p) => p.id === model?.provider_id);

    if (!model || !provider) {
      showToast('error', '请先在设置中配置并启用模型服务商');
      return;
    }

    setRunning(true);
    setTestOutput('');
    setThinkingContent('');
    setIsThinking(false);

    const runId = `run_${Date.now()}`;
    const startTime = Date.now();
    let thinkingStartTime = 0;

    try {
      // Build options with parameters and response format
      const options: { responseFormat?: object; parameters?: object } = {
        parameters: {
          temperature: promptConfig.temperature,
          top_p: promptConfig.top_p,
          max_tokens: promptConfig.max_tokens,
          frequency_penalty: promptConfig.frequency_penalty,
          presence_penalty: promptConfig.presence_penalty,
        },
      };

      if (promptConfig.output_schema?.enabled) {
        options.responseFormat = toResponseFormat(promptConfig.output_schema);
      }

      let fullContent = '';
      let accumulatedThinking = '';

      await streamAIModel(
        provider,
        model.name,
        finalPrompt,
        {
          onToken: (token) => {
            fullContent += token;

            // 实时检测思考内容
            const { thinking, content } = extractThinking(fullContent);
            if (thinking && thinking !== accumulatedThinking) {
              if (!isThinking) {
                setIsThinking(true);
                thinkingStartTime = Date.now();
              }
              accumulatedThinking = thinking;
              setThinkingContent(thinking);
            }

            // 显示去除思考标签后的内容
            setTestOutput(content);
          },
          onComplete: async (finalContent, _thinking, usage) => {
            const latencyMs = Date.now() - startTime;

            // Get token counts from usage
            const tokensInput = usage?.tokensInput || 0;
            const tokensOutput = usage?.tokensOutput || 0;

            // 提取最终的思考内容
            const { thinking, content } = extractThinking(finalContent);
            setThinkingContent(thinking);
            setIsThinking(false);

            const outputText = `${content}\n\n---\n**处理时间:** ${(latencyMs / 1000).toFixed(2)}s`;
            setTestOutput(outputText);

            // Add to debug history with attachments and thinking
            const newRun: DebugRun = {
              id: runId,
              input: testInput,
              inputVariables: {},
              output: content,
              status: 'success',
              latencyMs,
              tokensInput,
              tokensOutput,
              timestamp: new Date(),
              attachments: attachedFiles.length > 0 ? [...attachedFiles] : undefined,
              thinking: thinking || undefined,
            };
            setDebugRuns((prev) => [newRun, ...prev.slice(0, 19)]);

            // Ensure setRunning(false) is always called
            setRunning(false);
            showToast('success', '运行完成');

            // Save to database (non-blocking)
            try {
              await getDatabase().from('traces').insert({
                prompt_id: selectedPrompt?.id,
                model_id: model.id,
                input: finalPrompt + (testInput ? `\n\n用户输入: ${testInput}` : ''),
                output: finalContent,
                tokens_input: tokensInput,
                tokens_output: tokensOutput,
                latency_ms: latencyMs,
                status: 'success',
                metadata: {
                  test_input: testInput,
                  files: attachedFiles.map((f) => ({ name: f.name, type: f.type })),
                },
                attachments: attachedFiles,
              });
            } catch (e) {
              console.error('Failed to save trace:', e);
            }
          },
          onError: async (error) => {
            setTestOutput(`**[错误]**\n\n${error}\n\n请检查:\n1. API Key 是否正确配置\n2. 模型名称是否正确\n3. Base URL 是否可访问\n4. 网络连接是否正常`);

            // Add to debug history
            const newRun: DebugRun = {
              id: runId,
              input: testInput,
              inputVariables: {},
              output: '',
              status: 'error',
              errorMessage: error,
              latencyMs: Date.now() - startTime,
              tokensInput: 0,
              tokensOutput: 0,
              timestamp: new Date(),
            };
            setDebugRuns((prev) => [newRun, ...prev.slice(0, 19)]);

            // Ensure setRunning(false) is always called
            setRunning(false);
            showToast('error', '运行失败: ' + error);

            // Save to database (non-blocking)
            try {
              await getDatabase().from('traces').insert({
                prompt_id: selectedPrompt?.id,
                model_id: model.id,
                input: finalPrompt + (testInput ? `\n\n用户输入: ${testInput}` : ''),
                output: error,
                tokens_input: 0,
                tokens_output: 0,
                latency_ms: 0,
                status: 'error',
                metadata: { test_input: testInput, error },
                attachments: attachedFiles,
              });
            } catch (e) {
              console.error('Failed to save trace:', e);
            }
          },
        },
        testInput,
        attachedFiles.length > 0 ? attachedFiles : undefined,
        options
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      setTestOutput(`**[错误]**\n\n${errorMessage}\n\n请检查:\n1. API Key 是否正确配置\n2. 模型名称是否正确\n3. Base URL 是否可访问\n4. 网络连接是否正常`);
      setRunning(false);
      showToast('error', '运行失败: ' + errorMessage);
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
    try {
      const content = JSON.parse(version.content);
      if (Array.isArray(content)) {
        setPromptMessages(content);
      } else {
        setPromptContent(version.content);
      }
    } catch {
      setPromptContent(version.content);
    }
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

  const handleReplayDebugRun = (run: DebugRun) => {
    setTestInput(run.input);
  };

  const handleClearDebugHistory = () => {
    setDebugRuns([]);
    setSelectedDebugRun(null);
  };

  const handleDeleteDebugRun = (runId: string) => {
    setDebugRuns((prev) => prev.filter((run) => run.id !== runId));
    if (selectedDebugRun?.id === runId) {
      setSelectedDebugRun(null);
    }
  };

  const handleViewDebugDetail = (run: DebugRun) => {
    setShowDebugDetail(run);
    setDebugDetailCopied(null);
    setDebugDetailExpanded(null);
  };

  const handleDebugDetailCopy = async (text: string, field: 'input' | 'output') => {
    try {
      await navigator.clipboard.writeText(text);
      setDebugDetailCopied(field);
      setTimeout(() => setDebugDetailCopied(null), 2000);
    } catch {
      showToast('error', '复制失败');
    }
  };

  const handleOptimize = async () => {
    setIsOptimizing(true);
    setAnalysisResult(null);

    try {
      const model = models.find((m) => m.id === optimizeModelId);
      const provider = providers.find((p) => p.id === model?.provider_id);

      if (!model || !provider) {
        showToast('error', '请先选择一个分析模型');
        return [];
      }

      const result = await analyzePrompt(provider, model.name, {
        messages: promptMessages,
        content: promptContent,
        variables: promptVariables,
      });

      setAnalysisResult(result);

      if (result.score >= 90) {
        showToast('success', `分析完成！评分: ${result.score}/100 - 优秀`);
      } else if (result.score >= 70) {
        showToast('success', `分析完成！评分: ${result.score}/100 - 良好`);
      } else {
        showToast('info', `分析完成！评分: ${result.score}/100 - 有改进空间`);
      }

      return result.suggestions;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '分析失败';
      showToast('error', errorMessage);
      return [];
    } finally {
      setIsOptimizing(false);
    }
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

    for (const file of Array.from(files)) {
      if (file.size > maxSize) {
        showToast('error', `${file.name} 超过 20MB 限制`);
        continue;
      }
      if (!isSupportedFileType(file)) {
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

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          if (file.size > 20 * 1024 * 1024) {
            showToast('error', '粘贴的图片超过 20MB 限制');
            continue;
          }
          try {
            const attachment = await fileToBase64(file);
            setAttachedFiles((prev) => [...prev, attachment]);
            showToast('success', '图片已添加');
          } catch {
            showToast('error', '无法读取粘贴的图片');
          }
        }
      }
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
          left:
            result1.status === 'fulfilled'
              ? { content: result1.value.content, latency: result1.value.latencyMs, tokensIn: result1.value.tokensInput, tokensOut: result1.value.tokensOutput }
              : { content: '', latency: 0, tokensIn: 0, tokensOut: 0, error: result1.reason?.message || '执行失败' },
          right:
            result2.status === 'fulfilled'
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
          left:
            result1.status === 'fulfilled'
              ? { content: result1.value.content, latency: result1.value.latencyMs, tokensIn: result1.value.tokensInput, tokensOut: result1.value.tokensOutput }
              : { content: '', latency: 0, tokensIn: 0, tokensOut: 0, error: result1.reason?.message || '执行失败' },
          right:
            result2.status === 'fulfilled'
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

  const tabs = [
    { id: 'edit' as TabType, label: '编辑', icon: <FileText className="w-4 h-4" /> },
    { id: 'observe' as TabType, label: '历史', icon: <Eye className="w-4 h-4" /> },
    { id: 'optimize' as TabType, label: '智能优化', icon: <Sparkles className="w-4 h-4" /> },
  ];

  const renderAutoSaveStatus = () => {
    switch (autoSaveStatus) {
      case 'saved':
        return (
          <span className="flex items-center gap-1 text-xs text-green-400 light:text-green-600">
            <Check className="w-3 h-3" />
            已保存
          </span>
        );
      case 'saving':
        return (
          <span className="flex items-center gap-1 text-xs text-cyan-400 light:text-cyan-600">
            <Cloud className="w-3 h-3 animate-pulse" />
            保存中...
          </span>
        );
      case 'unsaved':
        return (
          <span className="flex items-center gap-1 text-xs text-amber-400 light:text-amber-600">
            <CloudOff className="w-3 h-3" />
            未保存
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-1 text-xs text-red-400 light:text-red-600">
            <CloudOff className="w-3 h-3" />
            保存失败
          </span>
        );
    }
  };

  return (
    <div className="h-full flex overflow-hidden bg-slate-950 light:bg-slate-50">
      {/* Left sidebar - Prompt list */}
      <div className="w-72 bg-slate-900/50 light:bg-white border-r border-slate-700 light:border-slate-200 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 p-4 space-y-3 border-b border-slate-700 light:border-slate-200">
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

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedPrompt ? (
          <>
            {/* Header */}
            <div className="h-14 flex-shrink-0 px-6 flex items-center justify-between border-b border-slate-700 light:border-slate-200">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={promptName}
                  onChange={(e) => setPromptName(e.target.value)}
                  className="text-lg font-medium text-white light:text-slate-900 bg-transparent border-none focus:outline-none"
                />
                <Badge variant="info">v{selectedPrompt.current_version}</Badge>
                {renderAutoSaveStatus()}
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
                <Button variant="secondary" size="sm" onClick={handleSave} loading={saving}>
                  <Save className="w-4 h-4" />
                  <span>提交新版</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDeletePrompt}>
                  <Trash2 className="w-4 h-4 text-red-400" />
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex-shrink-0 px-6 pt-4">
              <Tabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as TabType)} variant="pills" />
            </div>

            {/* Content based on active tab */}
            <div className="flex-1 flex overflow-hidden">
              {activeTab === 'edit' && (
                <>
                  {/* Left panel - Prompt Editor */}
                  <div className="flex-1 flex flex-col border-r border-slate-700 light:border-slate-200 overflow-hidden min-w-0 basis-0">
                    <div className="flex-shrink-0 p-4 border-b border-slate-700 light:border-slate-200">
                      <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">Prompt 编辑器</h3>
                      <p className="text-xs text-slate-500 light:text-slate-600 mt-1">
                        使用多消息模式编写对话，或使用 {'{{变量名}}'} 定义变量
                      </p>
                    </div>
                    <div className="flex-1 p-4 overflow-y-auto">
                      {promptMessages.length > 0 ? (
                        <MessageList
                          messages={promptMessages}
                          onChange={setPromptMessages}
                        />
                      ) : (
                        <div className="h-full flex flex-col">
                          <textarea
                            value={promptContent}
                            onChange={(e) => setPromptContent(e.target.value)}
                            placeholder="在这里编写你的 Prompt...&#10;&#10;示例:&#10;你是一个专业的 {{role}}。用户会向你提问，请根据以下上下文回答:&#10;&#10;上下文: {{context}}&#10;&#10;问题: {{question}}"
                            className="flex-1 w-full p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 resize-none focus:outline-none focus:border-cyan-500 font-mono"
                          />
                          <div className="text-center mt-4">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setPromptMessages([
                                  { id: `msg_${Date.now()}_1`, role: 'system', content: promptContent || 'You are a helpful assistant.' },
                                  { id: `msg_${Date.now()}_2`, role: 'user', content: '' },
                                ]);
                                setPromptContent('');
                              }}
                            >
                              <Plus className="w-4 h-4 mr-1" />
                              切换到多消息模式
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Middle panel - Model Configuration */}
                  <div className="w-72 flex flex-col border-r border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-slate-50 overflow-hidden">
                    <div className="flex-shrink-0 p-3 border-b border-slate-700 light:border-slate-200">
                      <div className="flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-cyan-400" />
                        <span className="text-sm font-medium text-slate-300 light:text-slate-700">运行配置</span>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                      {/* Model selector */}
                      <div className="p-3 bg-slate-800/50 light:bg-white rounded-lg border border-slate-700 light:border-slate-200">
                        <label className="block text-xs text-slate-400 light:text-slate-600 mb-2">
                          运行模型
                        </label>
                        <select
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-900 light:bg-slate-50 border border-slate-600 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:border-cyan-500"
                        >
                          {enabledModels.length > 0 ? (
                            enabledModels.map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))
                          ) : (
                            <option value="">请先配置模型</option>
                          )}
                        </select>
                      </div>

                      {/* Parameter panel */}
                      <ParameterPanel
                        config={promptConfig}
                        onChange={setPromptConfig}
                      />

                      {/* Variable editor */}
                      <VariableEditor
                        variables={promptVariables}
                        onChange={setPromptVariables}
                      />

                      {/* Structured output editor */}
                      <StructuredOutputEditor
                        schema={promptConfig.output_schema}
                        onChange={(schema) => setPromptConfig({ ...promptConfig, output_schema: schema })}
                        disabled={running}
                      />

                      {/* Debug history */}
                      <DebugHistory
                        runs={debugRuns}
                        onReplay={handleReplayDebugRun}
                        onClear={handleClearDebugHistory}
                        onDelete={handleDeleteDebugRun}
                        onSelect={setSelectedDebugRun}
                        onViewDetails={handleViewDebugDetail}
                        onPreviewAttachment={setPreviewAttachment}
                        selectedRunId={selectedDebugRun?.id}
                      />
                    </div>
                  </div>

                  {/* Right panel - Test & Output */}
                  <div className="flex-1 flex flex-col bg-slate-900/20 light:bg-slate-100 overflow-hidden min-w-0 basis-0">
                    <div className="flex-shrink-0 p-4 border-b border-slate-700 light:border-slate-200">
                      <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">测试与输出</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      {/* Variable values input */}
                      {promptVariables.length > 0 && (
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                            变量值
                          </label>
                          <div className="space-y-2 p-3 bg-slate-800/50 light:bg-slate-50 rounded-lg border border-slate-700 light:border-slate-200">
                            {promptVariables.map((variable) => (
                              <div key={variable.name} className="flex items-center gap-2">
                                <code className="text-xs text-amber-400 light:text-amber-600 font-mono min-w-[100px]">
                                  {`{{${variable.name}}}`}
                                  {variable.required && <span className="text-red-400">*</span>}
                                </code>
                                <input
                                  type="text"
                                  value={variableValues[variable.name] || ''}
                                  onChange={(e) =>
                                    setVariableValues((prev) => ({
                                      ...prev,
                                      [variable.name]: e.target.value,
                                    }))
                                  }
                                  placeholder={variable.default_value || variable.description || '输入值...'}
                                  className="flex-1 px-2 py-1.5 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Test input */}
                      <div className="space-y-1.5">
                        <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                          测试输入
                        </label>
                        <textarea
                          value={testInput}
                          onChange={(e) => setTestInput(e.target.value)}
                          onPaste={handlePaste}
                          placeholder="输入测试内容...（支持粘贴图片）"
                          rows={4}
                          className="w-full p-3 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 resize-none focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      {/* Attachments */}
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
                          accept={getFileInputAccept()}
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
                                  className="flex items-center gap-2 p-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg"
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
                                  <span className="flex-1 text-xs text-slate-300 light:text-slate-700 truncate">
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
                          <div className="p-2 border border-dashed border-slate-700 light:border-slate-300 rounded-lg text-center">
                            <p className="text-xs text-slate-500 light:text-slate-600">
                              支持图片、PDF、txt、md、json、csv、xml、yaml
                            </p>
                          </div>
                        )}
                      </div>

                      <Button className="w-full" onClick={handleRun} loading={running}>
                        <Play className="w-4 h-4" />
                        <span>运行</span>
                      </Button>

                      {/* Thinking Block */}
                      {(thinkingContent || isThinking) && (
                        <ThinkingBlock
                          content={thinkingContent}
                          isStreaming={isThinking}
                        />
                      )}

                      {/* Output */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
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
                        <div className="min-h-[300px] max-h-[500px] p-3 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-300 light:text-slate-700 overflow-y-auto">
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
              )}

              {activeTab === 'observe' && selectedPrompt && (
                <div className="flex-1 overflow-hidden">
                  <PromptObserver
                    promptId={selectedPrompt.id}
                    models={models}
                  />
                </div>
              )}

              {activeTab === 'optimize' && (
                <div className="flex-1 p-6">
                  <PromptOptimizer
                    messages={promptMessages}
                    content={promptContent}
                    models={models}
                    providers={providers}
                    selectedModelId={optimizeModelId}
                    onModelChange={setOptimizeModelId}
                    onApplySuggestion={(suggestion) => {
                      if (!suggestion.originalText || !suggestion.suggestedText) return;

                      if (suggestion.messageIndex !== undefined && promptMessages[suggestion.messageIndex]) {
                        const newMessages = [...promptMessages];
                        newMessages[suggestion.messageIndex] = {
                          ...newMessages[suggestion.messageIndex],
                          content: newMessages[suggestion.messageIndex].content.replace(
                            suggestion.originalText,
                            suggestion.suggestedText
                          ),
                        };
                        setPromptMessages(newMessages);
                      } else {
                        const newMessages = promptMessages.map((msg) => ({
                          ...msg,
                          content: msg.content.replace(suggestion.originalText!, suggestion.suggestedText!),
                        }));
                        setPromptMessages(newMessages);
                      }
                      showToast('success', '建议已应用');
                    }}
                    onOptimize={handleOptimize}
                    isOptimizing={isOptimizing}
                    analysisResult={analysisResult}
                  />
                </div>
              )}
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

      {/* New Prompt Modal */}
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

      {/* Version History Modal */}
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
              className="flex items-center justify-between p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-700 light:bg-slate-200 flex items-center justify-center">
                  <span className="text-sm font-medium text-slate-300 light:text-slate-700">
                    v{version.version}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-200 light:text-slate-800">
                    {version.commit_message || `Version ${version.version}`}
                  </p>
                  <p className="text-xs text-slate-500 light:text-slate-600 flex items-center gap-1 mt-1">
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
            <p className="text-center text-slate-500 light:text-slate-600 py-8">暂无历史版本</p>
          )}
        </div>
      </Modal>

      {/* Compare Modal */}
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
          <div className="flex gap-2 p-1 bg-slate-800 light:bg-slate-100 rounded-lg">
            <button
              onClick={() => setCompareMode('models')}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                compareMode === 'models'
                  ? 'bg-cyan-500 text-white'
                  : 'text-slate-400 light:text-slate-600 hover:text-white light:hover:text-slate-900'
              }`}
            >
              相同版本不同模型
            </button>
            <button
              onClick={() => setCompareMode('versions')}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                compareMode === 'versions'
                  ? 'bg-cyan-500 text-white'
                  : 'text-slate-400 light:text-slate-600 hover:text-white light:hover:text-slate-900'
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
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700">测试输入</label>
            <textarea
              value={compareInput}
              onChange={(e) => setCompareInput(e.target.value)}
              placeholder="输入测试内容..."
              rows={3}
              className="w-full p-3 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 resize-none focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-300 light:text-slate-700">附件</label>
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
                      className="flex items-center gap-2 p-2 bg-slate-800 light:bg-slate-100 border border-slate-700 light:border-slate-300 rounded-lg"
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
                      <span className="text-xs text-slate-300 light:text-slate-700 truncate max-w-[120px]">
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
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-700 light:border-slate-200">
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
                    <div className="flex items-center gap-2 text-xs text-slate-500 light:text-slate-600">
                      <Clock className="w-3 h-3" />
                      <span>{(compareResults.left.latency / 1000).toFixed(2)}s</span>
                      <span>|</span>
                      <span>{compareResults.left.tokensIn + compareResults.left.tokensOut} tokens</span>
                    </div>
                  )}
                </div>
                <div className="h-96 p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg overflow-y-auto">
                  {compareResults.left?.error ? (
                    <div className="text-red-400 light:text-red-600 text-sm">
                      <p className="font-medium">错误</p>
                      <p className="mt-1 text-xs">{compareResults.left.error}</p>
                    </div>
                  ) : compareResults.left ? (
                    <MarkdownRenderer content={compareResults.left.content} />
                  ) : (
                    <div className="flex items-center gap-2 text-slate-500 light:text-slate-600">
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
                    <div className="flex items-center gap-2 text-xs text-slate-500 light:text-slate-600">
                      <Clock className="w-3 h-3" />
                      <span>{(compareResults.right.latency / 1000).toFixed(2)}s</span>
                      <span>|</span>
                      <span>{compareResults.right.tokensIn + compareResults.right.tokensOut} tokens</span>
                    </div>
                  )}
                </div>
                <div className="h-96 p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg overflow-y-auto">
                  {compareResults.right?.error ? (
                    <div className="text-red-400 light:text-red-600 text-sm">
                      <p className="font-medium">错误</p>
                      <p className="mt-1 text-xs">{compareResults.right.error}</p>
                    </div>
                  ) : compareResults.right ? (
                    <MarkdownRenderer content={compareResults.right.content} />
                  ) : (
                    <div className="flex items-center gap-2 text-slate-500 light:text-slate-600">
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

      {/* Debug Detail Modal */}
      <Modal
        isOpen={!!showDebugDetail}
        onClose={() => {
          setShowDebugDetail(null);
          setDebugDetailExpanded(null);
        }}
        title="调试详情"
        size="lg"
      >
        {showDebugDetail && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">状态</p>
                <Badge variant={showDebugDetail.status === 'success' ? 'success' : 'error'}>
                  {showDebugDetail.status === 'success' ? '成功' : '失败'}
                </Badge>
              </div>
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">延迟</p>
                <p className="text-sm font-medium text-slate-200 light:text-slate-800">{showDebugDetail.latencyMs}ms</p>
              </div>
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">输入 Tokens</p>
                <p className="text-sm font-medium text-cyan-400 light:text-cyan-600">{showDebugDetail.tokensInput}</p>
              </div>
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">输出 Tokens</p>
                <p className="text-sm font-medium text-teal-400 light:text-teal-600">{showDebugDetail.tokensOutput}</p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-slate-300 light:text-slate-700">输入</h4>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setDebugDetailExpanded({ field: 'input', content: showDebugDetail.input })}
                    className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors"
                    title="放大查看"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDebugDetailCopy(showDebugDetail.input, 'input')}
                    className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors"
                    title="复制"
                  >
                    {debugDetailCopied === 'input' ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg max-h-40 overflow-y-auto">
                <MarkdownRenderer content={showDebugDetail.input} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-slate-300 light:text-slate-700">输出</h4>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setDebugDetailExpanded({ field: 'output', content: showDebugDetail.output })}
                    className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors"
                    title="放大查看"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDebugDetailCopy(showDebugDetail.output, 'output')}
                    className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors"
                    title="复制"
                  >
                    {debugDetailCopied === 'output' ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg max-h-40 overflow-y-auto">
                {showDebugDetail.output ? (
                  <MarkdownRenderer content={showDebugDetail.output} />
                ) : (
                  <span className="text-sm text-slate-500 light:text-slate-400">(空)</span>
                )}
              </div>
            </div>

            {showDebugDetail.errorMessage && (
              <div>
                <h4 className="text-sm font-medium text-rose-400 light:text-rose-600 mb-2">错误信息</h4>
                <div className="p-4 bg-rose-500/10 light:bg-rose-50 border border-rose-500/30 light:border-rose-200 rounded-lg">
                  <pre className="text-sm text-rose-300 light:text-rose-700 whitespace-pre-wrap font-mono">
                    {showDebugDetail.errorMessage}
                  </pre>
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-slate-700 light:border-slate-200">
              <p className="text-xs text-slate-500 light:text-slate-600">
                运行时间: {showDebugDetail.timestamp.toLocaleString('zh-CN')}
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Debug Detail Expanded Modal */}
      <Modal
        isOpen={!!debugDetailExpanded}
        onClose={() => setDebugDetailExpanded(null)}
        title={debugDetailExpanded?.field === 'input' ? '输入内容' : '输出内容'}
        size="xl"
      >
        {debugDetailExpanded && (
          <div className="space-y-4">
            <div className="flex items-center justify-end">
              <button
                onClick={() => handleDebugDetailCopy(debugDetailExpanded.content, debugDetailExpanded.field)}
                className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-700 light:bg-slate-200 text-slate-300 light:text-slate-700 hover:bg-slate-600 light:hover:bg-slate-300 transition-colors text-sm"
              >
                {debugDetailCopied === debugDetailExpanded.field ? (
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
              {debugDetailExpanded.content ? (
                <MarkdownRenderer content={debugDetailExpanded.content} />
              ) : (
                <span className="text-sm text-slate-500 light:text-slate-400">(空)</span>
              )}
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
