import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { flushSync } from 'react-dom';
import {
  Play,
  RotateCcw,
  ArrowUp,
  GripHorizontal,
  Loader2,
  Paperclip,
  X,
  Image,
  File,
  Copy,
  GitCompare,
  Flag,
  ChevronLeft,
  ChevronRight,
  Square,
} from 'lucide-react';
import { Button, ModelSelector, OutputRenderer, OutputRendererControls, Select } from '../ui';
import { ThinkingBlock } from './ThinkingBlock';
import { AttachmentModal } from './AttachmentModal';
import { chatApi, type StreamCallbacks, type ContentPart } from '../../api/chat';
import { uploadFileAttachment, extractThinking, type FileAttachment } from '../../lib/ai-service';
import { useOutputRenderPreferences } from '../../lib/output-renderer-prefs';
import { toResponseFormat } from '../../lib/schema-utils';
import { getFileInputAccept, isSupportedFileType } from '../../lib/file-utils';
import { diffText, hasDiff, type DiffOp } from '../../lib/text-diff';
import { calculateAiCost, formatUsdCost, formatCostNumber, formatUsdCostFormula } from '../../lib/cost';
import { buildOcrProviderOptions, useEnabledOcrProviders } from '../../hooks/useEnabledOcrProviders';
import { useToast } from '../../store/useUIStore';
import type { ChatTranscriptMessage } from './ChatTranscript';
import type { PromptVariable, PromptConfig, OutputSchema } from '../../types/database';
import type { Provider, Model, OcrProvider } from '../../types';

type PromptRole = 'system' | 'user' | 'assistant';
type PromptMessageLike = { role: PromptRole; content: string };

type ChatMessageState = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  apiContent?: string | ContentPart[];
  attachments?: FileAttachment[];
  thinking?: string;
  modelId?: string;
  tokensInput?: number;
  tokensOutput?: number;
  costInput?: number | null;
  costOutput?: number | null;
  costTotal?: number | null;
  costCumulative?: number | null;
  costUnavailable?: boolean;
};

type ChatRun = {
  id: string;
  createdAt: number;
  modelId: string;
  presetMessages: Array<{ role: PromptRole; content: string }>;
  messages: ChatMessageState[];
};

type PromptTestPanelCacheState = {
  testMode: 'single' | 'chat';
  chatRuns: ChatRun[];
  chatInput: string;
  chatComposerHeight: number;
  baselineRunId: string | null;
  diffEnabled: boolean;
  diffOnlyChanges: boolean;
  diffShowDeletions: boolean;
  activeDiffIndex: number;
  fileProcessing: 'auto' | 'vision' | 'ocr' | 'none';
  ocrProviderOverride: OcrProvider | '';
};

const promptTestPanelCacheByPromptId = new Map<string, PromptTestPanelCacheState>();

export function resetPromptTestPanelCaches(): void {
  promptTestPanelCacheByPromptId.clear();
}

export interface PromptTestPanelProps {
  // Model selection
  models: Model[];
  providers: Provider[];
  selectedModelId: string;
  onModelSelect: (modelId: string) => void;
  recommendedModel?: { name: string; providerType: string } | null;
  showModelSelector?: boolean;

  // Variables
  variables: PromptVariable[];
  variableValues: Record<string, string>;
  onVariableValuesChange: (values: Record<string, string>) => void;

  // Test input
  testInput: string;
  onTestInputChange: (value: string) => void;

  // Prompt content to run
  promptText: string;
  // Prompt messages to run (multi-message mode)
  promptMessages?: PromptMessageLike[];

  // Config for the run
  config?: Partial<PromptConfig>;
  outputSchema?: OutputSchema;

  // Optional prompt ID for trace saving
  promptId?: string;

  // Save trace (default: false for plaza, true for development)
  saveTrace?: boolean;

  // Callback for when a run completes (for debug history)
  onRunComplete?: (result: {
    mode?: 'single' | 'chat';
    chatRunId?: string;
    messages?: ChatTranscriptMessage[];
    input: string;
    output: string;
    thinking?: string;
    latencyMs: number;
    tokensInput: number;
    tokensOutput: number;
    status: 'success' | 'error';
    errorMessage?: string;
    attachments?: FileAttachment[];
    ocrUsed?: boolean;
    ocrProvider?: OcrProvider;
  }) => void;

  // File attachments (optional, managed externally)
  attachedFiles?: FileAttachment[];
  onAttachedFilesChange?: (files: FileAttachment[]) => void;

  // Control file upload visibility
  showFileUpload?: boolean;

  // External output control (for syncing with debug history selection)
  externalOutput?: string;
  externalThinking?: string;
  onOutputChange?: (output: string) => void;
  onThinkingChange?: (thinking: string) => void;

  // Custom class name
  className?: string;
}

