import { useState, useEffect, useRef, useMemo, useCallback, MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { flushSync } from 'react-dom';
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
  Square,
  Settings2,
} from 'lucide-react';
import { Button, Input, Modal, Badge, Select, MarkdownRenderer, Tabs, Collapsible, ModelSelector } from '../components/ui';
import { MessageList, ParameterPanel, VariableEditor, DebugHistory, PromptOptimizer, PromptObserver, StructuredOutputEditor, ThinkingBlock, AttachmentModal } from '../components/Prompt';
import { ReasoningSelector } from '../components/Common/ReasoningSelector';
import type { DebugRun } from '../components/Prompt';
import { getDatabase, isDatabaseConfigured } from '../lib/database';
import { callAIModel, streamAIModel, fileToBase64, extractThinking, type AICallOptions, type FileAttachment, type StreamUsage } from '../lib/ai-service';
import { analyzePrompt, type PromptAnalysisResult } from '../lib/prompt-analyzer';
import { toResponseFormat } from '../lib/schema-utils';
import { getFileInputAccept, isSupportedFileType } from '../lib/file-utils';
import { getFileUploadCapabilities, isFileTypeAllowed, inferReasoningSupport } from '../lib/model-capabilities';
import type { Prompt, Model, Provider, PromptVersion, PromptMessage, PromptConfig, PromptVariable, ReasoningEffort } from '../types';
import { DEFAULT_PROMPT_CONFIG } from '../types/database';
import { useToast } from '../store/useUIStore';
import { useGlobalStore } from '../store/useGlobalStore';
import { invalidatePromptsCache } from '../lib/cache-events';

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
  const { t } = useTranslation('prompts');
  const { t: tCommon } = useTranslation('common');

  // Use global store for providers and models (shared across pages, with caching)
  const {
    providers,
    models,
    fetchProvidersAndModels,
    getEnabledProviders,
  } = useGlobalStore();

  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
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
  const [compareRunning, setCompareRunning] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  const [compareResults, setCompareResults] = useState<{
    left: { content: string; thinking: string; latency: number; tokensIn: number; tokensOut: number; error?: string; isThinking?: boolean } | null;
    right: { content: string; thinking: string; latency: number; tokensIn: number; tokensOut: number; error?: string; isThinking?: boolean } | null;
  }>({ left: null, right: null });
  const [compareParams, setCompareParams] = useState<{
    left: { temperature: number; top_p: number; max_tokens: number; frequency_penalty: number; presence_penalty: number; reasoning?: { enabled: boolean; effort: ReasoningEffort } };
    right: { temperature: number; top_p: number; max_tokens: number; frequency_penalty: number; presence_penalty: number; reasoning?: { enabled: boolean; effort: ReasoningEffort } };
  }>({
    left: { temperature: 0.7, top_p: 1, max_tokens: 4096, frequency_penalty: 0, presence_penalty: 0, reasoning: undefined },
    right: { temperature: 0.7, top_p: 1, max_tokens: 4096, frequency_penalty: 0, presence_penalty: 0, reasoning: undefined },
  });
  const compareAbortControllersRef = useRef<{ left: AbortController | null; right: AbortController | null }>({ left: null, right: null });
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
  const runAbortControllerRef = useRef<AbortController | null>(null);

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
    return () => {
      runAbortControllerRef.current?.abort();
    };
  }, []);

  // Set default model when models are loaded
  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      const enabledModels = models.filter((m) => {
        const provider = providers.find((p) => p.id === m.provider_id);
        return provider?.enabled;
      });
      if (enabledModels.length > 0) {
        setSelectedModel(enabledModels[0].id);
        setOptimizeModelId(enabledModels[0].id);
      }
    }
  }, [models, providers, selectedModel]);

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
      // Load providers and models from global store (with caching)
      await fetchProvidersAndModels();

      // Load prompts
      const { data: promptsData } = await getDatabase()
        .from('prompts')
        .select('*')
        .order('order_index')
        .order('updated_at', { ascending: false });

      if (promptsData) {
        setPrompts(promptsData);
        if (promptsData.length > 0) {
          setSelectedPrompt(promptsData[0]);
        }
      }
    } catch {
      showToast('error', t('configureDbFirst'));
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
        showToast('error', t('createFailed') + ': ' + error.message);
        return;
      }

      if (data) {
        setPrompts((prev) => [data, ...prev]);
        setSelectedPrompt(data);
        setNewPromptName('');
        setShowNewPrompt(false);
        showToast('success', t('promptCreated'));
      }
    } catch {
      showToast('error', t('createPromptFailed'));
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
        showToast('error', t('saveFailed') + ': ' + error.message);
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
      showToast('success', t('savedVersion', { version: newVersion }));

      // 通知其他页面刷新 prompts 缓存
      invalidatePromptsCache(updated);
    } catch {
      showToast('error', t('saveFailed'));
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

  const handleStopRun = () => {
    runAbortControllerRef.current?.abort();
  };

  const handleRun = async () => {
    let finalPrompt = buildPromptFromMessages();
    if (!finalPrompt) {
      showToast('error', t('writePromptFirst'));
      return;
    }

    // Replace variables
    finalPrompt = replaceVariables(finalPrompt, variableValues);

    const model = models.find((m) => m.id === selectedModel);
    const provider = providers.find((p) => p.id === model?.provider_id);

    if (!model || !provider) {
      showToast('error', t('configureModelProviderFirst'));
      return;
    }

    runAbortControllerRef.current?.abort();
    const runAbortController = new AbortController();
    runAbortControllerRef.current = runAbortController;

    setRunning(true);
    setTestOutput('');
    setThinkingContent('');
    setIsThinking(false);

    const runId = `run_${Date.now()}`;
    const startTime = Date.now();
    let thinkingStartTime = 0;

    try {
      // Build options with parameters and response format
      const options: AICallOptions = {
        parameters: {
          temperature: promptConfig.temperature,
          top_p: promptConfig.top_p,
          max_tokens: promptConfig.max_tokens,
          frequency_penalty: promptConfig.frequency_penalty,
          presence_penalty: promptConfig.presence_penalty,
        },
        signal: runAbortController.signal,
      };

      if (promptConfig.output_schema?.enabled) {
        options.responseFormat = toResponseFormat(promptConfig.output_schema);
      }

      // 添加推理配置
      if (promptConfig.reasoning?.enabled && promptConfig.reasoning?.effort !== 'default') {
        options.reasoning = {
          enabled: true,
          effort: promptConfig.reasoning.effort,
        };
      }

      let fullContent = '';
      let accumulatedThinking = '';
      let isCurrentlyThinking = false;  // 局部变量跟踪思考状态，避免闭包问题

      await streamAIModel(
        provider,
        model.model_id,
        finalPrompt,
        {
          onToken: (token) => {
            fullContent += token;

            // 收到正文内容时，结束思考状态
            if (isCurrentlyThinking) {
              isCurrentlyThinking = false;
              flushSync(() => {
                setIsThinking(false);
              });
            }

            // 实时检测思考内容 (用于文本标签格式如 <think>)
            const { thinking, content } = extractThinking(fullContent);

            if (thinking && thinking !== accumulatedThinking) {
              accumulatedThinking = thinking;
              setThinkingContent(thinking);
            }

            // 显示去除思考标签后的内容 - 使用 flushSync 强制同步更新实现流式渲染
            flushSync(() => {
              setTestOutput(content);
            });
          },
          onThinkingToken: (token) => {
            // 流式思考内容 (用于 OpenRouter reasoning 字段)
            if (!isCurrentlyThinking) {
              isCurrentlyThinking = true;
              thinkingStartTime = Date.now();
              flushSync(() => {
                setIsThinking(true);
              });
            }
            accumulatedThinking += token;
            flushSync(() => {
              setThinkingContent(accumulatedThinking);
            });
          },
          onComplete: async (finalContent, _thinking, usage) => {
            runAbortControllerRef.current = null;
            const latencyMs = Date.now() - startTime;

            // Get token counts from usage
            const tokensInput = usage?.tokensInput || 0;
            const tokensOutput = usage?.tokensOutput || 0;

            // 提取最终的思考内容
            const { thinking, content } = extractThinking(finalContent);
            setThinkingContent(thinking);
            setIsThinking(false);

            const outputText = `${content}\n\n---\n**${t('processingTime')}:** ${(latencyMs / 1000).toFixed(2)}s`;
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
            showToast('success', t('runComplete'));

            // Save to database (non-blocking)
            try {
              await getDatabase().from('traces').insert({
                prompt_id: selectedPrompt?.id,
                model_id: model.id,
                input: finalPrompt + (testInput ? `\n\n${t('userInput')}: ${testInput}` : ''),
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
          onAbort: () => {
            runAbortControllerRef.current = null;
            setIsThinking(false);
            setRunning(false);
            showToast('info', t('runStopped'));
          },
          onError: async (error) => {
            runAbortControllerRef.current = null;
            setTestOutput(`**[${t('error')}]**\n\n${error}\n\n${t('errorCheckList')}`);

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
            showToast('error', t('runFailed') + ': ' + error);

            // Save to database (non-blocking)
            try {
              await getDatabase().from('traces').insert({
                prompt_id: selectedPrompt?.id,
                model_id: model.id,
                input: finalPrompt + (testInput ? `\n\n${t('userInput')}: ${testInput}` : ''),
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
      const errorMessage = error instanceof Error ? error.message : t('unknownError');
      setTestOutput(`**[${t('error')}]**\n\n${errorMessage}\n\n${t('errorCheckList')}`);
      setRunning(false);
      showToast('error', t('runFailed') + ': ' + errorMessage);
    }
  };

  const handleDeletePrompt = async () => {
    if (!selectedPrompt) return;
    try {
      const { error } = await getDatabase().from('prompts').delete().eq('id', selectedPrompt.id);
      if (error) {
        showToast('error', t('deleteFailed') + ': ' + error.message);
        return;
      }
      const remaining = prompts.filter((p) => p.id !== selectedPrompt.id);
      setPrompts(remaining);
      setSelectedPrompt(remaining[0] || null);
      showToast('success', t('promptDeleted'));
    } catch {
      showToast('error', t('deleteFailed'));
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
    showToast('info', t('restoredToVersion', { version: version.version }));
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
      showToast('error', t('copyFailed'));
    }
  };

  const handleOptimize = async () => {
    setIsOptimizing(true);
    setAnalysisResult(null);

    try {
      const model = models.find((m) => m.id === optimizeModelId);
      const provider = providers.find((p) => p.id === model?.provider_id);

      if (!model || !provider) {
        showToast('error', t('selectAnalyzeModelFirst'));
        return [];
      }

      const result = await analyzePrompt(provider, model.model_id, {
        messages: promptMessages,
        content: promptContent,
        variables: promptVariables,
      });

      setAnalysisResult(result);

      if (result.score >= 90) {
        showToast('success', t('analysisComplete', { score: result.score, level: t('scoreExcellent') }));
      } else if (result.score >= 70) {
        showToast('success', t('analysisComplete', { score: result.score, level: t('scoreGood') }));
      } else {
        showToast('info', t('analysisComplete', { score: result.score, level: t('scoreNeedsWork') }));
      }

      return result.suggestions;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('analyzeFailed');
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

    if (diffMins < 1) return t('justNow');
    if (diffMins < 60) return t('minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('daysAgo', { count: diffDays });
    return date.toLocaleDateString('zh-CN');
  };

  // 计算当前选中模型的文件上传能力
  const fileUploadCapabilities = useMemo(() => {
    const model = models.find((m) => m.id === selectedModel);
    const provider = providers.find((p) => p.id === model?.provider_id);
    if (!model || !provider) {
      return { accept: '.txt,.md,.json,.csv,.xml,.yaml,.yml', canUploadImage: false, canUploadPdf: false, canUploadText: true };
    }
    return getFileUploadCapabilities(provider.type, model.model_id, model.supports_vision ?? true);
  }, [selectedModel, models, providers]);

  // 计算比较功能的文件上传能力（取两个模型的交集）
  const compareFileUploadCapabilities = useMemo(() => {
    const model1 = models.find((m) => m.id === compareModels[0]);
    const model2 = models.find((m) => m.id === compareModels[1]);
    const provider1 = providers.find((p) => p.id === model1?.provider_id);
    const provider2 = providers.find((p) => p.id === model2?.provider_id);

    let canUploadImage = true;
    let canUploadPdf = true;

    if (model1 && provider1) {
      const cap1 = getFileUploadCapabilities(provider1.type, model1.model_id, model1.supports_vision ?? true);
      canUploadImage = canUploadImage && cap1.canUploadImage;
      canUploadPdf = canUploadPdf && cap1.canUploadPdf;
    }
    if (model2 && provider2) {
      const cap2 = getFileUploadCapabilities(provider2.type, model2.model_id, model2.supports_vision ?? true);
      canUploadImage = canUploadImage && cap2.canUploadImage;
      canUploadPdf = canUploadPdf && cap2.canUploadPdf;
    }

    const acceptParts: string[] = [];
    if (canUploadImage) acceptParts.push('image/*');
    if (canUploadPdf) acceptParts.push('application/pdf');

    return {
      accept: acceptParts.length > 0 ? acceptParts.join(',') : '',
      canUploadImage,
      canUploadPdf,
    };
  }, [compareModels, models, providers]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const maxSize = 20 * 1024 * 1024;
    const model = models.find((m) => m.id === selectedModel);
    const provider = providers.find((p) => p.id === model?.provider_id);

    for (const file of Array.from(files)) {
      if (file.size > maxSize) {
        showToast('error', t('fileTooLarge', { name: file.name }));
        continue;
      }

      // 使用新的文件类型验证
      if (!isSupportedFileType(file)) {
        showToast('error', t('unsupportedFileType', { name: file.name }));
        continue;
      }

      // 根据当前模型能力检查是否允许上传
      if (model && provider && !isFileTypeAllowed(file, provider.type, model.model_id, model.supports_vision ?? true)) {
        const isImage = file.type.startsWith('image/');
        const isPdf = file.type === 'application/pdf';
        if (isImage) {
          showToast('error', t('imageNotSupported'));
        } else if (isPdf) {
          showToast('error', t('pdfNotSupported'));
        }
        continue;
      }

      try {
        const attachment = await fileToBase64(file);
        setAttachedFiles((prev) => [...prev, attachment]);
      } catch {
        showToast('error', t('fileReadFailed', { name: file.name }));
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
        // 检查当前模型是否支持图片
        if (!fileUploadCapabilities.canUploadImage) {
          showToast('error', t('imageNotSupported'));
          return;
        }
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          if (file.size > 20 * 1024 * 1024) {
            showToast('error', t('imageTooLarge'));
            continue;
          }
          try {
            const attachment = await fileToBase64(file);
            setAttachedFiles((prev) => [...prev, attachment]);
            showToast('success', t('imageAdded'));
          } catch {
            showToast('error', t('cannotReadImage'));
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

  const handleStopComparison = (side: 'left' | 'right' | 'both') => {
    if (side === 'both' || side === 'left') {
      compareAbortControllersRef.current.left?.abort();
      compareAbortControllersRef.current.left = null;
    }
    if (side === 'both' || side === 'right') {
      compareAbortControllersRef.current.right?.abort();
      compareAbortControllersRef.current.right = null;
    }
  };

  const handleRunComparison = async () => {
    if (compareMode === 'models') {
      if (!compareVersion || !compareModels[0] || !compareModels[1]) {
        showToast('error', t('selectVersionAndModels'));
        return;
      }
    } else {
      if (!compareModel || !compareVersions[0] || !compareVersions[1]) {
        showToast('error', t('selectModelAndVersions'));
        return;
      }
    }

    // 中止之前的请求
    handleStopComparison('both');

    // 创建新的 AbortController
    const leftController = new AbortController();
    const rightController = new AbortController();
    compareAbortControllersRef.current = { left: leftController, right: rightController };

    setCompareRunning({ left: true, right: true });
    setCompareResults({ left: null, right: null });

    // 记录开始时间
    const startTimeLeft = Date.now();
    const startTimeRight = Date.now();

    // 准备运行参数
    let leftPrompt = '';
    let rightPrompt = '';
    let leftModel: typeof models[0] | undefined;
    let rightModel: typeof models[0] | undefined;
    let leftProvider: typeof providers[0] | undefined;
    let rightProvider: typeof providers[0] | undefined;

    if (compareMode === 'models') {
      const version = versions.find((v) => v.id === compareVersion);
      if (!version) return;

      leftPrompt = version.content;
      rightPrompt = version.content;
      leftModel = models.find((m) => m.id === compareModels[0]);
      rightModel = models.find((m) => m.id === compareModels[1]);
      leftProvider = providers.find((p) => p.id === leftModel?.provider_id);
      rightProvider = providers.find((p) => p.id === rightModel?.provider_id);
    } else {
      const version1 = versions.find((v) => v.id === compareVersions[0]);
      const version2 = versions.find((v) => v.id === compareVersions[1]);
      if (!version1 || !version2) return;

      leftPrompt = version1.content;
      rightPrompt = version2.content;
      const model = models.find((m) => m.id === compareModel);
      const provider = providers.find((p) => p.id === model?.provider_id);
      leftModel = rightModel = model;
      leftProvider = rightProvider = provider;
    }

    if (!leftModel || !rightModel || !leftProvider || !rightProvider) {
      showToast('error', t('modelConfigError'));
      setCompareRunning({ left: false, right: false });
      return;
    }

    // 运行左侧
    const runLeft = async () => {
      let fullContent = '';
      let accumulatedThinking = '';
      let isCurrentlyThinking = false;
      let tokensIn = 0;
      let tokensOut = 0;

      try {
        await streamAIModel(
          leftProvider!,
          leftModel!.model_id,
          leftPrompt,
          {
            onToken: (token) => {
              fullContent += token;

              // 收到正文内容时，结束思考状态
              if (isCurrentlyThinking) {
                isCurrentlyThinking = false;
              }

              // 实时检测思考内容 (用于文本标签格式如 <think>)
              const { thinking, content } = extractThinking(fullContent);

              if (thinking && thinking !== accumulatedThinking) {
                accumulatedThinking = thinking;
              }

              flushSync(() => {
                setCompareResults((prev) => ({
                  ...prev,
                  left: { content, thinking: accumulatedThinking, latency: Date.now() - startTimeLeft, tokensIn, tokensOut, isThinking: isCurrentlyThinking },
                }));
              });
            },
            onThinkingToken: (token) => {
              // 流式思考内容 (用于 OpenRouter reasoning 字段)
              if (!isCurrentlyThinking) {
                isCurrentlyThinking = true;
              }
              accumulatedThinking += token;
              flushSync(() => {
                setCompareResults((prev) => ({
                  ...prev,
                  left: { content: fullContent, thinking: accumulatedThinking, latency: Date.now() - startTimeLeft, tokensIn, tokensOut, isThinking: true },
                }));
              });
            },
            onComplete: (_finalContent, _thinkingContent, usage) => {
              if (usage) {
                tokensIn = usage.tokensInput;
                tokensOut = usage.tokensOutput;
              }
              // 提取最终的思考内容
              const { thinking, content } = extractThinking(fullContent);
              setCompareResults((prev) => ({
                ...prev,
                left: { content, thinking: thinking || accumulatedThinking, latency: Date.now() - startTimeLeft, tokensIn, tokensOut },
              }));
              setCompareRunning((prev) => ({ ...prev, left: false }));
            },
            onError: (error) => {
              setCompareResults((prev) => ({
                ...prev,
                left: { content: '', thinking: '', latency: 0, tokensIn: 0, tokensOut: 0, error },
              }));
              setCompareRunning((prev) => ({ ...prev, left: false }));
            },
            onAbort: () => {
              setCompareResults((prev) => ({
                ...prev,
                left: prev.left ? { ...prev.left, error: t('runStopped') } : { content: '', thinking: '', latency: 0, tokensIn: 0, tokensOut: 0, error: t('runStopped') },
              }));
              setCompareRunning((prev) => ({ ...prev, left: false }));
            },
          },
          compareInput || undefined,
          compareFiles.length > 0 ? compareFiles : undefined,
          {
            parameters: {
              temperature: compareParams.left.temperature,
              top_p: compareParams.left.top_p,
              max_tokens: compareParams.left.max_tokens,
              frequency_penalty: compareParams.left.frequency_penalty,
              presence_penalty: compareParams.left.presence_penalty,
            },
            reasoning: compareParams.left.reasoning,
            signal: leftController.signal,
          }
        );
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          setCompareResults((prev) => ({
            ...prev,
            left: { content: '', thinking: '', latency: 0, tokensIn: 0, tokensOut: 0, error: error.message },
          }));
          setCompareRunning((prev) => ({ ...prev, left: false }));
        }
      }
    };

    // 运行右侧
    const runRight = async () => {
      let fullContent = '';
      let accumulatedThinking = '';
      let isCurrentlyThinking = false;
      let tokensIn = 0;
      let tokensOut = 0;

      try {
        await streamAIModel(
          rightProvider!,
          rightModel!.model_id,
          rightPrompt,
          {
            onToken: (token) => {
              fullContent += token;

              // 收到正文内容时，结束思考状态
              if (isCurrentlyThinking) {
                isCurrentlyThinking = false;
              }

              // 实时检测思考内容 (用于文本标签格式如 <think>)
              const { thinking, content } = extractThinking(fullContent);

              if (thinking && thinking !== accumulatedThinking) {
                accumulatedThinking = thinking;
              }

              flushSync(() => {
                setCompareResults((prev) => ({
                  ...prev,
                  right: { content, thinking: accumulatedThinking, latency: Date.now() - startTimeRight, tokensIn, tokensOut, isThinking: isCurrentlyThinking },
                }));
              });
            },
            onThinkingToken: (token) => {
              // 流式思考内容 (用于 OpenRouter reasoning 字段)
              if (!isCurrentlyThinking) {
                isCurrentlyThinking = true;
              }
              accumulatedThinking += token;
              flushSync(() => {
                setCompareResults((prev) => ({
                  ...prev,
                  right: { content: fullContent, thinking: accumulatedThinking, latency: Date.now() - startTimeRight, tokensIn, tokensOut, isThinking: true },
                }));
              });
            },
            onComplete: (_finalContent, _thinkingContent, usage) => {
              if (usage) {
                tokensIn = usage.tokensInput;
                tokensOut = usage.tokensOutput;
              }
              // 提取最终的思考内容
              const { thinking, content } = extractThinking(fullContent);
              setCompareResults((prev) => ({
                ...prev,
                right: { content, thinking: thinking || accumulatedThinking, latency: Date.now() - startTimeRight, tokensIn, tokensOut },
              }));
              setCompareRunning((prev) => ({ ...prev, right: false }));
            },
            onError: (error) => {
              setCompareResults((prev) => ({
                ...prev,
                right: { content: '', thinking: '', latency: 0, tokensIn: 0, tokensOut: 0, error },
              }));
              setCompareRunning((prev) => ({ ...prev, right: false }));
            },
            onAbort: () => {
              setCompareResults((prev) => ({
                ...prev,
                right: prev.right ? { ...prev.right, error: t('runStopped') } : { content: '', thinking: '', latency: 0, tokensIn: 0, tokensOut: 0, error: t('runStopped') },
              }));
              setCompareRunning((prev) => ({ ...prev, right: false }));
            },
          },
          compareInput || undefined,
          compareFiles.length > 0 ? compareFiles : undefined,
          {
            parameters: {
              temperature: compareParams.right.temperature,
              top_p: compareParams.right.top_p,
              max_tokens: compareParams.right.max_tokens,
              frequency_penalty: compareParams.right.frequency_penalty,
              presence_penalty: compareParams.right.presence_penalty,
            },
            reasoning: compareParams.right.reasoning,
            signal: rightController.signal,
          }
        );
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          setCompareResults((prev) => ({
            ...prev,
            right: { content: '', thinking: '', latency: 0, tokensIn: 0, tokensOut: 0, error: error.message },
          }));
          setCompareRunning((prev) => ({ ...prev, right: false }));
        }
      }
    };

    // 并行运行两侧
    await Promise.all([runLeft(), runRight()]);
  };

  const handleCompareFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const maxSize = 20 * 1024 * 1024;

    // 获取两个比较模型的能力，取交集
    const model1 = models.find((m) => m.id === compareModels[0]);
    const model2 = models.find((m) => m.id === compareModels[1]);
    const provider1 = providers.find((p) => p.id === model1?.provider_id);
    const provider2 = providers.find((p) => p.id === model2?.provider_id);

    // 计算两个模型共同支持的能力
    let canUploadImage = true;
    let canUploadPdf = true;

    if (model1 && provider1) {
      const cap1 = getFileUploadCapabilities(provider1.type, model1.model_id, model1.supports_vision ?? true);
      canUploadImage = canUploadImage && cap1.canUploadImage;
      canUploadPdf = canUploadPdf && cap1.canUploadPdf;
    }
    if (model2 && provider2) {
      const cap2 = getFileUploadCapabilities(provider2.type, model2.model_id, model2.supports_vision ?? true);
      canUploadImage = canUploadImage && cap2.canUploadImage;
      canUploadPdf = canUploadPdf && cap2.canUploadPdf;
    }

    for (const file of Array.from(files)) {
      if (file.size > maxSize) {
        showToast('error', t('fileTooLarge', { name: file.name }));
        continue;
      }

      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf';

      // 检查文件类型是否被支持
      if (isImage && !canUploadImage) {
        showToast('error', t('modelsNotSupportImage'));
        continue;
      }
      if (isPdf && !canUploadPdf) {
        showToast('error', t('modelsNotSupportPdf'));
        continue;
      }
      if (!isImage && !isPdf) {
        showToast('error', t('unsupportedFileType', { name: file.name }));
        continue;
      }

      try {
        const attachment = await fileToBase64(file);
        setCompareFiles((prev) => [...prev, attachment]);
      } catch {
        showToast('error', t('fileReadFailed', { name: file.name }));
      }
    }
  };

  const removeCompareFile = (index: number) => {
    setCompareFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const tabs = [
    { id: 'edit' as TabType, label: t('tabEdit'), icon: <FileText className="w-4 h-4" /> },
    { id: 'observe' as TabType, label: t('tabHistory'), icon: <Eye className="w-4 h-4" /> },
    { id: 'optimize' as TabType, label: t('tabOptimize'), icon: <Sparkles className="w-4 h-4" /> },
  ];

  const renderAutoSaveStatus = () => {
    switch (autoSaveStatus) {
      case 'saved':
        return (
          <span className="flex items-center gap-1 text-xs text-green-400 light:text-green-600">
            <Check className="w-3 h-3" />
            {t('saved')}
          </span>
        );
      case 'saving':
        return (
          <span className="flex items-center gap-1 text-xs text-cyan-400 light:text-cyan-600">
            <Cloud className="w-3 h-3 animate-pulse" />
            {t('saving')}
          </span>
        );
      case 'unsaved':
        return (
          <span className="flex items-center gap-1 text-xs text-amber-400 light:text-amber-600">
            <CloudOff className="w-3 h-3" />
            {t('unsaved')}
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-1 text-xs text-red-400 light:text-red-600">
            <CloudOff className="w-3 h-3" />
            {t('saveFailed')}
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
              placeholder={t("searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-300 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <Button className="w-full" onClick={() => setShowNewPrompt(true)}>
            <Plus className="w-4 h-4" />
            <span>{t('newPrompt')}</span>
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
                  <span>{t('compare')}</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowVersions(true)}>
                  <History className="w-4 h-4" />
                  <span>{t('history')}</span>
                </Button>
                <Button variant="secondary" size="sm" onClick={handleSave} loading={saving}>
                  <Save className="w-4 h-4" />
                  <span>{t('submitNewVersion')}</span>
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
                      <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">{t('promptEditor')}</h3>
                      <p className="text-xs text-slate-500 light:text-slate-600 mt-1">
                        {t('multiMessageHint')}
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
                            placeholder={t('promptPlaceholder')}
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
                              {t('switchToMultiMessage')}
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
                        <span className="text-sm font-medium text-slate-300 light:text-slate-700">{t('runConfig')}</span>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                      {/* Model selector */}
                      <div className="p-3 bg-slate-800/50 light:bg-white rounded-lg border border-slate-700 light:border-slate-200">
                        <label className="block text-xs text-slate-400 light:text-slate-600 mb-2">
                          {t('runModel')}
                        </label>
                        <ModelSelector
                          models={models}
                          providers={providers}
                          selectedModelId={selectedModel}
                          onSelect={setSelectedModel}
                          placeholder={t("configureModelFirst")}
                        />
                      </div>

                      {/* Parameter panel */}
                      <ParameterPanel
                        config={promptConfig}
                        onChange={setPromptConfig}
                        modelId={models.find(m => m.id === selectedModel)?.model_id}
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
                      <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">{t('testAndOutput')}</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      {/* Variable values input */}
                      {promptVariables.length > 0 && (
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                            {t('variableValues')}
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
                                  placeholder={variable.default_value || variable.description || t('inputValuePlaceholder')}
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
                          {t('testInput')}
                        </label>
                        <textarea
                          value={testInput}
                          onChange={(e) => setTestInput(e.target.value)}
                          onPaste={handlePaste}
                          placeholder={t("inputPlaceholder")}
                          rows={4}
                          className="w-full p-3 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 resize-none focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      {/* Attachments */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                            {t('attachments')}
                          </label>
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                          >
                            <Paperclip className="w-3.5 h-3.5" />
                            {t('addFile')}
                          </button>
                        </div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept={fileUploadCapabilities.accept}
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
                                  <button
                                    type="button"
                                    onClick={() => setPreviewAttachment(file)}
                                    className="flex-1 flex items-center gap-2 min-w-0 hover:text-cyan-400 light:hover:text-cyan-600 transition-colors"
                                    title={t('clickToPreview')}
                                  >
                                    {file.type.startsWith('image/') ? (
                                      <img
                                        src={`data:${file.type};base64,${file.base64}`}
                                        alt={file.name}
                                        className="w-8 h-8 object-cover rounded flex-shrink-0"
                                      />
                                    ) : (
                                      <FileIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                    )}
                                    <span className="text-xs text-slate-300 light:text-slate-700 truncate">
                                      {file.name}
                                    </span>
                                    <Eye className="w-3 h-3 text-cyan-400 light:text-cyan-600 flex-shrink-0" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeFile(index);
                                    }}
                                    className="p-1 text-slate-500 hover:text-red-400 transition-colors flex-shrink-0"
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
                              {t('supportedFileTypes')}
                            </p>
                          </div>
                        )}
                      </div>

                      {running ? (
                        <Button className="w-full" variant="danger" onClick={handleStopRun}>
                          <X className="w-4 h-4" />
                          <span>{tCommon('stop')}</span>
                        </Button>
                      ) : (
                        <Button className="w-full" onClick={handleRun}>
                          <Play className="w-4 h-4" />
                          <span>{t('run')}</span>
                        </Button>
                      )}

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
                            {t('outputResult')}
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
                            {renderMarkdown ? t('markdown') : t('plainText')}
                          </button>
                        </div>
                        <div className="min-h-[300px] max-h-[500px] p-3 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-300 light:text-slate-700 overflow-y-auto">
                          {testOutput ? (
                            renderMarkdown ? (
                              <MarkdownRenderer content={testOutput} />
                            ) : (
                              <pre className="whitespace-pre-wrap font-mono">{testOutput}</pre>
                            )
                          ) : running ? (
                            <div className="flex items-center gap-2 text-slate-500 light:text-slate-600">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>{t('generating')}</span>
                            </div>
                          ) : (
                            <span className="text-slate-500 light:text-slate-600">{t('clickRunToSeeResult')}</span>
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
                      showToast('success', t('suggestionApplied'));
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
              <p className="text-slate-500 light:text-slate-600">{t('selectPromptToEdit')}</p>
            </div>
          </div>
        )}
      </div>

      {/* New Prompt Modal */}
      <Modal isOpen={showNewPrompt} onClose={() => setShowNewPrompt(false)} title={t("newPrompt")}>
        <div className="space-y-4">
          <Input
            label={t("promptName")}
            value={newPromptName}
            onChange={(e) => setNewPromptName(e.target.value)}
            placeholder={t("promptNamePlaceholder")}
            autoFocus
          />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setShowNewPrompt(false)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleCreatePrompt} disabled={!newPromptName.trim()}>
              {tCommon('create')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Version History Modal */}
      <Modal
        isOpen={showVersions}
        onClose={() => setShowVersions(false)}
        title={t('versionHistory')}
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
                {t('restore')}
              </Button>
            </div>
          ))}
          {versions.length === 0 && (
            <p className="text-center text-slate-500 light:text-slate-600 py-8">{t('noVersionHistory')}</p>
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
        title={t('promptCompare')}
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
              {t('sameVersionDiffModels')}
            </button>
            <button
              onClick={() => setCompareMode('versions')}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                compareMode === 'versions'
                  ? 'bg-cyan-500 text-white'
                  : 'text-slate-400 light:text-slate-600 hover:text-white light:hover:text-slate-900'
              }`}
            >
              {t('sameModelDiffVersions')}
            </button>
          </div>

          {compareMode === 'models' ? (
            <div className="space-y-3">
              <Select
                label={t('selectVersion')}
                value={compareVersion}
                onChange={(e) => setCompareVersion(e.target.value)}
                options={[
                  { value: '', label: t('selectVersion') },
                  ...versions.map((v) => ({
                    value: v.id,
                    label: `v${v.version} - ${new Date(v.created_at).toLocaleString('zh-CN')}`,
                  })),
                ]}
              />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-slate-300 light:text-slate-700">{t('modelA')}</label>
                  <ModelSelector
                    models={models}
                    providers={providers}
                    selectedModelId={compareModels[0]}
                    onSelect={(modelId) => setCompareModels([modelId, compareModels[1]])}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-slate-300 light:text-slate-700">{t('modelB')}</label>
                  <ModelSelector
                    models={models}
                    providers={providers}
                    selectedModelId={compareModels[1]}
                    onSelect={(modelId) => setCompareModels([compareModels[0], modelId])}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">{tCommon('selectModel')}</label>
                <ModelSelector
                  models={models}
                  providers={providers}
                  selectedModelId={compareModel}
                  onSelect={(modelId) => setCompareModel(modelId)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Select
                  label={t('versionA')}
                  value={compareVersions[0]}
                  onChange={(e) => setCompareVersions([e.target.value, compareVersions[1]])}
                  options={[
                    { value: '', label: t('selectVersion') },
                    ...versions.map((v) => ({
                      value: v.id,
                      label: `v${v.version} - ${new Date(v.created_at).toLocaleString('zh-CN')}`,
                    })),
                  ]}
                />
                <Select
                  label={t('versionB')}
                  value={compareVersions[1]}
                  onChange={(e) => setCompareVersions([compareVersions[0], e.target.value])}
                  options={[
                    { value: '', label: t('selectVersion') },
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
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700">{t('testInput')}</label>
            <textarea
              value={compareInput}
              onChange={(e) => setCompareInput(e.target.value)}
              placeholder={t('inputPlaceholder')}
              rows={3}
              className="w-full p-3 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 resize-none focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-300 light:text-slate-700">{t('attachments')}</label>
              <button
                type="button"
                onClick={() => compareFileInputRef.current?.click()}
                className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                <Paperclip className="w-3.5 h-3.5" />
                {t('addFile')}
              </button>
            </div>
            <input
              ref={compareFileInputRef}
              type="file"
              accept={compareFileUploadCapabilities.accept || 'image/*,application/pdf'}
              multiple
              onChange={handleCompareFileSelect}
              className="hidden"
              disabled={!compareFileUploadCapabilities.canUploadImage && !compareFileUploadCapabilities.canUploadPdf}
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

          {/* 模型参数配置 */}
          <Collapsible
            title={t('modelParameters')}
            icon={<Settings2 className="w-4 h-4 text-cyan-400 light:text-cyan-600" />}
            defaultOpen={false}
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3 p-3 bg-slate-800/30 light:bg-slate-50 rounded-lg border border-slate-700 light:border-slate-200">
                <p className="text-xs font-medium text-slate-400 light:text-slate-600">
                  {compareMode === 'models' ? (models.find((m) => m.id === compareModels[0])?.name || t('modelA')) : `v${versions.find((v) => v.id === compareVersions[0])?.version || 'A'}`}
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{t('temperature')}</span>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={compareParams.left.temperature}
                      onChange={(e) => setCompareParams((prev) => ({ ...prev, left: { ...prev.left, temperature: parseFloat(e.target.value) || 0 } }))}
                      className="w-16 px-2 py-1 text-xs bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-slate-200 light:text-slate-800"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{t('topP')}</span>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={compareParams.left.top_p}
                      onChange={(e) => setCompareParams((prev) => ({ ...prev, left: { ...prev.left, top_p: parseFloat(e.target.value) || 0 } }))}
                      className="w-16 px-2 py-1 text-xs bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-slate-200 light:text-slate-800"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{t('frequencyPenalty')}</span>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={compareParams.left.frequency_penalty}
                      onChange={(e) => setCompareParams((prev) => ({ ...prev, left: { ...prev.left, frequency_penalty: parseFloat(e.target.value) || 0 } }))}
                      className="w-16 px-2 py-1 text-xs bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-slate-200 light:text-slate-800"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{t('presencePenalty')}</span>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={compareParams.left.presence_penalty}
                      onChange={(e) => setCompareParams((prev) => ({ ...prev, left: { ...prev.left, presence_penalty: parseFloat(e.target.value) || 0 } }))}
                      className="w-16 px-2 py-1 text-xs bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-slate-200 light:text-slate-800"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{t('maxTokens')}</span>
                    <input
                      type="number"
                      min="1"
                      max="32000"
                      step="1"
                      value={compareParams.left.max_tokens}
                      onChange={(e) => setCompareParams((prev) => ({ ...prev, left: { ...prev.left, max_tokens: parseInt(e.target.value) || 4096 } }))}
                      className="w-20 px-2 py-1 text-xs bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-slate-200 light:text-slate-800"
                    />
                  </div>
                  {/* 推理配置 - 仅在模型支持时显示 */}
                  {(() => {
                    const leftModelId = compareMode === 'models'
                      ? models.find((m) => m.id === compareModels[0])?.model_id
                      : models.find((m) => m.id === selectedModel)?.model_id;
                    return leftModelId && inferReasoningSupport(leftModelId) && (
                      <div className="flex items-center justify-between pt-2 border-t border-slate-600 light:border-slate-300">
                        <span className="text-xs text-slate-500">{t('reasoningEffort')}</span>
                        <ReasoningSelector
                          modelId={leftModelId}
                          value={compareParams.left.reasoning?.effort || 'default'}
                          onChange={(effort) => {
                            setCompareParams((prev) => ({
                              ...prev,
                              left: {
                                ...prev.left,
                                reasoning: effort === 'default' ? undefined : { enabled: true, effort },
                              },
                            }));
                          }}
                        />
                      </div>
                    );
                  })()}
                </div>
              </div>
              <div className="space-y-3 p-3 bg-slate-800/30 light:bg-slate-50 rounded-lg border border-slate-700 light:border-slate-200">
                <p className="text-xs font-medium text-slate-400 light:text-slate-600">
                  {compareMode === 'models' ? (models.find((m) => m.id === compareModels[1])?.name || t('modelB')) : `v${versions.find((v) => v.id === compareVersions[1])?.version || 'B'}`}
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{t('temperature')}</span>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={compareParams.right.temperature}
                      onChange={(e) => setCompareParams((prev) => ({ ...prev, right: { ...prev.right, temperature: parseFloat(e.target.value) || 0 } }))}
                      className="w-16 px-2 py-1 text-xs bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-slate-200 light:text-slate-800"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{t('topP')}</span>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={compareParams.right.top_p}
                      onChange={(e) => setCompareParams((prev) => ({ ...prev, right: { ...prev.right, top_p: parseFloat(e.target.value) || 0 } }))}
                      className="w-16 px-2 py-1 text-xs bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-slate-200 light:text-slate-800"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{t('frequencyPenalty')}</span>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={compareParams.right.frequency_penalty}
                      onChange={(e) => setCompareParams((prev) => ({ ...prev, right: { ...prev.right, frequency_penalty: parseFloat(e.target.value) || 0 } }))}
                      className="w-16 px-2 py-1 text-xs bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-slate-200 light:text-slate-800"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{t('presencePenalty')}</span>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={compareParams.right.presence_penalty}
                      onChange={(e) => setCompareParams((prev) => ({ ...prev, right: { ...prev.right, presence_penalty: parseFloat(e.target.value) || 0 } }))}
                      className="w-16 px-2 py-1 text-xs bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-slate-200 light:text-slate-800"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{t('maxTokens')}</span>
                    <input
                      type="number"
                      min="1"
                      max="32000"
                      step="1"
                      value={compareParams.right.max_tokens}
                      onChange={(e) => setCompareParams((prev) => ({ ...prev, right: { ...prev.right, max_tokens: parseInt(e.target.value) || 4096 } }))}
                      className="w-20 px-2 py-1 text-xs bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-slate-200 light:text-slate-800"
                    />
                  </div>
                  {/* 推理配置 - 仅在模型支持时显示 */}
                  {(() => {
                    const rightModelId = compareMode === 'models'
                      ? models.find((m) => m.id === compareModels[1])?.model_id
                      : models.find((m) => m.id === selectedModel)?.model_id;
                    return rightModelId && inferReasoningSupport(rightModelId) && (
                      <div className="flex items-center justify-between pt-2 border-t border-slate-600 light:border-slate-300">
                        <span className="text-xs text-slate-500">{t('reasoningEffort')}</span>
                        <ReasoningSelector
                          modelId={rightModelId}
                          value={compareParams.right.reasoning?.effort || 'default'}
                          onChange={(effort) => {
                            setCompareParams((prev) => ({
                              ...prev,
                              right: {
                                ...prev.right,
                                reasoning: effort === 'default' ? undefined : { enabled: true, effort },
                              },
                            }));
                          }}
                        />
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </Collapsible>

          <div className="flex gap-2">
            <Button className="flex-1" onClick={handleRunComparison} loading={compareRunning.left || compareRunning.right}>
              <Play className="w-4 h-4" />
              <span>{t('run')}{t('compare')}</span>
            </Button>
            {(compareRunning.left || compareRunning.right) && (
              <Button variant="danger" onClick={() => handleStopComparison('both')}>
                <Square className="w-4 h-4" />
                <span>{t('stop')}</span>
              </Button>
            )}
          </div>

          {(compareResults.left || compareResults.right || compareRunning.left || compareRunning.right) && (
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-700 light:border-slate-200">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="info">
                      {compareMode === 'models'
                        ? models.find((m) => m.id === compareModels[0])?.name || 'A'
                        : `v${versions.find((v) => v.id === compareVersions[0])?.version || 'A'}`}
                    </Badge>
                    {compareRunning.left && (
                      <button
                        onClick={() => handleStopComparison('left')}
                        className="p-1 text-red-400 hover:text-red-300 transition-colors"
                        title={t('stop')}
                      >
                        <Square className="w-3 h-3" />
                      </button>
                    )}
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
                      <p className="font-medium">{t('error')}</p>
                      <p className="mt-1 text-xs">{compareResults.left.error}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(compareResults.left?.thinking || compareResults.left?.isThinking) && (
                        <ThinkingBlock
                          thinking={compareResults.left.thinking}
                          isStreaming={compareResults.left.isThinking}
                        />
                      )}
                      {compareResults.left?.content ? (
                        <MarkdownRenderer content={compareResults.left.content} />
                      ) : compareRunning.left ? (
                        !compareResults.left?.isThinking && (
                          <div className="flex items-center gap-2 text-slate-500 light:text-slate-600">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>{t('running')}</span>
                          </div>
                        )
                      ) : (
                        <div className="text-slate-500 light:text-slate-400 text-sm">{t('noResults')}</div>
                      )}
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
                    {compareRunning.right && (
                      <button
                        onClick={() => handleStopComparison('right')}
                        className="p-1 text-red-400 hover:text-red-300 transition-colors"
                        title={t('stop')}
                      >
                        <Square className="w-3 h-3" />
                      </button>
                    )}
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
                      <p className="font-medium">{t('error')}</p>
                      <p className="mt-1 text-xs">{compareResults.right.error}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(compareResults.right?.thinking || compareResults.right?.isThinking) && (
                        <ThinkingBlock
                          thinking={compareResults.right.thinking}
                          isStreaming={compareResults.right.isThinking}
                        />
                      )}
                      {compareResults.right?.content ? (
                        <MarkdownRenderer content={compareResults.right.content} />
                      ) : compareRunning.right ? (
                        !compareResults.right?.isThinking && (
                          <div className="flex items-center gap-2 text-slate-500 light:text-slate-600">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>{t('running')}</span>
                          </div>
                        )
                      ) : (
                        <div className="text-slate-500 light:text-slate-400 text-sm">{t('noResults')}</div>
                      )}
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
        title={t('callDetails')}
        size="lg"
      >
        {showDebugDetail && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('status')}</p>
                <Badge variant={showDebugDetail.status === 'success' ? 'success' : 'error'}>
                  {showDebugDetail.status === 'success' ? t('success') : t('error')}
                </Badge>
              </div>
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('latency')}</p>
                <p className="text-sm font-medium text-slate-200 light:text-slate-800">{showDebugDetail.latencyMs}ms</p>
              </div>
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('inputTokens')}</p>
                <p className="text-sm font-medium text-cyan-400 light:text-cyan-600">{showDebugDetail.tokensInput}</p>
              </div>
              <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('outputTokens')}</p>
                <p className="text-sm font-medium text-teal-400 light:text-teal-600">{showDebugDetail.tokensOutput}</p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-slate-300 light:text-slate-700">{t('input')}</h4>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setDebugDetailExpanded({ field: 'input', content: showDebugDetail.input })}
                    className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors"
                    title={tCommon('expand')}
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDebugDetailCopy(showDebugDetail.input, 'input')}
                    className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors"
                    title={tCommon('copy')}
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
                <h4 className="text-sm font-medium text-slate-300 light:text-slate-700">{t('output')}</h4>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setDebugDetailExpanded({ field: 'output', content: showDebugDetail.output })}
                    className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors"
                    title={tCommon('expand')}
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDebugDetailCopy(showDebugDetail.output, 'output')}
                    className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors"
                    title={tCommon('copy')}
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
                  <span className="text-sm text-slate-500 light:text-slate-400">{t('empty')}</span>
                )}
              </div>
            </div>

            {showDebugDetail.errorMessage && (
              <div>
                <h4 className="text-sm font-medium text-rose-400 light:text-rose-600 mb-2">{t('errorMessage')}</h4>
                <div className="p-4 bg-rose-500/10 light:bg-rose-50 border border-rose-500/30 light:border-rose-200 rounded-lg">
                  <pre className="text-sm text-rose-300 light:text-rose-700 whitespace-pre-wrap font-mono">
                    {showDebugDetail.errorMessage}
                  </pre>
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-slate-700 light:border-slate-200">
              <p className="text-xs text-slate-500 light:text-slate-600">
                {t('createdAt')}: {showDebugDetail.timestamp.toLocaleString('zh-CN')}
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Debug Detail Expanded Modal */}
      <Modal
        isOpen={!!debugDetailExpanded}
        onClose={() => setDebugDetailExpanded(null)}
        title={debugDetailExpanded?.field === 'input' ? t('input') : t('output')}
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
                    <span>{tCommon('copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>{tCommon('copy')}</span>
                  </>
                )}
              </button>
            </div>
            <div className="p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg max-h-[60vh] overflow-y-auto">
              {debugDetailExpanded.content ? (
                <MarkdownRenderer content={debugDetailExpanded.content} />
              ) : (
                <span className="text-sm text-slate-500 light:text-slate-400">{t('empty')}</span>
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