export function PromptTestPanel({
  models,
  providers,
  selectedModelId,
  onModelSelect,
  recommendedModel,
  showModelSelector = true,
  variables,
  variableValues,
  onVariableValuesChange,
  testInput,
  onTestInputChange,
  promptText,
  promptMessages,
  config,
  outputSchema,
  promptId,
  saveTrace = false,
  onRunComplete,
  attachedFiles: externalAttachedFiles,
  onAttachedFilesChange,
  showFileUpload = true,
  externalOutput,
  externalThinking,
  onOutputChange,
  onThinkingChange,
  className = '',
}: PromptTestPanelProps) {
  const { showToast } = useToast();
  const { t } = useTranslation('prompts');
  const { t: tEval } = useTranslation('evaluation');
  const { t: tCommon } = useTranslation('common');

  const cachedPanelState = promptId ? promptTestPanelCacheByPromptId.get(promptId) : undefined;

  // Internal state for output and running
  const [internalOutput, setInternalOutput] = useState('');
  const [internalThinking, setInternalThinking] = useState('');
  const [running, setRunning] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [lastSingleUsage, setLastSingleUsage] = useState<{ tokensInput: number; tokensOutput: number } | null>(null);
  const [lastSingleCost, setLastSingleCost] = useState<{
    inputCost: number | null;
    outputCost: number | null;
    totalCost: number | null;
    hasPricing: boolean;
  } | null>(null);
  const [outputRenderPrefs, setOutputRenderPrefs] = useOutputRenderPreferences('ssrprompt_output_render_prefs');
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachment | null>(null);
  const [processingStage, setProcessingStage] = useState<'idle' | 'ocr' | 'llm'>('idle');
  const [isUploading, setIsUploading] = useState(false);

  // Test mode + multi-turn state
  const [testMode, setTestMode] = useState<'single' | 'chat'>(cachedPanelState?.testMode ?? 'single');
  const [chatRuns, setChatRuns] = useState<ChatRun[]>(cachedPanelState?.chatRuns ?? []);
  const [chatInput, setChatInput] = useState(cachedPanelState?.chatInput ?? '');
  const [chatComposerHeight, setChatComposerHeight] = useState(cachedPanelState?.chatComposerHeight ?? 120);
  const [baselineRunId, setBaselineRunId] = useState<string | null>(cachedPanelState?.baselineRunId ?? null);
  const [diffEnabled, setDiffEnabled] = useState(cachedPanelState?.diffEnabled ?? false);
  const [diffOnlyChanges, setDiffOnlyChanges] = useState(cachedPanelState?.diffOnlyChanges ?? false);
  const [diffShowDeletions, setDiffShowDeletions] = useState(cachedPanelState?.diffShowDeletions ?? false);
  const [activeDiffIndex, setActiveDiffIndex] = useState(cachedPanelState?.activeDiffIndex ?? 0);
  const [isReplaying, setIsReplaying] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatComposerResizeRef = useRef<{ startY: number; startHeight: number; pointerId: number } | null>(null);

  // File attachments - use external state if provided, otherwise internal
  const [internalAttachedFiles, setInternalAttachedFiles] = useState<FileAttachment[]>([]);
  const attachedFiles = externalAttachedFiles ?? internalAttachedFiles;
  const setAttachedFiles = onAttachedFilesChange ?? setInternalAttachedFiles;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const runAbortControllerRef = useRef<AbortController | null>(null);
  const promptTestPanelCacheWriteReadyRef = useRef<string | undefined>(promptId);

  useEffect(() => {
    return () => {
      runAbortControllerRef.current?.abort();
    };
  }, []);

  // Use internal output while running to keep streaming responsive.
  const output = running ? internalOutput : (externalOutput ?? internalOutput);
  const thinking = running ? internalThinking : (externalThinking ?? internalThinking);

  const currentModel = useMemo(() => models.find((m) => m.id === selectedModelId) || null, [models, selectedModelId]);
  const supportsVision = currentModel?.supportsVision ?? false;
  const { enabledOcrProviders } = useEnabledOcrProviders();
  const ocrProviderOptions = useMemo(
    () => buildOcrProviderOptions(enabledOcrProviders, tEval, true),
    [enabledOcrProviders, tEval]
  );

  const currentChatRun = chatRuns[0] ?? null;
  const baselineChatRun = useMemo(
    () => (baselineRunId ? chatRuns.find((run) => run.id === baselineRunId) ?? null : null),
    [baselineRunId, chatRuns]
  );
  const [fileProcessing, setFileProcessing] = useState<'auto' | 'vision' | 'ocr' | 'none'>(cachedPanelState?.fileProcessing ?? 'auto');
  const [ocrProviderOverride, setOcrProviderOverride] = useState<OcrProvider | ''>(cachedPanelState?.ocrProviderOverride ?? '');

  useEffect(() => {
    if (!promptId) return;

    runAbortControllerRef.current?.abort();
    setRunning(false);
    setIsThinking(false);
    setProcessingStage('idle');
    setIsReplaying(false);
    setPreviewAttachment(null);
    setLastLatencyMs(null);
    setInternalThinking('');
    setInternalOutput('');

    const cached = promptTestPanelCacheByPromptId.get(promptId);

    if (!cached) {
      setTestMode('single');
      setChatRuns([]);
      setChatInput('');
      setChatComposerHeight(120);
      setBaselineRunId(null);
      setDiffEnabled(false);
      setDiffOnlyChanges(false);
      setDiffShowDeletions(false);
      setActiveDiffIndex(0);
      setFileProcessing('auto');
      setOcrProviderOverride('');
      return;
    }

    setTestMode(cached.testMode);
    setChatRuns(cached.chatRuns);
    setChatInput(cached.chatInput);
    setChatComposerHeight(cached.chatComposerHeight);
    setBaselineRunId(cached.baselineRunId);
    setDiffEnabled(cached.diffEnabled);
    setDiffOnlyChanges(cached.diffOnlyChanges);
    setDiffShowDeletions(cached.diffShowDeletions);
    setActiveDiffIndex(cached.activeDiffIndex);
    setFileProcessing(cached.fileProcessing);
    setOcrProviderOverride(cached.ocrProviderOverride);
  }, [promptId]);

  useEffect(() => {
    if (!promptId) return;

    // Skip the first write on promptId change to avoid overwriting the next prompt's cache with the previous state.
    if (promptTestPanelCacheWriteReadyRef.current !== promptId) {
      promptTestPanelCacheWriteReadyRef.current = promptId;
      return;
    }

    promptTestPanelCacheByPromptId.set(promptId, {
      testMode,
      chatRuns,
      chatInput,
      chatComposerHeight,
      baselineRunId,
      diffEnabled,
      diffOnlyChanges,
      diffShowDeletions,
      activeDiffIndex,
      fileProcessing,
      ocrProviderOverride,
    });
  }, [
    activeDiffIndex,
    baselineRunId,
    chatComposerHeight,
    chatInput,
    chatRuns,
    diffEnabled,
    diffOnlyChanges,
    diffShowDeletions,
    fileProcessing,
    ocrProviderOverride,
    promptId,
    testMode,
  ]);
  const hasBinaryAttachments = useMemo(() => (
    attachedFiles.some((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
  ), [attachedFiles]);

  const resolvedFileMode = useMemo((): 'vision' | 'ocr' | 'none' => {
    if (fileProcessing === 'none') return 'none';
    if (fileProcessing === 'vision') return 'vision';
    if (fileProcessing === 'ocr') return 'ocr';
    return supportsVision ? 'vision' : 'ocr';
  }, [fileProcessing, supportsVision]);

  const diffByAssistantMessageId = useMemo(() => {
    const map = new Map<string, { base: string; ops: DiffOp[]; changed: boolean }>();
    if (!diffEnabled || !baselineChatRun || !currentChatRun) return map;

    const baselineAssistants = baselineChatRun.messages.filter((m) => m.role === 'assistant');
    let assistantIndex = 0;

    for (const message of currentChatRun.messages) {
      if (message.role !== 'assistant') continue;
      const base = baselineAssistants[assistantIndex]?.content ?? '';
      const ops = diffText(base, message.content);
      const changed = base ? hasDiff(ops) : message.content.trim().length > 0;
      map.set(message.id, { base, ops, changed });
      assistantIndex++;
    }

    return map;
  }, [baselineChatRun, currentChatRun, diffEnabled]);

  const changedAssistantMessageIds = useMemo(() => (
    Array.from(diffByAssistantMessageId.entries())
      .filter(([, v]) => v.changed)
      .map(([id]) => id)
  ), [diffByAssistantMessageId]);

  useEffect(() => {
    if (!baselineRunId) {
      setDiffEnabled(false);
      setActiveDiffIndex(0);
      return;
    }

    setDiffEnabled(true);
    setActiveDiffIndex(0);
  }, [baselineRunId]);

  useEffect(() => {
    if (!diffEnabled) return;
    if (activeDiffIndex < changedAssistantMessageIds.length) return;
    setActiveDiffIndex(0);
  }, [activeDiffIndex, changedAssistantMessageIds.length, diffEnabled]);

  useEffect(() => {
    if (!diffEnabled) return;
    const targetId = changedAssistantMessageIds[activeDiffIndex];
    if (!targetId) return;
    const el = document.getElementById(`assistant-${targetId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeDiffIndex, changedAssistantMessageIds, diffEnabled]);

  useEffect(() => {
    if (testMode !== 'chat') return;
    chatEndRef.current?.scrollIntoView({ behavior: running ? 'auto' : 'smooth', block: 'end' });
  }, [currentChatRun?.messages.length, running, testMode]);

  useEffect(() => {
    if (fileProcessing === 'vision' && !supportsVision) {
      setFileProcessing('auto');
    }
  }, [fileProcessing, supportsVision]);

  useEffect(() => {
    if (!ocrProviderOverride) return;
    if (enabledOcrProviders.includes(ocrProviderOverride)) return;
    setOcrProviderOverride('');
  }, [enabledOcrProviders, ocrProviderOverride]);

  useEffect(() => {
    // Reset chat session when switching between prompts.
    setChatRuns([]);
    setChatInput('');
    setChatComposerHeight(120);
    setBaselineRunId(null);
    setDiffEnabled(false);
    setDiffOnlyChanges(false);
    setDiffShowDeletions(false);
    setActiveDiffIndex(0);
    setIsReplaying(false);
  }, [promptId]);

  // Replace variables in prompt
  const replaceVariables = useCallback((prompt: string, values: Record<string, string>) => {
    let result = prompt;
    for (const [key, value] of Object.entries(values)) {
      result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
    }
    // Also replace variables with their default values if not provided
    for (const variable of variables) {
      if (!values[variable.name] && variable.default_value) {
        result = result.replace(new RegExp(`\\{\\{\\s*${variable.name}\\s*\\}\\}`, 'g'), variable.default_value);
      }
    }
    return result;
  }, [variables]);

  const buildPresetMessages = useCallback((): Array<{ role: PromptRole; content: string }> => {
    const values = variableValues;

    if (promptMessages && promptMessages.length > 0) {
      return promptMessages
        .map((m) => ({
          role: m.role,
          content: replaceVariables(m.content, values).trimEnd(),
        }))
        .filter((m) => m.content.trim().length > 0);
    }

    const content = replaceVariables(promptText, values).trimEnd();
    if (!content.trim()) return [];
    return [{ role: 'system', content }];
  }, [promptMessages, promptText, replaceVariables, variableValues]);

  const buildUserApiContent = useCallback((text: string, withAttachments: boolean): string | ContentPart[] => {
    if (!withAttachments || attachedFiles.length === 0) return text;

    const contentParts: ContentPart[] = [{ type: 'text' as const, text }];
    for (const file of attachedFiles) {
      contentParts.push({
        type: 'file_ref' as const,
        file_ref: { fileId: file.fileId },
      });
    }
    return contentParts;
  }, [attachedFiles]);

  const toApiChatMessages = useCallback((messages: ChatMessageState[]) => (
    messages.map((m) => ({
      role: m.role,
      content: m.apiContent ?? m.content,
    } satisfies { role: PromptRole; content: string | ContentPart[] }))
  ), []);

  const handleStopRun = () => {
    runAbortControllerRef.current?.abort();
  };

  const handleRunSingle = async () => {
    if (!selectedModelId) {
      showToast('error', t('configureModelFirst'));
      return;
    }

    const model = models.find((m) => m.id === selectedModelId);
    const provider = providers.find((p) => p.id === model?.providerId);

    if (!model || !provider) {
      showToast('error', t('configureModelProviderFirst'));
      return;
    }

    runAbortControllerRef.current?.abort();
    const runAbortController = new AbortController();
    runAbortControllerRef.current = runAbortController;

    setRunning(true);
    setLastLatencyMs(null);
    setLastSingleUsage(null);
    setLastSingleCost(null);
    setInternalOutput('');
    setInternalThinking('');
    setIsThinking(false);
    onOutputChange?.('');
    onThinkingChange?.('');

    const startTime = Date.now();

    try {
      const resolveFileMode = (supportsVision: boolean): 'vision' | 'ocr' | 'none' => {
        if (fileProcessing === 'none') return 'none';
        if (fileProcessing === 'vision') return 'vision';
        if (fileProcessing === 'ocr') return 'ocr';
        return supportsVision ? 'vision' : 'ocr';
      };

      const effectiveMode = resolveFileMode(model.supportsVision ?? true);
      const runNeedsOcr = attachedFiles.length > 0 && hasBinaryAttachments && effectiveMode === 'ocr';
      setProcessingStage(runNeedsOcr ? 'ocr' : 'llm');
      const runOcrUsed = runNeedsOcr;
      const runOcrProvider = runNeedsOcr ? (ocrProviderOverride || undefined) : undefined;

      // Replace variables in prompt
      const finalPrompt = replaceVariables(promptText, variableValues);
      const fullPrompt = testInput ? `${finalPrompt}\n\n${testInput}` : finalPrompt;

      // Build user message content with attachments
      let userContent: string | ContentPart[] = fullPrompt;

      if (attachedFiles.length > 0) {
        const contentParts: ContentPart[] = [
          { type: 'text' as const, text: fullPrompt }
        ];
        for (const file of attachedFiles) {
          contentParts.push({
            type: 'file_ref' as const,
            file_ref: { fileId: file.fileId },
          });
        }
        userContent = contentParts;
      }

      let fullContent = '';
      let accumulatedThinking = '';
      let isCurrentlyThinking = false;
      let latestOutput = '';
      let latestThinking = '';

      const callbacks: StreamCallbacks = {
        onToken: (token) => {
          setProcessingStage((prev) => (prev === 'ocr' ? 'llm' : prev));
          fullContent += token;

          // When receiving content, end thinking state
          if (isCurrentlyThinking) {
            isCurrentlyThinking = false;
            flushSync(() => {
              setIsThinking(false);
            });
          }

          // Extract thinking content (for text tag format like <think>)
          const { thinking: extractedThinking, content } = extractThinking(fullContent);

          if (extractedThinking && extractedThinking !== accumulatedThinking) {
            accumulatedThinking = extractedThinking;
            latestThinking = extractedThinking;
            setInternalThinking(extractedThinking);
          }

          // Show content without thinking tags - use flushSync for streaming render
          latestOutput = content;
          flushSync(() => {
            setInternalOutput(content);
          });
        },
        onThinkingToken: (token) => {
          setProcessingStage((prev) => (prev === 'ocr' ? 'llm' : prev));
          // Streaming thinking content (for OpenRouter reasoning field)
          if (!isCurrentlyThinking) {
            isCurrentlyThinking = true;
            flushSync(() => {
              setIsThinking(true);
            });
          }
          accumulatedThinking += token;
          latestThinking = accumulatedThinking;
          flushSync(() => {
            setInternalThinking(accumulatedThinking);
          });
        },
        onComplete: async (result) => {
          runAbortControllerRef.current = null;
          setProcessingStage('idle');
          const latencyMs = Date.now() - startTime;

          // Get token counts from usage
          const tokensInput = result.usage?.prompt_tokens || 0;
          const tokensOutput = result.usage?.completion_tokens || 0;
          const runCost = calculateAiCost(tokensInput, tokensOutput, {
            inputPricePerM: model.inputPricePerM,
            outputPricePerM: model.outputPricePerM,
          });

          // Extract final thinking content
          const { thinking: extractedThinking, content } = extractThinking(result.content);
          const finalThinking = result.thinking || extractedThinking || accumulatedThinking;

          latestThinking = finalThinking;
          setInternalThinking(finalThinking);
          setIsThinking(false);

          setLastLatencyMs(latencyMs);
          setLastSingleUsage({ tokensInput, tokensOutput });
          setLastSingleCost({
            inputCost: runCost.inputCost,
            outputCost: runCost.outputCost,
            totalCost: runCost.totalCost,
            hasPricing: runCost.hasPricing,
          });
          latestOutput = content;
          setInternalOutput(content);
          onThinkingChange?.(finalThinking);
          onOutputChange?.(content);

          // Call onRunComplete callback
          onRunComplete?.({
            mode: 'single',
            input: testInput,
            output: content,
            thinking: finalThinking || undefined,
            latencyMs,
            tokensInput,
            tokensOutput,
            status: 'success',
            attachments: attachedFiles.length > 0 ? [...attachedFiles] : undefined,
            ocrUsed: runOcrUsed,
            ocrProvider: runOcrProvider,
          });

          setRunning(false);
          showToast('success', t('runComplete'));
        },
        onAbort: () => {
          runAbortControllerRef.current = null;
          setProcessingStage('idle');
          setIsThinking(false);
          setLastLatencyMs(Date.now() - startTime);
          setLastSingleUsage(null);
          setLastSingleCost(null);
          onThinkingChange?.(latestThinking);
          onOutputChange?.(latestOutput);
          setRunning(false);
          showToast('info', t('runStopped'));
        },
        onError: async (error) => {
          runAbortControllerRef.current = null;
          setProcessingStage('idle');
          const errorMessage = error.message;
          const errorOutput = `**[${t('error')}]**\n\n${errorMessage}\n\n${t('errorCheckList')}`;
          latestOutput = errorOutput;
          setLastLatencyMs(Date.now() - startTime);
          setLastSingleUsage({ tokensInput: 0, tokensOutput: 0 });
          setLastSingleCost({
            inputCost: null,
            outputCost: null,
            totalCost: null,
            hasPricing: false,
          });
          setInternalOutput(errorOutput);
          onThinkingChange?.('');
          onOutputChange?.(errorOutput);

          // Call onRunComplete callback with error
          onRunComplete?.({
            mode: 'single',
            input: testInput,
            output: '',
            latencyMs: Date.now() - startTime,
            tokensInput: 0,
            tokensOutput: 0,
            status: 'error',
            errorMessage,
            attachments: attachedFiles.length > 0 ? [...attachedFiles] : undefined,
            ocrUsed: runOcrUsed,
            ocrProvider: runOcrProvider,
          });

          setRunning(false);
          showToast('error', t('runFailed') + ': ' + errorMessage);
        },
      };

      await chatApi.streamWithCallbacks(
        {
          modelId: model.id,
          messages: [{ role: 'user', content: userContent }],
          promptId,
          temperature: config?.temperature,
          top_p: config?.top_p,
          max_tokens: config?.max_tokens,
          frequency_penalty: config?.frequency_penalty,
          presence_penalty: config?.presence_penalty,
          reasoning: config?.reasoning?.enabled && config?.reasoning?.effort !== 'default'
            ? { enabled: true, effort: config.reasoning.effort }
            : undefined,
          responseFormat: outputSchema?.enabled
            ? toResponseFormat(outputSchema)
            : undefined,
          saveTrace,
          fileProcessing,
          ocrProvider: ocrProviderOverride || undefined,
        },
        callbacks,
        runAbortController.signal
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('unknownError');
      const errorOutput = `**[${t('error')}]**\n\n${errorMessage}\n\n${t('errorCheckList')}`;
      setInternalOutput(errorOutput);
      onThinkingChange?.('');
      onOutputChange?.(errorOutput);
      setProcessingStage('idle');
      setRunning(false);
      showToast('error', t('runFailed') + ': ' + errorMessage);
    }
  };

  const handleAddFileClick = () => {
    fileInputRef.current?.click();
  };

  const upsertChatRun = useCallback((runId: string, updater: (run: ChatRun) => ChatRun) => {
    setChatRuns((prev) => {
      const index = prev.findIndex((r) => r.id === runId);
      if (index === -1) return prev;
      const next = [...prev];
      next[index] = updater(prev[index]);
      return next;
    });
  }, []);

  const applyAssistantCost = useCallback((messages: ChatMessageState[], args: {
    assistantMessageId: string;
    tokensInput: number;
    tokensOutput: number;
    inputCost: number | null;
    outputCost: number | null;
    totalCost: number | null;
    hasPricing: boolean;
  }): ChatMessageState[] => {
    const withCurrent = messages.map((message) => {
      if (message.role !== 'assistant' || message.id !== args.assistantMessageId) return message;
      return {
        ...message,
        tokensInput: args.tokensInput,
        tokensOutput: args.tokensOutput,
        costInput: args.inputCost,
        costOutput: args.outputCost,
        costTotal: args.totalCost,
        costUnavailable: !args.hasPricing,
      };
    });

    let cumulative = 0;
    let hasUnknown = false;

    return withCurrent.map((message) => {
      if (message.role !== 'assistant') return message;

      if (typeof message.costTotal === 'number') {
        if (!hasUnknown) {
          cumulative += message.costTotal;
        }
      } else {
        hasUnknown = true;
      }

      return {
        ...message,
        costCumulative: hasUnknown ? null : cumulative,
      };
    });
  }, []);

  const runChatCompletion = useCallback(async (opts: {
    runId: string;
    assistantMessageId: string;
    userMessageId: string;
    userInput: string;
    userApiContent: string | ContentPart[];
    history: ChatMessageState[];
    withAttachments: boolean;
    presetMessages?: Array<{ role: PromptRole; content: string }>;
    signal: AbortSignal;
  }) => {
    const { runId, assistantMessageId, userMessageId, userInput, userApiContent, history, signal } = opts;

    const model = models.find((m) => m.id === selectedModelId);
    const provider = providers.find((p) => p.id === model?.providerId);
    if (!model || !provider) {
      throw new Error(t('configureModelProviderFirst'));
    }

    upsertChatRun(runId, (run) => (run.modelId === model.id ? run : { ...run, modelId: model.id }));

    const preset = opts.presetMessages ?? buildPresetMessages();

    const resolveFileMode = (supportsVision: boolean): 'vision' | 'ocr' | 'none' => {
      if (fileProcessing === 'none') return 'none';
      if (fileProcessing === 'vision') return 'vision';
      if (fileProcessing === 'ocr') return 'ocr';
      return supportsVision ? 'vision' : 'ocr';
    };

    const effectiveMode = resolveFileMode(model.supportsVision ?? true);
    const runNeedsOcr = attachedFiles.length > 0 && hasBinaryAttachments && effectiveMode === 'ocr';
    setProcessingStage(runNeedsOcr ? 'ocr' : 'llm');

    const startTime = Date.now();
    let fullContent = '';
    let accumulatedThinking = '';
    let isCurrentlyThinking = false;
    let latestAssistantContent = '';
    let latestThinking = '';
    let lastUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
    let aborted = false;
    let streamError: Error | null = null;

    const callbacks: StreamCallbacks = {
      onToken: (token) => {
        setProcessingStage((prev) => (prev === 'ocr' ? 'llm' : prev));
        fullContent += token;

        if (isCurrentlyThinking) {
          isCurrentlyThinking = false;
          flushSync(() => setIsThinking(false));
        }

        const { thinking: extractedThinking, content } = extractThinking(fullContent);
        if (extractedThinking && extractedThinking !== accumulatedThinking) {
          accumulatedThinking = extractedThinking;
          latestThinking = extractedThinking;
          flushSync(() => setInternalThinking(extractedThinking));
        }

        latestAssistantContent = content;
        flushSync(() => {
          upsertChatRun(runId, (run) => {
            const messages = run.messages.map((m) => {
              if (m.id !== assistantMessageId) return m;
              return { ...m, content };
            });
            return { ...run, messages };
          });
        });
      },
      onThinkingToken: (token) => {
        setProcessingStage((prev) => (prev === 'ocr' ? 'llm' : prev));
        if (!isCurrentlyThinking) {
          isCurrentlyThinking = true;
          flushSync(() => setIsThinking(true));
        }
        accumulatedThinking += token;
        latestThinking = accumulatedThinking;
        flushSync(() => setInternalThinking(accumulatedThinking));
      },
      onComplete: (result) => {
        lastUsage = result.usage;

        const { thinking: extractedThinking, content } = extractThinking(result.content);
        const finalThinking = result.thinking || extractedThinking || accumulatedThinking;

        latestAssistantContent = content;
        latestThinking = finalThinking || '';

        flushSync(() => {
          setInternalThinking(latestThinking);
          setIsThinking(false);
        });

        upsertChatRun(runId, (run) => {
          const messages = run.messages.map((m) => {
            if (m.id !== assistantMessageId) return m;
            return { ...m, content, thinking: finalThinking || undefined };
          });
          return { ...run, messages };
        });
      },
      onAbort: () => {
        aborted = true;
        flushSync(() => setIsThinking(false));
      },
      onError: (error) => {
        streamError = error;
        flushSync(() => setIsThinking(false));
      },
    };

    const apiMessages = [
      ...preset.map((m) => ({ role: m.role, content: m.content } as const)),
      ...toApiChatMessages(history),
      { role: 'user' as const, content: userApiContent },
    ];

    const traceMessageMeta = [
      ...preset.map(() => ({})),
      ...history.map((m) => (m.role === 'assistant' ? { modelId: m.modelId, thinking: m.thinking } : {})),
      {},
    ];

    await chatApi.streamWithCallbacks(
      {
        modelId: model.id,
        messages: apiMessages,
        traceMessageMeta,
        promptId,
        chatRunId: runId,
        temperature: config?.temperature,
        top_p: config?.top_p,
        max_tokens: config?.max_tokens,
        frequency_penalty: config?.frequency_penalty,
        presence_penalty: config?.presence_penalty,
        reasoning: config?.reasoning?.enabled && config?.reasoning?.effort !== 'default'
          ? { enabled: true, effort: config.reasoning.effort }
          : undefined,
        responseFormat: outputSchema?.enabled ? toResponseFormat(outputSchema) : undefined,
        saveTrace,
        fileProcessing,
        ocrProvider: ocrProviderOverride || undefined,
      },
      callbacks,
      signal
    );

    if (aborted) {
      setProcessingStage('idle');
      throw new Error(t('runStopped'));
    }
    if (streamError) {
      setProcessingStage('idle');
      throw streamError;
    }

    const latencyMs = Date.now() - startTime;
    const tokensInput = lastUsage?.prompt_tokens || 0;
    const tokensOutput = lastUsage?.completion_tokens || 0;
    const cost = calculateAiCost(tokensInput, tokensOutput, {
      inputPricePerM: model.inputPricePerM,
      outputPricePerM: model.outputPricePerM,
    });

    upsertChatRun(runId, (run) => ({
      ...run,
      messages: applyAssistantCost(run.messages, {
        assistantMessageId,
        tokensInput,
        tokensOutput,
        inputCost: cost.inputCost,
        outputCost: cost.outputCost,
        totalCost: cost.totalCost,
        hasPricing: cost.hasPricing,
      }),
    }));

    const resolveAssistantLabel = (modelId?: string) => {
      if (!modelId) return undefined;
      return models.find((m) => m.id === modelId)?.name || modelId;
    };

    const transcript: ChatTranscriptMessage[] = [
      ...preset.map((m, index) => ({
        id: `preset_${index}`,
        role: m.role,
        content: m.content,
      })),
      ...history.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachments: m.attachments,
        thinking: m.thinking,
        modelId: m.modelId,
        assistantLabel: m.role === 'assistant' ? resolveAssistantLabel(m.modelId) : undefined,
      })),
      {
        id: userMessageId,
        role: 'user',
        content: userInput,
        attachments: opts.withAttachments && attachedFiles.length > 0 ? [...attachedFiles] : undefined,
      },
      {
        id: assistantMessageId,
        role: 'assistant',
        content: latestAssistantContent,
        thinking: latestThinking || undefined,
        modelId: model.id,
        assistantLabel: resolveAssistantLabel(model.id),
      },
    ];

    onRunComplete?.({
      mode: 'chat',
      chatRunId: runId,
      messages: transcript,
      input: userInput,
      output: latestAssistantContent,
      thinking: latestThinking || undefined,
      latencyMs,
      tokensInput,
      tokensOutput,
      status: 'success',
      attachments: opts.withAttachments && attachedFiles.length > 0 ? [...attachedFiles] : undefined,
      ocrUsed: runNeedsOcr,
      ocrProvider: runNeedsOcr ? (ocrProviderOverride || undefined) : undefined,
    });

    return {
      content: latestAssistantContent,
      thinking: latestThinking,
      latencyMs,
      tokensInput,
      tokensOutput,
      costInput: cost.inputCost,
      costOutput: cost.outputCost,
      costTotal: cost.totalCost,
      costUnavailable: !cost.hasPricing,
    };
  }, [
    applyAssistantCost,
    attachedFiles,
    buildPresetMessages,
    config?.frequency_penalty,
    config?.max_tokens,
    config?.presence_penalty,
    config?.reasoning?.enabled,
    config?.reasoning?.effort,
    config?.temperature,
    config?.top_p,
    fileProcessing,
    hasBinaryAttachments,
    models,
    ocrProviderOverride,
    onRunComplete,
    outputSchema,
    promptId,
    providers,
    saveTrace,
    selectedModelId,
    t,
    toApiChatMessages,
    upsertChatRun,
  ]);

  const handleChatReset = () => {
    setChatRuns([]);
    setChatInput('');
    setBaselineRunId(null);
    setDiffEnabled(false);
    setActiveDiffIndex(0);
  };

  const handleChatRunFirstTurn = async () => {
    if (!selectedModelId) {
      showToast('error', t('configureModelFirst'));
      return;
    }

    const resolvedPreset = buildPresetMessages();
    let runPresetMessages = resolvedPreset;
    let firstUserText = testInput;

    if (!testInput.trim() && resolvedPreset.length > 0 && resolvedPreset[resolvedPreset.length - 1].role === 'user') {
      const lastUser = resolvedPreset[resolvedPreset.length - 1];
      runPresetMessages = resolvedPreset.slice(0, -1);
      firstUserText = lastUser.content;
    }

    setChatInput('');

    runAbortControllerRef.current?.abort();
    const runAbortController = new AbortController();
    runAbortControllerRef.current = runAbortController;

    const runId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const userMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const assistantMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const userApiContent = buildUserApiContent(firstUserText, true);

    const newRun: ChatRun = {
      id: runId,
      createdAt: Date.now(),
      modelId: selectedModelId,
      presetMessages: runPresetMessages,
      messages: [
        {
          id: userMessageId,
          role: 'user',
          content: firstUserText,
          apiContent: userApiContent,
          attachments: attachedFiles.length > 0 ? [...attachedFiles] : undefined,
        },
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          modelId: selectedModelId,
        },
      ],
    };

    setChatRuns((prev) => [newRun, ...prev].slice(0, 20));
    setRunning(true);
    setInternalThinking('');
    setIsThinking(false);
    setProcessingStage('llm');

    try {
      await runChatCompletion({
        runId,
        assistantMessageId,
        userMessageId,
        userInput: firstUserText,
        userApiContent,
        history: [],
        withAttachments: true,
        presetMessages: runPresetMessages,
        signal: runAbortController.signal,
      });

      setRunning(false);
      setProcessingStage('idle');
      showToast('success', t('runComplete'));
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('unknownError');
      if (errorMessage === t('runStopped')) {
        showToast('info', t('runStopped'));
      } else {
        showToast('error', t('runFailed') + ': ' + errorMessage);
      }
      setRunning(false);
      setProcessingStage('idle');
    }
  };

  const handleChatSend = async () => {
    if (!currentChatRun) {
      showToast('error', t('runFirstTurnFirst'));
      return;
    }

    const text = chatInput.trim();
    if (!text) return;

    runAbortControllerRef.current?.abort();
    const runAbortController = new AbortController();
    runAbortControllerRef.current = runAbortController;

    const assistantMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const userMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const history = [...currentChatRun.messages];

    // Optimistically append messages to UI
    upsertChatRun(currentChatRun.id, (run) => ({
      ...run,
      messages: [
        ...run.messages,
        { id: userMessageId, role: 'user', content: text },
        { id: assistantMessageId, role: 'assistant', content: '', modelId: selectedModelId },
      ],
    }));

    setChatInput('');
    setRunning(true);
    setInternalThinking('');
    setIsThinking(false);
    setProcessingStage('llm');

    try {
      await runChatCompletion({
        runId: currentChatRun.id,
        assistantMessageId,
        userMessageId,
        userInput: text,
        userApiContent: text,
        history,
        withAttachments: false,
        presetMessages: currentChatRun.presetMessages,
        signal: runAbortController.signal,
      });

      setRunning(false);
      setProcessingStage('idle');
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('unknownError');
      if (errorMessage === t('runStopped')) {
        showToast('info', t('runStopped'));
      } else {
        showToast('error', t('runFailed') + ': ' + errorMessage);
      }
      setRunning(false);
      setProcessingStage('idle');
    }
  };

  const handleChatReplay = async () => {
    setChatInput('');
    const baseRun = currentChatRun;
    const userScript = baseRun?.messages.filter((m) => m.role === 'user').map((m) => m.content) ?? [];
    if (userScript.length === 0) {
      if (testInput.trim()) {
        userScript.push(testInput.trim());
      }
    }
    if (userScript.length === 0) {
      showToast('error', t('writeTestInputFirst'));
      return;
    }

    if (!selectedModelId) {
      showToast('error', t('configureModelFirst'));
      return;
    }

    runAbortControllerRef.current?.abort();
    const runAbortController = new AbortController();
    runAbortControllerRef.current = runAbortController;

    const resolvedPreset = buildPresetMessages();
    let runPresetMessages = resolvedPreset;
    if (
      userScript.length > 0 &&
      resolvedPreset.length > 0 &&
      resolvedPreset[resolvedPreset.length - 1].role === 'user' &&
      resolvedPreset[resolvedPreset.length - 1].content.trim() === userScript[0]?.trim()
    ) {
      runPresetMessages = resolvedPreset.slice(0, -1);
    }

    const runId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const newRun: ChatRun = {
      id: runId,
      createdAt: Date.now(),
      modelId: selectedModelId,
      presetMessages: runPresetMessages,
      messages: [],
    };
    setChatRuns((prev) => [newRun, ...prev].slice(0, 20));
    setIsReplaying(true);
    setRunning(true);
    setInternalThinking('');
    setIsThinking(false);
    setProcessingStage('llm');

    try {
      let history: ChatMessageState[] = [];

      for (let i = 0; i < userScript.length; i++) {
        const userText = userScript[i];
        const userMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const assistantMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

        const withAttachments = i === 0;
        const userApiContent = withAttachments ? buildUserApiContent(userText, true) : userText;

        upsertChatRun(runId, (run) => ({
          ...run,
          messages: [
            ...run.messages,
            {
              id: userMessageId,
              role: 'user',
              content: userText,
              apiContent: userApiContent,
              attachments: withAttachments && attachedFiles.length > 0 ? [...attachedFiles] : undefined,
            },
            { id: assistantMessageId, role: 'assistant', content: '', modelId: selectedModelId },
          ],
        }));

        const completion = await runChatCompletion({
          runId,
          assistantMessageId,
          userMessageId,
          userInput: userText,
          userApiContent,
          history,
          withAttachments,
          presetMessages: runPresetMessages,
          signal: runAbortController.signal,
        });

        history = [
          ...history,
          {
            id: userMessageId,
            role: 'user',
            content: userText,
            apiContent: userApiContent,
            attachments: withAttachments && attachedFiles.length > 0 ? [...attachedFiles] : undefined,
          },
          {
            id: assistantMessageId,
            role: 'assistant',
            content: completion.content,
            thinking: completion.thinking || undefined,
            modelId: selectedModelId,
          },
        ];
      }

      setRunning(false);
      setProcessingStage('idle');
      showToast('success', t('runComplete'));
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('unknownError');
      if (errorMessage === t('runStopped')) {
        showToast('info', t('runStopped'));
      } else {
        showToast('error', t('runFailed') + ': ' + errorMessage);
      }
      setRunning(false);
      setProcessingStage('idle');
    } finally {
      setIsReplaying(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const maxSize = 20 * 1024 * 1024;
    const newAttachments: FileAttachment[] = [];

    setIsUploading(true);

    for (const file of Array.from(files)) {
      if (file.size > maxSize) {
        showToast('error', t('fileTooLarge', { name: file.name }));
        continue;
      }

      // Use new file type validation
      if (!isSupportedFileType(file)) {
        showToast('error', t('unsupportedFileType', { name: file.name }));
        continue;
      }

      try {
        const attachment = await uploadFileAttachment(file);
        newAttachments.push(attachment);
      } catch {
        showToast('error', t('fileReadFailed', { name: file.name }));
      }
    }

    setIsUploading(false);

    if (newAttachments.length > 0) {
      setAttachedFiles([...attachedFiles, ...newAttachments]);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const newAttachments: FileAttachment[] = [];
    let hasImage = false;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        hasImage = true;
        break;
      }
    }

    if (!hasImage) return;

    setIsUploading(true);

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          if (file.size > 20 * 1024 * 1024) {
            showToast('error', t('imageTooLarge'));
            continue;
          }
          try {
            const attachment = await uploadFileAttachment(file);
            newAttachments.push(attachment);
            showToast('success', t('imageAdded'));
          } catch {
            showToast('error', t('cannotReadImage'));
          }
        }
      }
    }

    setIsUploading(false);

    if (newAttachments.length > 0) {
      setAttachedFiles([...attachedFiles, ...newAttachments]);
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles(attachedFiles.filter((_, i) => i !== index));
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return Image;
    return File;
  };

  const canReplay = useMemo(() => {
    const hasScript = (currentChatRun?.messages.some((m) => m.role === 'user') ?? false) || Boolean(testInput.trim());
    return hasScript && !running && !isReplaying;
  }, [currentChatRun?.messages, isReplaying, running, testInput]);

  const showChatDiff = Boolean(
    diffEnabled &&
    baselineChatRun &&
    currentChatRun &&
    baselineChatRun.id !== currentChatRun.id
  );

  const formatRunLabel = useCallback((run: ChatRun) => {
    const modelName = models.find((m) => m.id === run.modelId)?.name || run.modelId;
    const time = new Date(run.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${modelName} - ${time}`;
  }, [models]);

  const renderDiffOps = useCallback((ops: DiffOp[]) => (
    <span className="whitespace-pre-wrap break-words">
      {ops.map((op, idx) => {
        if (op.type === 'delete' && !diffShowDeletions) return null;
        const cls =
          op.type === 'insert'
            ? 'bg-emerald-500/20 text-emerald-200 light:bg-emerald-200/70 light:text-emerald-900 rounded px-0.5'
            : op.type === 'delete'
              ? 'bg-rose-500/10 text-rose-200 light:bg-rose-200/70 light:text-rose-900 line-through rounded px-0.5'
              : '';
        return (
          <span key={idx} className={cls}>
            {op.value}
          </span>
        );
      })}
    </span>
  ), [diffShowDeletions]);

  const handleCopyText = useCallback(async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('success', tCommon('copied'));
    } catch {
      showToast('error', t('copyFailed'));
    }
  }, [showToast, t, tCommon]);

  const handleComposerResizeStart = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    chatComposerResizeRef.current = { startY: e.clientY, startHeight: chatComposerHeight, pointerId: e.pointerId };
    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    }
  }, [chatComposerHeight]);

  const handleComposerResizeMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const state = chatComposerResizeRef.current;
    if (!state) return;
    e.preventDefault();
    const delta = state.startY - e.clientY;
    const rawHeight = state.startHeight + delta;
    const maxHeight = typeof window !== 'undefined' ? Math.min(420, Math.floor(window.innerHeight * 0.5)) : 420;
    const nextHeight = Math.max(96, Math.min(rawHeight, maxHeight));
    setChatComposerHeight(nextHeight);
  }, []);

  const handleComposerResizeEnd = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const state = chatComposerResizeRef.current;
    if (!state) return;
    chatComposerResizeRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(state.pointerId);
    } catch {
      // Ignore.
    }
    if (typeof document !== 'undefined') {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }, []);

  const showOcrProviderSelect = resolvedFileMode === 'ocr';
  const showConfigPanel = showModelSelector || variables.length > 0;

  return (
    <div className={`flex flex-col overflow-hidden ${className}`}>
      <div className="flex-shrink-0 p-4 border-b border-slate-700 light:border-slate-200">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">{t('testAndOutput')}</h3>
          <div className="flex items-center gap-1 p-1 bg-slate-800/50 light:bg-slate-100 rounded-lg border border-slate-700 light:border-slate-200">
            <button
              type="button"
              onClick={() => setTestMode('single')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                testMode === 'single'
                  ? 'bg-cyan-500 text-white'
                  : 'text-slate-400 light:text-slate-600 hover:text-white light:hover:text-slate-900'
              }`}
            >
              {t('singleTurn')}
            </button>
            <button
              type="button"
              onClick={() => setTestMode('chat')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                testMode === 'chat'
                  ? 'bg-cyan-500 text-white'
                  : 'text-slate-400 light:text-slate-600 hover:text-white light:hover:text-slate-900'
              }`}
            >
              {t('multiTurn')}
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        {showConfigPanel && (
          <div className="flex-shrink-0 p-4 space-y-4 border-b border-slate-700 light:border-slate-200 overflow-y-auto max-h-[48%]">
            {/* Model selector */}
            {showModelSelector && (
              <div className="space-y-2">
                <div className="text-xs text-slate-500 light:text-slate-600">{tCommon('selectModel')}</div>
                <ModelSelector
                  models={models}
                  providers={providers}
                  selectedModelId={selectedModelId}
                  onSelect={onModelSelect}
                />
                {recommendedModel && (
                  <div className="text-xs text-slate-500 light:text-slate-600">
                    {t('recommendedModel')}: {recommendedModel.name} ({recommendedModel.providerType})
                  </div>
                )}
              </div>
            )}

            {/* Variable values input */}
            {variables.length > 0 && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('variableValues')}
                </label>
                <div className="space-y-2 p-3 bg-slate-800/50 light:bg-slate-50 rounded-lg border border-slate-700 light:border-slate-200">
                  {variables.map((variable) => (
                    <div key={variable.name} className="flex items-center gap-2">
                      <code className="text-xs text-amber-400 light:text-amber-600 font-mono min-w-[100px]">
                        {`{{${variable.name}}}`}
                        {variable.required && <span className="text-red-400">*</span>}
                      </code>
                      <input
                        type="text"
                        value={variableValues[variable.name] || ''}
                        onChange={(e) =>
                          onVariableValuesChange({
                            ...variableValues,
                            [variable.name]: e.target.value,
                          })
                        }
                        placeholder={variable.default_value || variable.description || t('inputValuePlaceholder')}
                        className="flex-1 px-2 py-1.5 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
          {/* Thinking Block */}
          {(thinking || isThinking) && <ThinkingBlock content={thinking} isStreaming={isThinking} />}

          {testMode === 'single' ? (
            <div className="flex-1 flex flex-col min-h-0 gap-3">
              <div className="flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                    {t('outputResult')}
                  </label>
                  {lastLatencyMs !== null && !running && (
                    <span className="text-xs text-slate-500 light:text-slate-600 whitespace-nowrap">
                      {t('processingTime')}: {(lastLatencyMs / 1000).toFixed(2)}s
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyText(output)}
                    disabled={!output}
                    title={tCommon('copy')}
                    className={`text-xs px-2 py-1 rounded transition-colors border inline-flex items-center gap-1 ${
                      output
                        ? 'bg-slate-800/50 light:bg-slate-100 text-slate-300 light:text-slate-700 border-slate-700 light:border-slate-200 hover:text-white light:hover:text-slate-900'
                        : 'bg-slate-800/30 light:bg-slate-100 text-slate-500 border-slate-700 light:border-slate-200 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{tCommon('copy')}</span>
                  </button>
                  <OutputRendererControls
                    preferences={outputRenderPrefs}
                    onChange={setOutputRenderPrefs}
                  />
                </div>
              </div>

              <div className="flex-1 min-h-0 p-3 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-300 light:text-slate-700 overflow-y-auto">
                {output ? (
                  <OutputRenderer content={output} preferences={outputRenderPrefs} isStreaming={running} />
                ) : running ? (
                  <div className="flex items-center gap-2 text-slate-500 light:text-slate-600">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{processingStage === 'ocr' ? `${tEval('fileProcessingOcr')}...` : t('generating')}</span>
                  </div>
                ) : (
                  <span className="text-slate-500 light:text-slate-600">{t('clickRunToSeeResult')}</span>
                )}
              </div>

              {!running && lastSingleUsage && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-slate-500 light:text-slate-600">
                  <span>{t('input', { defaultValue: '输入' })}: {lastSingleUsage.tokensInput}</span>
                  <span>{t('output', { defaultValue: '输出' })}: {lastSingleUsage.tokensOutput}</span>
                  <span>{t('roundCost', { defaultValue: '本轮费用' })}: {formatUsdCost(lastSingleCost?.totalCost ?? null)}</span>
                  <span>
                    {t('costFormula', { defaultValue: '费用公式' })}: {formatUsdCostFormula(
                      lastSingleCost?.totalCost ?? null,
                      lastSingleCost?.inputCost ?? null,
                      lastSingleCost?.outputCost ?? null
                    )}
                  </span>
                  {lastSingleCost && !lastSingleCost.hasPricing && (
                    <span className="text-amber-400/90 light:text-amber-700">
                      {t('modelPriceNotConfigured', { defaultValue: '模型价格未配置' })}
                    </span>
                  )}
                </div>
              )}

              <div className="flex-shrink-0 space-y-2">
                {showFileUpload && attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachedFiles.map((file, index) => {
                      const FileIcon = getFileIcon(file.type);
                      return (
                        <div
                          key={file.fileId}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 text-xs text-slate-200 light:text-slate-800 max-w-[260px]"
                        >
                          <button
                            type="button"
                            onClick={() => setPreviewAttachment(file)}
                            className="flex items-center gap-1.5 min-w-0 hover:text-cyan-400 light:hover:text-cyan-600 transition-colors"
                            title={t('clickToPreview')}
                          >
                            <FileIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                            <span className="truncate">{file.name}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFile(index)}
                            className="p-0.5 text-slate-500 hover:text-rose-400 transition-colors flex-shrink-0"
                            title={tCommon('remove')}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="relative">
                  <button
                    type="button"
                    onPointerDown={handleComposerResizeStart}
                    onPointerMove={handleComposerResizeMove}
                    onPointerUp={handleComposerResizeEnd}
                    onPointerCancel={handleComposerResizeEnd}
                    className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 w-10 h-5 rounded-full bg-slate-900/40 light:bg-slate-100 border border-slate-700/60 light:border-slate-200 flex items-center justify-center cursor-row-resize text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700"
                  >
                    <GripHorizontal className="w-4 h-4" />
                  </button>

                  <textarea
                    value={testInput}
                    onChange={(e) => onTestInputChange(e.target.value)}
                    onPaste={handlePaste}
                    placeholder={t('inputPlaceholder')}
                    disabled={running}
                    style={{ height: chatComposerHeight }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;

                      // Ctrl/Cmd+Enter inserts a newline.
                      if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        const target = e.currentTarget;
                        const start = target.selectionStart ?? testInput.length;
                        const end = target.selectionEnd ?? testInput.length;
                        const nextValue = testInput.slice(0, start) + '\n' + testInput.slice(end);
                        onTestInputChange(nextValue);
                        requestAnimationFrame(() => {
                          target.selectionStart = start + 1;
                          target.selectionEnd = start + 1;
                        });
                        return;
                      }

                      e.preventDefault();
                      if (running) return;
                      void handleRunSingle();
                    }}
                    className="w-full p-3 pb-16 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 resize-none focus:outline-none focus:border-cyan-500 disabled:opacity-60"
                  />

                  <div className="absolute bottom-2 left-2 right-2 z-10 flex items-end justify-between gap-2">
                    {showFileUpload ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="w-20">
                          <Select
                            value={fileProcessing}
                            onChange={(e) => setFileProcessing(e.target.value as typeof fileProcessing)}
                            options={[
                              { value: 'auto', label: tEval('fileProcessingAuto') },
                              ...(supportsVision ? [{ value: 'vision', label: tEval('fileProcessingVision') }] : []),
                              { value: 'ocr', label: tEval('fileProcessingOcr') },
                              { value: 'none', label: tEval('fileProcessingNone') },
                            ]}
                            className="py-1 px-2 pr-8 text-xs"
                          />
                        </div>

                        {showOcrProviderSelect && (
                          <div className="w-40">
                            <Select
                              value={ocrProviderOverride}
                              onChange={(e) => setOcrProviderOverride(e.target.value as OcrProvider | '')}
                              options={ocrProviderOptions}
                              className="py-1 px-2 pr-8 text-xs"
                            />
                          </div>
                        )}

                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={handleAddFileClick}
                          disabled={isUploading}
                          title={t('addFile')}
                          className="!p-2"
                        >
                          {isUploading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Paperclip className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div />
                    )}

                    <div className="flex-1 pb-1 text-center text-[10px] text-slate-500 light:text-slate-600 select-none whitespace-nowrap">
                      {t('enterToSendHint')}
                    </div>

                    <Button
                      variant={running ? 'danger' : 'primary'}
                      size="sm"
                      onClick={running ? handleStopRun : handleRunSingle}
                      title={running ? tCommon('stop') : t('run')}
                      className="rounded-full flex-shrink-0 whitespace-nowrap"
                    >
                      {running ? (
                        <>
                          <Square className="w-4 h-4" />
                          <span>{tCommon('stop')}</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" />
                          <span>{t('run')}</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-slate-500 light:text-slate-600 flex items-center gap-1 min-w-0">
                  <GitCompare className="w-3.5 h-3.5 flex-shrink-0" />
                  {showChatDiff && baselineChatRun ? (
                    <span className="truncate">
                      <span className="inline-flex items-center gap-1 mr-2">
                        <Flag className="w-3.5 h-3.5" />
                        {t('baseline')}: {formatRunLabel(baselineChatRun)}
                      </span>
                      <span className="text-slate-600 light:text-slate-500">
                        {t('changes')}: {changedAssistantMessageIds.length}
                      </span>
                    </span>
                  ) : (
                    <span className="truncate">{t('chatModeHint')}</span>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <OutputRendererControls
                    preferences={outputRenderPrefs}
                    onChange={setOutputRenderPrefs}
                  />
                  <button
                    type="button"
                    disabled={!baselineChatRun || !currentChatRun || baselineChatRun?.id === currentChatRun?.id}
                    onClick={() => setDiffEnabled((v) => !v)}
                    className={`text-xs px-2 py-1 rounded transition-colors border ${
                      showChatDiff
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30 light:bg-cyan-100 light:text-cyan-900 light:border-cyan-300'
                        : 'bg-slate-800/50 light:bg-slate-100 text-slate-400 light:text-slate-600 border-slate-700 light:border-slate-200 hover:text-slate-200 light:hover:text-slate-800'
                    }`}
                  >
                    {t('diffMode')}
                  </button>
                  <button
                    type="button"
                    disabled={!showChatDiff}
                    onClick={() => setDiffOnlyChanges((v) => !v)}
                    className={`text-xs px-2 py-1 rounded transition-colors border ${
                      diffOnlyChanges && showChatDiff
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30 light:bg-amber-100 light:text-amber-900 light:border-amber-300'
                        : 'bg-slate-800/50 light:bg-slate-100 text-slate-400 light:text-slate-600 border-slate-700 light:border-slate-200 hover:text-slate-200 light:hover:text-slate-800'
                    }`}
                  >
                    {t('onlyChanges')}
                  </button>
                  <button
                    type="button"
                    disabled={!showChatDiff}
                    onClick={() => setDiffShowDeletions((v) => !v)}
                    className={`text-xs px-2 py-1 rounded transition-colors border ${
                      diffShowDeletions && showChatDiff
                        ? 'bg-rose-500/15 text-rose-200 border-rose-500/25 light:bg-rose-100 light:text-rose-900 light:border-rose-300'
                        : 'bg-slate-800/50 light:bg-slate-100 text-slate-400 light:text-slate-600 border-slate-700 light:border-slate-200 hover:text-slate-200 light:hover:text-slate-800'
                    }`}
                  >
                    {t('showDeletions')}
                  </button>
                  <button
                    type="button"
                    disabled={!showChatDiff || changedAssistantMessageIds.length === 0}
                    onClick={() => setActiveDiffIndex((v) => Math.max(0, v - 1))}
                    className="p-1 rounded border border-slate-700 light:border-slate-200 text-slate-400 hover:text-slate-200 disabled:opacity-50"
                    title={t('prevChange')}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={!showChatDiff || changedAssistantMessageIds.length === 0}
                    onClick={() => setActiveDiffIndex((v) => Math.min(changedAssistantMessageIds.length - 1, v + 1))}
                    className="p-1 rounded border border-slate-700 light:border-slate-200 text-slate-400 hover:text-slate-200 disabled:opacity-50"
                    title={t('nextChange')}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 relative bg-slate-800/30 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg">
                <div className="absolute bottom-2 right-2 flex items-center gap-2 z-10">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleChatReplay}
                    disabled={!canReplay}
                    title={!canReplay ? t('replayConversationHint') : t('replayConversation')}
                    className="!px-2"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleChatReset}
                    disabled={running || isReplaying}
                    title={tCommon('clear')}
                    className="!px-2"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                <div className="h-full overflow-y-auto space-y-3 p-3 pb-14">
                  {currentChatRun && currentChatRun.messages.length > 0 ? (
                    currentChatRun.messages.map((message) => {
                      const isUser = message.role === 'user';
                      const diffInfo = !isUser ? diffByAssistantMessageId.get(message.id) : undefined;
                      const showDiffForMessage = Boolean(showChatDiff && diffInfo);
                      const unchanged = Boolean(showDiffForMessage && diffInfo && !diffInfo.changed);
                      const assistantModelId = !isUser ? (message.modelId || currentChatRun.modelId) : null;
                      const assistantLabel = !isUser && assistantModelId
                        ? (models.find((m) => m.id === assistantModelId)?.name || assistantModelId)
                        : '';

                      const bubbleBase = isUser
                        ? 'bg-cyan-500/15 border-cyan-500/25 text-slate-100 light:bg-cyan-100 light:border-cyan-200 light:text-slate-900'
                        : 'bg-slate-800/70 light:bg-slate-50 border-slate-700 light:border-slate-200 text-slate-200 light:text-slate-800';

                      const isStreamingMessage =
                        !isUser &&
                        running &&
                        !isReplaying &&
                        message.id === currentChatRun.messages[currentChatRun.messages.length - 1]?.id;

                      const showRoundMeta =
                        !isUser &&
                        (
                          typeof message.tokensInput === 'number' ||
                          typeof message.tokensOutput === 'number' ||
                          typeof message.costTotal === 'number' ||
                          message.costUnavailable
                        );
                      const roundCostFormula =
                        typeof message.costTotal === 'number' &&
                        typeof message.costInput === 'number' &&
                        typeof message.costOutput === 'number'
                          ? `${formatCostNumber(message.costTotal)}(${formatCostNumber(message.costInput)}+${formatCostNumber(message.costOutput)})`
                          : '--';

                      return (
                        <div
                          key={message.id}
                          id={!isUser ? `assistant-${message.id}` : undefined}
                          className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`max-w-[92%] border rounded-xl px-3 py-2 text-sm ${bubbleBase}`}>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span
                                className="text-[12px] font-medium text-slate-300 light:text-slate-700 truncate max-w-[70%]"
                                title={isUser ? t('userLabel') : assistantLabel}
                              >
                                {isUser ? t('userLabel') : assistantLabel}
                              </span>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {!isUser && showDiffForMessage && diffInfo?.changed && (
                                  <span className="text-[11px] text-amber-300 light:text-amber-700">{t('changed')}</span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => void handleCopyText(message.content)}
                                  disabled={!message.content.trim()}
                                  title={tCommon('copy')}
                                  className="p-1 rounded border border-transparent text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-800 hover:bg-slate-700/30 light:hover:bg-slate-200 disabled:opacity-50 disabled:hover:bg-transparent"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {showDiffForMessage ? (
                              diffOnlyChanges && unchanged ? (
                                <div className="text-xs text-slate-500 light:text-slate-600">
                                  {t('noChanges')}
                                </div>
                              ) : (
                                <div className="whitespace-pre-wrap break-words">
                                  {renderDiffOps(diffInfo?.ops ?? [])}
                                </div>
                              )
                            ) : !isUser ? (
                              <OutputRenderer
                                content={message.content || ''}
                                preferences={outputRenderPrefs}
                                isStreaming={isStreamingMessage}
                              />
                            ) : (
                              <pre className="whitespace-pre-wrap">{message.content || ''}</pre>
                            )}

                            {isUser && message.attachments && message.attachments.length > 0 && (
                              <div className="mt-2 pt-2 border-t border-cyan-500/20 space-y-1">
                                {message.attachments.map((f) => (
                                  <div key={f.fileId} className="text-xs text-slate-300/80 truncate">
                                    {f.name}
                                  </div>
                                ))}
                              </div>
                            )}

                            {showRoundMeta && (
                              <div className="mt-2 pt-1 border-t border-slate-700/40 light:border-slate-200/80 text-[10px] text-slate-500 light:text-slate-600">
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                  <span>
                                    {t('input', { defaultValue: '输入' })}: {message.tokensInput ?? 0}
                                  </span>
                                  <span>
                                    {t('output', { defaultValue: '输出' })}: {message.tokensOutput ?? 0}
                                  </span>
                                  <span>
                                    {t('roundCost', { defaultValue: '本轮费用' })}: {formatUsdCost(message.costTotal ?? null)}
                                  </span>
                                  <span>
                                    {t('conversationCost', { defaultValue: '累计费用' })}: {formatUsdCost(message.costCumulative ?? null)}
                                  </span>
                                </div>
                                <div className="mt-1">
                                  <span>
                                    {t('costFormula', { defaultValue: '费用公式' })}: {roundCostFormula}
                                  </span>
                                  {message.costUnavailable && (
                                    <span className="ml-2 text-amber-400/90 light:text-amber-700">
                                      {t('modelPriceNotConfigured', { defaultValue: '模型价格未配置' })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-sm text-slate-500 light:text-slate-600">{t('chatEmptyHint')}</div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </div>

              <div className="flex-shrink-0 space-y-2">
                {showFileUpload && attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachedFiles.map((file, index) => {
                      const FileIcon = getFileIcon(file.type);
                      return (
                        <div
                          key={file.fileId}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 text-xs text-slate-200 light:text-slate-800 max-w-[260px]"
                        >
                          <button
                            type="button"
                            onClick={() => setPreviewAttachment(file)}
                            className="flex items-center gap-1.5 min-w-0 hover:text-cyan-400 light:hover:text-cyan-600 transition-colors"
                            title={t('clickToPreview')}
                          >
                            <FileIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                            <span className="truncate">{file.name}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFile(index)}
                            className="p-0.5 text-slate-500 hover:text-rose-400 transition-colors flex-shrink-0"
                            title={tCommon('remove')}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="relative">
                  <button
                    type="button"
                    onPointerDown={handleComposerResizeStart}
                    onPointerMove={handleComposerResizeMove}
                    onPointerUp={handleComposerResizeEnd}
                    onPointerCancel={handleComposerResizeEnd}
                    className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 w-10 h-5 rounded-full bg-slate-900/40 light:bg-slate-100 border border-slate-700/60 light:border-slate-200 flex items-center justify-center cursor-row-resize text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700"
                  >
                    <GripHorizontal className="w-4 h-4" />
                  </button>

                  <textarea
                    value={currentChatRun ? chatInput : testInput}
                    onChange={(e) => {
                      if (currentChatRun) setChatInput(e.target.value);
                      else onTestInputChange(e.target.value);
                    }}
                    onPaste={handlePaste}
                    placeholder={currentChatRun ? t('chatInputPlaceholder') : t('inputPlaceholder')}
                    disabled={running || isReplaying}
                    style={{ height: chatComposerHeight }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;

                      // Ctrl/Cmd+Enter inserts a newline.
                      if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        const target = e.currentTarget;
                        const currentValue = currentChatRun ? chatInput : testInput;
                        const start = target.selectionStart ?? currentValue.length;
                        const end = target.selectionEnd ?? currentValue.length;
                        const nextValue = currentValue.slice(0, start) + '\n' + currentValue.slice(end);
                        if (currentChatRun) setChatInput(nextValue);
                        else onTestInputChange(nextValue);
                        requestAnimationFrame(() => {
                          target.selectionStart = start + 1;
                          target.selectionEnd = start + 1;
                        });
                        return;
                      }

                      e.preventDefault();
                      if (running || isReplaying) return;
                      if (currentChatRun) void handleChatSend();
                      else void handleChatRunFirstTurn();
                    }}
                    className="w-full p-3 pb-16 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 resize-none focus:outline-none focus:border-cyan-500 disabled:opacity-60"
                  />

                  <div className="absolute bottom-2 left-2 right-2 z-10 flex items-end justify-between gap-2">
                    {showFileUpload ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="w-20">
                          <Select
                            value={fileProcessing}
                            onChange={(e) => setFileProcessing(e.target.value as typeof fileProcessing)}
                            options={[
                              { value: 'auto', label: tEval('fileProcessingAuto') },
                              ...(supportsVision ? [{ value: 'vision', label: tEval('fileProcessingVision') }] : []),
                              { value: 'ocr', label: tEval('fileProcessingOcr') },
                              { value: 'none', label: tEval('fileProcessingNone') },
                            ]}
                            className="py-1 px-2 pr-8 text-xs"
                          />
                        </div>

                        {showOcrProviderSelect && (
                          <div className="w-40">
                            <Select
                              value={ocrProviderOverride}
                              onChange={(e) => setOcrProviderOverride(e.target.value as OcrProvider | '')}
                              options={ocrProviderOptions}
                              className="py-1 px-2 pr-8 text-xs"
                            />
                          </div>
                        )}

                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={handleAddFileClick}
                          disabled={isUploading}
                          title={t('addFile')}
                          className="!p-2"
                        >
                          {isUploading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Paperclip className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div />
                    )}

                    <div className="flex-1 pb-1 text-center text-[10px] text-slate-500 light:text-slate-600 select-none whitespace-nowrap">
                      {t('enterToSendHint')}
                    </div>

                    <Button
                      variant={running ? 'danger' : 'primary'}
                      size="sm"
                      onClick={running ? handleStopRun : currentChatRun ? handleChatSend : handleChatRunFirstTurn}
                      disabled={running ? false : currentChatRun ? (isReplaying || !chatInput.trim()) : isReplaying}
                      title={running ? tCommon('stop') : currentChatRun ? t('send') : t('runFirstTurn')}
                      className="rounded-full flex-shrink-0 whitespace-nowrap"
                    >
                      {running ? (
                        <>
                          <Square className="w-4 h-4" />
                          <span>{tCommon('stop')}</span>
                        </>
                      ) : (
                        <>
                          {currentChatRun ? (
                            <ArrowUp className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                          <span>{t('send')}</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {chatRuns.length > 0 && (
                <div className="flex-shrink-0 pt-2 border-t border-slate-700/50 light:border-slate-200">
                  <div className="text-xs text-slate-500 light:text-slate-600 mb-2">{t('experiments')}</div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {chatRuns.map((run, idx) => {
                      const isCurrent = idx === 0;
                      const isBaseline = run.id === baselineRunId;
                      return (
                        <button
                          key={run.id}
                          type="button"
                          onClick={() => setBaselineRunId(run.id)}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs whitespace-nowrap transition-colors ${
                            isBaseline
                              ? 'bg-amber-500/20 border-amber-500/30 text-amber-200 light:bg-amber-100 light:border-amber-300 light:text-amber-900'
                              : isCurrent
                                ? 'bg-cyan-500/15 border-cyan-500/25 text-cyan-200 light:bg-cyan-100 light:border-cyan-300 light:text-cyan-900'
                                : 'bg-slate-800/50 light:bg-slate-100 border-slate-700 light:border-slate-200 text-slate-300 light:text-slate-700 hover:text-white light:hover:text-slate-900'
                          }`}
                          title={formatRunLabel(run)}
                        >
                          <Flag className={`w-3.5 h-3.5 ${isBaseline ? 'text-amber-300 light:text-amber-700' : 'text-slate-500 light:text-slate-600'}`} />
                          <span className="truncate max-w-[180px]">{formatRunLabel(run)}</span>
                          {isCurrent && <span className="text-[10px] opacity-80">{t('current')}</span>}
                          {isBaseline && <span className="text-[10px] opacity-80">{t('baselineTag')}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Attachment Preview Modal */}
      <input
        ref={fileInputRef}
        type="file"
        accept={getFileInputAccept()}
        multiple
        onChange={(e) => void handleFileSelect(e)}
        className="hidden"
      />
      <AttachmentModal
        attachment={previewAttachment}
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
