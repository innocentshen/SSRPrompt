import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { flushSync } from 'react-dom';
import {
  Plus,
  Search,
  Save,
  History,
  FileText,
  Folder,
  FolderPlus,
  ChevronDown,
  ChevronRight,
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
  Pencil,
  Sparkles,
  Check,
  Copy,
  Maximize2,
  Square,
  Settings2,
  Globe,
  Play,
} from 'lucide-react';
import { Button, Input, Modal, Badge, Select, MarkdownRenderer, Tabs, Collapsible, ModelSelector } from '../components/ui';
import { MessageList, ParameterPanel, VariableEditor, DebugHistory, PromptOptimizer, PromptObserver, StructuredOutputEditor, ThinkingBlock, AttachmentList, AttachmentModal, PromptTestPanel, OcrResultsPanel } from '../components/Prompt';
import { ReasoningSelector } from '../components/Common/ReasoningSelector';
import type { DebugRun } from '../components/Prompt';
import { promptsApi, promptGroupsApi, ApiError } from '../api';
import { chatApi, type ContentPart } from '../api/chat';
import { uploadFileAttachment, extractThinking, type FileAttachment } from '../lib/ai-service';
import { analyzePrompt, type PromptAnalysisResult } from '../lib/prompt-analyzer';
import { inferReasoningSupport } from '../lib/model-capabilities';
import { getFileInputAccept, isSupportedFileType } from '../lib/file-utils';
import { formatDateTime } from '../lib/date-utils';
import { smartReplace } from '../lib/text-utils';
import { toApiOutputSchema, toFrontendOutputSchema } from '../lib/output-schema';
import type { Prompt, PromptVersion, PromptGroup, OcrProvider } from '../types';
import { PromptMessage, PromptConfig, PromptVariable, ReasoningEffort, DEFAULT_PROMPT_CONFIG } from '../types/database';
import { useToast } from '../store/useUIStore';
import { useGlobalStore } from '../store/useGlobalStore';
import { invalidatePromptsCache } from '../lib/cache-events';

type TabType = 'edit' | 'observe' | 'optimize';

// Type conversion helpers for shared package types to frontend types
const toFrontendConfig = (config: unknown): PromptConfig => {
  const c = (config || {}) as Record<string, unknown>;
  return {
    temperature: (c.temperature as number) ?? DEFAULT_PROMPT_CONFIG.temperature,
    top_p: (c.top_p as number) ?? DEFAULT_PROMPT_CONFIG.top_p,
    frequency_penalty: (c.frequency_penalty as number) ?? DEFAULT_PROMPT_CONFIG.frequency_penalty,
    presence_penalty: (c.presence_penalty as number) ?? DEFAULT_PROMPT_CONFIG.presence_penalty,
    max_tokens: (c.max_tokens as number) ?? DEFAULT_PROMPT_CONFIG.max_tokens,
    output_schema: toFrontendOutputSchema(c.output_schema),
    reasoning: c.reasoning as PromptConfig['reasoning'],
  };
};

const toFrontendMessages = (messages: unknown): PromptMessage[] => {
  const msgs = (messages || []) as Array<{ role?: string; content?: string; id?: string }>;
  return msgs.map((m, i) => ({
    id: m.id || `msg-${Date.now()}-${i}`,
    role: (m.role || 'user') as PromptMessage['role'],
    content: m.content || '',
  }));
};

// Type conversion from frontend to API (for saving)
const toApiConfig = (config: PromptConfig): Record<string, unknown> => ({
  temperature: config.temperature,
  top_p: config.top_p,
  frequency_penalty: config.frequency_penalty,
  presence_penalty: config.presence_penalty,
  max_tokens: config.max_tokens,
  output_schema: toApiOutputSchema(config.output_schema),
  reasoning: config.reasoning,
});

const toApiMessages = (messages: PromptMessage[]): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> =>
  messages.map((m) => ({ role: m.role, content: m.content }));

type PromptTestCache = {
  promptId: string;
  testInput: string;
  variableValues: Record<string, string>;
  attachedFiles: FileAttachment[];
  debugRuns: DebugRun[];
  selectedDebugRunId: string | null;
  testOutput: string;
  testThinking: string;
};

let promptTestCache: PromptTestCache | null = null;

export function PromptsPage() {
  const { showToast } = useToast();
  const { t } = useTranslation('prompts');
  const { t: tEval } = useTranslation('evaluation');
  const { t: tCommon } = useTranslation('common');

  // Use global store for providers and models (shared across pages, with caching)
  const {
    providers,
    models,
    fetchProvidersAndModels,
  } = useGlobalStore();

  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptGroups, setPromptGroups] = useState<PromptGroup[]>([]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, boolean>>({});
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [showNewPrompt, setShowNewPrompt] = useState(false);
  const [showSaveVersion, setShowSaveVersion] = useState(false);
  const [versionNotes, setVersionNotes] = useState('');
  const [versionNotesError, setVersionNotesError] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [compareMode, setCompareMode] = useState<'models' | 'versions'>('models');
  const [compareVersion, setCompareVersion] = useState('');
  const [compareModels, setCompareModels] = useState<[string, string]>(['', '']);
  const [compareModel, setCompareModel] = useState('');
  const [compareVersions, setCompareVersions] = useState<[string, string]>(['', '']);
  const [compareInput, setCompareInput] = useState('');
  const [compareFiles, setCompareFiles] = useState<FileAttachment[]>([]);
  const [compareFileProcessing, setCompareFileProcessing] = useState<'auto' | 'vision' | 'ocr' | 'none'>('auto');
  const [compareOcrProviderOverride, setCompareOcrProviderOverride] = useState<OcrProvider | ''>('');
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
  const [testThinking, setTestThinking] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptGroupId, setNewPromptGroupId] = useState<string>('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const [draggedPromptId, setDraggedPromptId] = useState<string | null>(null);
  const [draggedPromptGroupId, setDraggedPromptGroupId] = useState<string | null>(null);
  const [copyingPromptId, setCopyingPromptId] = useState<string | null>(null);
  const [deletingPromptId, setDeletingPromptId] = useState<string | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [loadingPromptId, setLoadingPromptId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{ id: string; name: string } | null>(null);
  const [showDeleteGroupConfirm, setShowDeleteGroupConfirm] = useState(false);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<PromptGroup | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('edit');
  const [debugRuns, setDebugRuns] = useState<DebugRun[]>([]);
  const [selectedDebugRun, setSelectedDebugRun] = useState<DebugRun | null>(null);
  const [showDebugDetail, setShowDebugDetail] = useState<DebugRun | null>(null);
  const [debugDetailCopied, setDebugDetailCopied] = useState<'input' | 'output' | null>(null);
  const [debugDetailExpanded, setDebugDetailExpanded] = useState<{ field: 'input' | 'output'; content: string } | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<PromptAnalysisResult | null>(null);
  const [optimizeModelId, setOptimizeModelId] = useState('');
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachment | null>(null);
  const compareFileInputRef = useRef<HTMLInputElement>(null);
  const editingGroupInputRef = useRef<HTMLInputElement>(null);
  const ignoreGroupNameBlurRef = useRef(false);
  const isFinalizingDragRef = useRef(false);
  const selectPromptRequestIdRef = useRef(0);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!editingGroupId) return;
    const input = editingGroupInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editingGroupId]);

  // Set default model when models are loaded
  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      const enabledModels = models.filter((m) => {
        const provider = providers.find((p) => p.id === m.providerId);
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
      // Reset prompt content and configuration
      setPromptContent(selectedPrompt.content || '');
      setPromptName(selectedPrompt.name);
      setPromptMessages(toFrontendMessages(selectedPrompt.messages));
      setPromptConfig(toFrontendConfig(selectedPrompt.config));
      setPromptVariables(selectedPrompt.variables || []);
      if (selectedPrompt.defaultModelId) {
        setSelectedModel(selectedPrompt.defaultModelId);
      }
      loadVersions(selectedPrompt.id);

      setShowDebugDetail(null);

      const cache = promptTestCache;
      if (cache && cache.promptId === selectedPrompt.id) {
        setVariableValues(cache.variableValues);
        setTestInput(cache.testInput);
        setAttachedFiles(cache.attachedFiles);
        setDebugRuns(cache.debugRuns);
        const cachedSelectedRun = cache.selectedDebugRunId
          ? cache.debugRuns.find((run) => run.id === cache.selectedDebugRunId) || null
          : null;
        setSelectedDebugRun(cachedSelectedRun);
        setTestOutput(cache.testOutput);
        setTestThinking(cache.testThinking);
      } else {
        // Reset test & output states - each prompt should have independent test data
        setVariableValues({});
        setTestInput('');
        setAttachedFiles([]);
        setDebugRuns([]);
        setSelectedDebugRun(null);
        setTestOutput('');
        setTestThinking('');
      }
    }
  }, [selectedPrompt?.id]);

  useEffect(() => {
    if (!selectedPrompt?.id) return;
    promptTestCache = {
      promptId: selectedPrompt.id,
      testInput,
      variableValues,
      attachedFiles,
      debugRuns,
      selectedDebugRunId: selectedDebugRun?.id ?? null,
      testOutput,
      testThinking,
    };
  }, [
    attachedFiles,
    debugRuns,
    selectedPrompt?.id,
    selectedDebugRun?.id,
    testInput,
    testOutput,
    testThinking,
    variableValues,
  ]);

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedPrompt) return false;

    const selectedConfig = toFrontendConfig(selectedPrompt.config);

    const selectedMessages = toApiMessages(toFrontendMessages(selectedPrompt.messages));
    const currentMessages = toApiMessages(promptMessages);
    const messagesChanged = JSON.stringify(currentMessages) !== JSON.stringify(selectedMessages);

    // In multi-message mode, ignore promptContent diffs because content is derived from messages.
    const isMultiMessage = currentMessages.length > 0 || selectedMessages.length > 0;
    const contentChanged = isMultiMessage ? false : promptContent !== (selectedPrompt.content || '');

    return (
      promptName !== selectedPrompt.name ||
      contentChanged ||
      messagesChanged ||
      JSON.stringify(promptConfig) !== JSON.stringify(selectedConfig) ||
      JSON.stringify(promptVariables) !== JSON.stringify(selectedPrompt.variables || []) ||
      (selectedModel || '') !== (selectedPrompt.defaultModelId || '')
    );
  }, [promptConfig, promptContent, promptMessages, promptName, promptVariables, selectedModel, selectedPrompt]);

  const loadData = async () => {
    try {
      // Load providers and models from global store (with caching)
      await fetchProvidersAndModels();

      // Load prompts and groups
      const [promptsData, groupsData] = await Promise.all([
        promptsApi.list(),
        promptGroupsApi.list(),
      ]);

      setPromptGroups((groupsData || []) as PromptGroup[]);

      if (promptsData) {
        // Sort by orderIndex then by updatedAt (descending)
        const sorted = [...promptsData].sort((a, b) => {
          const orderDiff = (a.orderIndex || 0) - (b.orderIndex || 0);
          if (orderDiff !== 0) return orderDiff;
          return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
        });
        setPrompts(sorted as Prompt[]);
        if (sorted.length > 0) {
          // Fetch full prompt details for the first one
          const fullPrompt = await promptsApi.getById(sorted[0].id);
          setSelectedPrompt(fullPrompt);
        }
      }
    } catch (err) {
      console.error('Failed to load prompts data:', err);

      if (err instanceof TypeError) {
        showToast('error', t('backendUnavailable'));
        return;
      }

      if (err instanceof ApiError) {
        showToast('error', `${t('loadFailed')}: ${err.message}`);
        return;
      }

      if (err instanceof Error) {
        showToast('error', `${t('loadFailed')}: ${err.message}`);
        return;
      }

      showToast('error', t('loadFailed'));
    }
  };

  const loadVersions = async (promptId: string) => {
    try {
      const data = await promptsApi.getVersions(promptId);
      setVersions(data);
    } catch {
      setVersions([]);
    }
  };

  const handleSelectPrompt = async (promptId: string) => {
    if (loadingPromptId === promptId || selectedPrompt?.id === promptId) return;

    const requestId = ++selectPromptRequestIdRef.current;
    setLoadingPromptId(promptId);
    setSelectedPrompt(null);

    try {
      const fullPrompt = await promptsApi.getById(promptId);
      if (selectPromptRequestIdRef.current !== requestId) return;
      setSelectedPrompt(fullPrompt);
    } catch (e) {
      if (selectPromptRequestIdRef.current !== requestId) return;
      showToast('error', t('loadFailed') + ': ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      if (selectPromptRequestIdRef.current === requestId) {
        setLoadingPromptId(null);
      }
    }
  };

  const handleCreatePrompt = async () => {
    if (!newPromptName.trim()) return;
    try {
      const data = await promptsApi.create({
        name: newPromptName.trim(),
        description: '',
        content: '',
        variables: [],
        messages: [],
        config: toApiConfig(DEFAULT_PROMPT_CONFIG),
        groupId: newPromptGroupId ? newPromptGroupId : null,
      });

      setPrompts((prev) => [data as Prompt, ...prev]);
      setSelectedPrompt(data as Prompt);
      invalidatePromptsCache(data);
      setNewPromptName('');
      setNewPromptGroupId('');
      setShowNewPrompt(false);
      showToast('success', t('promptCreated'));
    } catch (e) {
      showToast('error', t('createFailed') + ': ' + (e instanceof Error ? e.message : 'Unknown error'));
    }
  };

  const startEditGroupName = (group: PromptGroup) => {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
  };

  const cancelEditGroupName = () => {
    setEditingGroupId(null);
    setEditingGroupName('');
  };

  const saveEditingGroupName = async (groupId: string) => {
    const nextName = editingGroupName.trim() || t('unnamedGroup');
    const currentName = promptGroups.find((g) => g.id === groupId)?.name ?? '';

    if (currentName === nextName) {
      cancelEditGroupName();
      return true;
    }

    try {
      const updated = await promptGroupsApi.update(groupId, { name: nextName });
      setPromptGroups((prev) => prev.map((g) => (g.id === groupId ? (updated as PromptGroup) : g)));
      cancelEditGroupName();
      return true;
    } catch (e) {
      showToast('error', t('updateFailed') + ': ' + (e instanceof Error ? e.message : 'Unknown error'));
      return false;
    }
  };

  const handleQuickCreateGroup = async (parentId: string | null) => {
    if (creatingGroup) return;

    setCreatingGroup(true);
    try {
      const group = await promptGroupsApi.create({
        name: t('unnamedGroup'),
        parentId,
      });

      setPromptGroups((prev) => [...prev, group as PromptGroup]);
      setExpandedGroupIds((prev) => ({
        ...prev,
        ...(parentId ? { [parentId]: true } : {}),
        [group.id]: true,
      }));

      startEditGroupName(group as PromptGroup);
    } catch (e) {
      showToast('error', t('createGroupFailed') + ': ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setCreatingGroup(false);
    }
  };

  const requestDeleteGroup = (group: PromptGroup) => {
    setDeleteGroupTarget(group);
    setShowDeleteGroupConfirm(true);
  };

  const deleteGroupById = async (groupId: string) => {
    setDeletingGroupId(groupId);
    try {
      await promptGroupsApi.delete(groupId);

      setPromptGroups((prev) =>
        prev
          .filter((g) => g.id !== groupId)
          // Server lifts direct children to top-level when deleting a parent group.
          .map((g) => (g.parentId === groupId ? { ...g, parentId: null } : g))
      );

      setPrompts((prev) => prev.map((p) => (p.groupId === groupId ? { ...p, groupId: null } : p)));
      setSelectedPrompt((prev) => (prev && prev.groupId === groupId ? { ...prev, groupId: null } : prev));
      setExpandedGroupIds((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });

      if (editingGroupId === groupId) {
        cancelEditGroupName();
      }

      showToast('success', t('groupDeleted'));
      return true;
    } catch (e) {
      showToast('error', t('deleteGroupFailed') + ': ' + (e instanceof Error ? e.message : 'Unknown error'));
      return false;
    } finally {
      setDeletingGroupId(null);
    }
  };

  const handleSave = async (commitMessage: string): Promise<boolean> => {
    if (!selectedPrompt) return false;

    const hasContent =
      promptMessages.length > 0
        ? promptMessages.some((m) => m.content.trim().length > 0)
        : promptContent.trim().length > 0;

    if (!hasContent) {
      showToast('error', t('writePromptFirst'));
      return false;
    }

    setSaving(true);
    try {
      const contentToSave =
        promptMessages.length > 0 ? JSON.stringify(toApiMessages(promptMessages)) : promptContent;

      // Create new version
      const createdVersion = await promptsApi.createVersion(selectedPrompt.id, {
        content: contentToSave,
        commitMessage,
        variables: promptVariables,
        messages: toApiMessages(promptMessages),
        config: toApiConfig(promptConfig),
        defaultModelId: selectedModel || null,
      });

      // Update prompt
      const updatedPrompt = await promptsApi.update(selectedPrompt.id, {
        name: promptName,
        content: promptContent,
        messages: toApiMessages(promptMessages),
        config: toApiConfig(promptConfig),
        variables: promptVariables,
        defaultModelId: selectedModel || undefined,
      });

      setSelectedPrompt(updatedPrompt as Prompt);
      setPrompts((prev) =>
        prev.map((p) => (p.id === selectedPrompt.id ? updatedPrompt as Prompt : p))
      );
      loadVersions(selectedPrompt.id);
      showToast('success', t('savedVersion', { version: createdVersion.version }));

      // 通知其他页面刷新 prompts 缓存
      invalidatePromptsCache(updatedPrompt);
      return true;
    } catch (e) {
      showToast('error', t('saveFailed') + ': ' + (e instanceof Error ? e.message : 'Unknown error'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmSaveVersion = async () => {
    const hasContent =
      promptMessages.length > 0
        ? promptMessages.some((m) => m.content.trim().length > 0)
        : promptContent.trim().length > 0;

    if (!hasContent) {
      showToast('error', t('writePromptFirst'));
      setShowSaveVersion(false);
      return;
    }

    const commitMessage = versionNotes.trim();
    if (!commitMessage) {
      setVersionNotesError(t('versionNotesRequired'));
      return;
    }

    setVersionNotesError(null);
    const saved = await handleSave(commitMessage);
    if (saved) {
      setShowSaveVersion(false);
      setVersionNotes('');
    }
  };

  // Build prompt from messages
  const buildPromptFromMessages = useCallback(() => {
    if (promptMessages.length > 0) {
      return promptMessages.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n');
    }
    return promptContent;
  }, [promptMessages, promptContent]);

  const requestDeletePrompt = (promptId: string) => {
    const listItem = prompts.find((p) => p.id === promptId);
    const name = listItem?.name || (selectedPrompt?.id === promptId ? selectedPrompt.name : 'Prompt');
    setDeleteConfirmTarget({ id: promptId, name });
    setShowDeleteConfirm(true);
  };

  const handleQuickCopyPrompt = async (promptId: string) => {
    try {
      setCopyingPromptId(promptId);
      const fullPrompt = await promptsApi.getById(promptId);

      const copied = await promptsApi.create({
        name: `${fullPrompt.name} (${tEval('copy')})`,
        description: fullPrompt.description || '',
        content: fullPrompt.content || '',
        variables: fullPrompt.variables || [],
        messages: fullPrompt.messages || [],
        config: toApiConfig(toFrontendConfig(fullPrompt.config)),
        defaultModelId: fullPrompt.defaultModelId || undefined,
      });

      setPrompts((prev) => [copied as Prompt, ...prev]);
      setSelectedPrompt(copied as Prompt);
      invalidatePromptsCache(copied);
      showToast('success', tCommon('copied'));
    } catch (e) {
      showToast('error', t('copyFailed') + ': ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setCopyingPromptId(null);
    }
  };

  const deletePromptById = async (promptId: string): Promise<boolean> => {
    try {
      setDeletingPromptId(promptId);
      await promptsApi.delete(promptId);
      invalidatePromptsCache();

      const remaining = prompts.filter((p) => p.id !== promptId);
      setPrompts(remaining);

      showToast('success', t('promptDeleted'));

      if (selectedPrompt?.id === promptId) {
        if (remaining.length > 0) {
          await handleSelectPrompt(remaining[0].id);
        } else {
          setSelectedPrompt(null);
        }
      }

      return true;
    } catch (e) {
      showToast('error', t('deleteFailed') + ': ' + (e instanceof Error ? e.message : 'Unknown error'));
      return false;
    } finally {
      setDeletingPromptId(null);
    }
  };

  const handleDeletePrompt = () => {
    if (!selectedPrompt) return;
    requestDeletePrompt(selectedPrompt.id);
  };

  const handleRestoreVersion = async (version: PromptVersion) => {
    // Restore snapshot fields when available
    if (version.variables) {
      setPromptVariables(version.variables as PromptVariable[]);
    }
    if (version.config) {
      setPromptConfig(toFrontendConfig(version.config));
    }
    if (typeof version.defaultModelId !== 'undefined') {
      setSelectedModel(version.defaultModelId || '');
    }

    const applyMessages = (messages: unknown) => {
      setPromptMessages(toFrontendMessages(messages));
      setPromptContent('');
    };

    const applyContent = (content: string) => {
      setPromptMessages([]);
      setPromptContent(content);
    };

    // Prefer explicit messages field; fallback to parsing content for legacy versions.
    if (version.messages && version.messages.length > 0) {
      applyMessages(version.messages);
    } else {
      try {
        const parsed = JSON.parse(version.content) as unknown;
        if (Array.isArray(parsed)) {
          applyMessages(parsed);
        } else {
          applyContent(version.content);
        }
      } catch {
        applyContent(version.content);
      }
    }
    setShowVersions(false);
    showToast('info', t('restoredToVersion', { version: version.version }));
  };

  const handleDragStart = (prompt: Prompt) => {
    if (searchQuery.trim()) return;
    setDraggedPromptId(prompt.id);
    setDraggedPromptGroupId(prompt.groupId ?? null);
  };

  const handleDragOver = (e: React.DragEvent, targetPrompt: Prompt) => {
    e.preventDefault();
    if (searchQuery.trim()) return;
    if (!draggedPromptId) return;
    if (draggedPromptId === targetPrompt.id) return;

    const draggedPrompt = prompts.find((p) => p.id === draggedPromptId);
    if (!draggedPrompt) return;

    const currentGroupId = draggedPrompt.groupId ?? null;
    const targetGroupId = targetPrompt.groupId ?? null;

    const currentList = promptsByGroupId.get(currentGroupId) ?? [];
    const targetList = promptsByGroupId.get(targetGroupId) ?? [];

    const fromIndex = currentList.findIndex((p) => p.id === draggedPromptId);
    if (fromIndex === -1) return;

    if (currentGroupId === targetGroupId) {
      const toIndex = currentList.findIndex((p) => p.id === targetPrompt.id);
      if (toIndex === -1) return;

      const reordered = [...currentList];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);

      const orderIndexById = new Map<string, number>();
      reordered.forEach((p, i) => orderIndexById.set(p.id, i));

      setPrompts((prev) =>
        prev.map((p) => (orderIndexById.has(p.id) ? { ...p, orderIndex: orderIndexById.get(p.id)! } : p))
      );
      return;
    }

    const toIndex = targetList.findIndex((p) => p.id === targetPrompt.id);
    if (toIndex === -1) return;

    const sourceNext = [...currentList];
    const [moved] = sourceNext.splice(fromIndex, 1);

    const targetNext = [...targetList].filter((p) => p.id !== draggedPromptId);
    targetNext.splice(toIndex, 0, { ...moved, groupId: targetGroupId });

    const updates = new Map<string, { orderIndex: number; groupId?: string | null }>();
    sourceNext.forEach((p, i) => updates.set(p.id, { orderIndex: i }));
    targetNext.forEach((p, i) =>
      updates.set(p.id, { orderIndex: i, ...(p.id === draggedPromptId ? { groupId: targetGroupId } : {}) })
    );

    setPrompts((prev) =>
      prev.map((p) => {
        const next = updates.get(p.id);
        if (!next) return p;
        return { ...p, orderIndex: next.orderIndex, ...(typeof next.groupId !== 'undefined' ? { groupId: next.groupId } : {}) };
      })
    );

    setSelectedPrompt((prev) => (prev && prev.id === draggedPromptId ? { ...prev, groupId: targetGroupId } : prev));
  };

  const handleDragOverGroup = (e: React.DragEvent, targetGroupId: string | null) => {
    e.preventDefault();
    if (searchQuery.trim()) return;
    if (!draggedPromptId) return;

    const draggedPrompt = prompts.find((p) => p.id === draggedPromptId);
    if (!draggedPrompt) return;

    const currentGroupId = draggedPrompt.groupId ?? null;
    const currentList = promptsByGroupId.get(currentGroupId) ?? [];
    const targetList = promptsByGroupId.get(targetGroupId) ?? [];

    const fromIndex = currentList.findIndex((p) => p.id === draggedPromptId);
    if (fromIndex === -1) return;

    const sourceNext = [...currentList];
    const [moved] = sourceNext.splice(fromIndex, 1);

    const targetNext = [...targetList].filter((p) => p.id !== draggedPromptId);
    targetNext.push({ ...moved, groupId: targetGroupId });

    const updates = new Map<string, { orderIndex: number; groupId?: string | null }>();
    sourceNext.forEach((p, i) => updates.set(p.id, { orderIndex: i }));
    targetNext.forEach((p, i) =>
      updates.set(p.id, { orderIndex: i, ...(p.id === draggedPromptId ? { groupId: targetGroupId } : {}) })
    );

    setPrompts((prev) =>
      prev.map((p) => {
        const next = updates.get(p.id);
        if (!next) return p;
        return { ...p, orderIndex: next.orderIndex, ...(typeof next.groupId !== 'undefined' ? { groupId: next.groupId } : {}) };
      })
    );

    setSelectedPrompt((prev) => (prev && prev.id === draggedPromptId ? { ...prev, groupId: targetGroupId } : prev));
  };

  const handleDragEnd = async () => {
    if (isFinalizingDragRef.current) return;

    const currentDraggedId = draggedPromptId;
    const currentDraggedGroupId = draggedPromptGroupId;

    // Clear drag state immediately to remove visual feedback
    setDraggedPromptId(null);
    setDraggedPromptGroupId(null);

    if (!currentDraggedId) return;
    if (searchQuery.trim()) return;

    isFinalizingDragRef.current = true;

    const sourceGroupId = currentDraggedGroupId ?? null;
    const draggedPrompt = prompts.find((p) => p.id === currentDraggedId);
    const targetGroupId = draggedPrompt?.groupId ?? null;

    const affectedGroupIds = Array.from(new Set([sourceGroupId, targetGroupId]));
    const updates = affectedGroupIds.flatMap((groupId) =>
      (promptsByGroupId.get(groupId) ?? []).map((p, i) => ({ id: p.id, orderIndex: i }))
    );

    try {
      if (sourceGroupId !== targetGroupId) {
        await promptsApi.update(currentDraggedId, { groupId: targetGroupId });
      }
      if (updates.length > 0) {
        await promptsApi.batchUpdateOrder(updates);
      }
    } catch (e) {
      console.error('Failed to update order:', e);
    } finally {
      isFinalizingDragRef.current = false;
    }
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

      if (!model) {
        showToast('error', t('selectAnalyzeModelFirst'));
        return [];
      }

      const result = await analyzePrompt(model.id, {
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

  type GroupTreeNode = PromptGroup & { depth: number; children: GroupTreeNode[] };

  const groupTree = useMemo<GroupTreeNode[]>(() => {
    const byParent = new Map<string | null, PromptGroup[]>();
    for (const g of promptGroups) {
      const key = g.parentId ?? null;
      byParent.set(key, [...(byParent.get(key) ?? []), g]);
    }

    const sortGroups = (list: PromptGroup[]) =>
      [...list].sort((a, b) => {
        const orderDiff = (a.orderIndex || 0) - (b.orderIndex || 0);
        if (orderDiff !== 0) return orderDiff;
        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      });

    const build = (parentId: string | null, depth: number): GroupTreeNode[] => {
      if (depth > 3) return [];
      const children = sortGroups(byParent.get(parentId) ?? []);
      return children.map((g) => ({
        ...g,
        depth,
        children: build(g.id, depth + 1),
      }));
    };

    return build(null, 1);
  }, [promptGroups]);

  const groupSelectOptions = useMemo(() => {
    const options: Array<{ value: string; label: string; depth: number }> = [];

    const walk = (nodes: GroupTreeNode[]) => {
      for (const node of nodes) {
        // Use non-breaking spaces for proper indentation in select options
        // depth 1: no indent, depth 2: "├─ ", depth 3: "│  ├─ ", etc.
        let prefix = '';
        if (node.depth > 1) {
          // Add vertical lines for each level above
          prefix = '\u00A0\u00A0\u00A0'.repeat(node.depth - 2) + '├─\u00A0';
        }
        options.push({ value: node.id, label: `${prefix}${node.name}`, depth: node.depth });
        if (node.children.length > 0) walk(node.children);
      }
    };

    walk(groupTree);
    return options;
  }, [groupTree]);

  const promptsByGroupId = useMemo(() => {
    const map = new Map<string | null, Prompt[]>();
    for (const p of filteredPrompts) {
      const key = p.groupId ?? null;
      map.set(key, [...(map.get(key) ?? []), p]);
    }

    for (const [key, list] of map.entries()) {
      map.set(
        key,
        [...list].sort((a, b) => {
          const orderDiff = (a.orderIndex || 0) - (b.orderIndex || 0);
          if (orderDiff !== 0) return orderDiff;
          return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
        })
      );
    }

    return map;
  }, [filteredPrompts]);

  const getModelName = (modelId: string | null) => {
    if (!modelId) return null;
    return models.find((m) => m.id === modelId)?.name;
  };

  const formatRelativeTime = (dateString: string | null | undefined) => {
    if (!dateString) return '-';

    const date = new Date(dateString);

    // Check if date is valid
    if (isNaN(date.getTime())) return '-';

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

  // 计算比较功能的文件上传能力（取两个模型的交集）
  const compareFileUploadCapabilities = useMemo(() => {
    return { accept: getFileInputAccept() };
  }, []);

  const compareVisionEligible = useMemo(() => {
    if (compareMode === 'models') {
      const model1 = models.find((m) => m.id === compareModels[0]);
      const model2 = models.find((m) => m.id === compareModels[1]);
      return !!model1?.supportsVision && !!model2?.supportsVision;
    }

    const model = models.find((m) => m.id === compareModel);
    return !!model?.supportsVision;
  }, [compareMode, compareModels, compareModel, models]);

  useEffect(() => {
    if (compareFileProcessing === 'vision' && !compareVisionEligible) {
      setCompareFileProcessing('auto');
    }
  }, [compareFileProcessing, compareVisionEligible]);

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

    if (compareMode === 'models') {
      const version = versions.find((v) => v.id === compareVersion);
      if (!version) return;

      leftPrompt = version.content;
      rightPrompt = version.content;
      leftModel = models.find((m) => m.id === compareModels[0]);
      rightModel = models.find((m) => m.id === compareModels[1]);
    } else {
      const version1 = versions.find((v) => v.id === compareVersions[0]);
      const version2 = versions.find((v) => v.id === compareVersions[1]);
      if (!version1 || !version2) return;

      leftPrompt = version1.content;
      rightPrompt = version2.content;
      const model = models.find((m) => m.id === compareModel);
      leftModel = rightModel = model;
    }

    if (!leftModel || !rightModel) {
      showToast('error', t('modelConfigError'));
      setCompareRunning({ left: false, right: false });
      return;
    }

    // Build user content with attachments
    const buildUserContent = (prompt: string): string | ContentPart[] => {
      const fullPrompt = compareInput ? `${prompt}\n\n${compareInput}` : prompt;
      if (compareFiles.length > 0) {
        const contentParts: ContentPart[] = [
          { type: 'text' as const, text: fullPrompt }
        ];
        for (const file of compareFiles) {
          contentParts.push({
            type: 'file_ref' as const,
            file_ref: { fileId: file.fileId },
          });
        }
        return contentParts;
      }
      return fullPrompt;
    };

    // 运行左侧
    const runLeft = async () => {
      let fullContent = '';
      let accumulatedThinking = '';
      let isCurrentlyThinking = false;
      let tokensIn = 0;
      let tokensOut = 0;

      try {
        await chatApi.streamWithCallbacks(
          {
            modelId: leftModel!.id,
            messages: [{ role: 'user', content: buildUserContent(leftPrompt) }],
            temperature: compareParams.left.temperature,
            top_p: compareParams.left.top_p,
            max_tokens: compareParams.left.max_tokens,
            frequency_penalty: compareParams.left.frequency_penalty,
            presence_penalty: compareParams.left.presence_penalty,
            reasoning: compareParams.left.reasoning,
            saveTrace: false,
            fileProcessing: compareFileProcessing,
            ocrProvider: compareOcrProviderOverride || undefined,
          },
          {
            onToken: (token) => {
              fullContent += token;

              if (isCurrentlyThinking) {
                isCurrentlyThinking = false;
              }

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
            onComplete: (result) => {
              tokensIn = result.usage?.prompt_tokens || 0;
              tokensOut = result.usage?.completion_tokens || 0;
              const { thinking, content } = extractThinking(result.content);
              setCompareResults((prev) => ({
                ...prev,
                left: { content, thinking: result.thinking || thinking || accumulatedThinking, latency: Date.now() - startTimeLeft, tokensIn, tokensOut },
              }));
              setCompareRunning((prev) => ({ ...prev, left: false }));
            },
            onError: (error) => {
              setCompareResults((prev) => ({
                ...prev,
                left: { content: '', thinking: '', latency: 0, tokensIn: 0, tokensOut: 0, error: error.message },
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
          leftController.signal
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
        await chatApi.streamWithCallbacks(
          {
            modelId: rightModel!.id,
            messages: [{ role: 'user', content: buildUserContent(rightPrompt) }],
            temperature: compareParams.right.temperature,
            top_p: compareParams.right.top_p,
            max_tokens: compareParams.right.max_tokens,
            frequency_penalty: compareParams.right.frequency_penalty,
            presence_penalty: compareParams.right.presence_penalty,
            reasoning: compareParams.right.reasoning,
            saveTrace: false,
            fileProcessing: compareFileProcessing,
            ocrProvider: compareOcrProviderOverride || undefined,
          },
          {
            onToken: (token) => {
              fullContent += token;

              if (isCurrentlyThinking) {
                isCurrentlyThinking = false;
              }

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
            onComplete: (result) => {
              tokensIn = result.usage?.prompt_tokens || 0;
              tokensOut = result.usage?.completion_tokens || 0;
              const { thinking, content } = extractThinking(result.content);
              setCompareResults((prev) => ({
                ...prev,
                right: { content, thinking: result.thinking || thinking || accumulatedThinking, latency: Date.now() - startTimeRight, tokensIn, tokensOut },
              }));
              setCompareRunning((prev) => ({ ...prev, right: false }));
            },
            onError: (error) => {
              setCompareResults((prev) => ({
                ...prev,
                right: { content: '', thinking: '', latency: 0, tokensIn: 0, tokensOut: 0, error: error.message },
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
          rightController.signal
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

    for (const file of Array.from(files)) {
      if (file.size > maxSize) {
        showToast('error', t('fileTooLarge', { name: file.name }));
        continue;
      }

      if (!isSupportedFileType(file)) {
        showToast('error', t('unsupportedFileType', { name: file.name }));
        continue;
      }

      try {
        const attachment = await uploadFileAttachment(file);
        setCompareFiles((prev) => [...prev, attachment]);
      } catch {
        showToast('error', t('fileReadFailed', { name: file.name }));
      }
    }

    if (compareFileInputRef.current) {
      compareFileInputRef.current.value = '';
    }
  };

  const removeCompareFile = (index: number) => {
    setCompareFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleGroupExpanded = useCallback((groupId: string) => {
    setExpandedGroupIds((prev) => ({ ...prev, [groupId]: !(prev[groupId] ?? true) }));
  }, []);

  const isGroupExpanded = useCallback(
    (groupId: string) => (searchQuery.trim() ? true : expandedGroupIds[groupId] ?? true),
    [expandedGroupIds, searchQuery]
  );

  const groupHasVisibleContent = useCallback(
    (node: GroupTreeNode): boolean => {
      const directPrompts = promptsByGroupId.get(node.id) ?? [];
      if (directPrompts.length > 0) return true;
      return node.children.some(groupHasVisibleContent);
    },
    [promptsByGroupId]
  );

  const renderPromptRow = (prompt: Prompt, depth: number) => {
    const modelName = getModelName(prompt.defaultModelId);
    const isActive = selectedPrompt?.id === prompt.id || loadingPromptId === prompt.id;
    const paddingLeft = 12 + Math.max(0, depth - 1) * 12;
    const dragEnabled = !searchQuery.trim();

    return (
      <div
        key={prompt.id}
        draggable={dragEnabled}
        onDragStart={() => handleDragStart(prompt)}
        onDragOver={(e) => handleDragOver(e, prompt)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void handleDragEnd();
        }}
        onDragEnd={handleDragEnd}
        onClick={() => handleSelectPrompt(prompt.id)}
        style={{ paddingLeft }}
        className={`group w-full flex items-start gap-2 pr-3 py-3 rounded-lg text-left transition-colors cursor-pointer ${
          isActive
            ? 'bg-slate-800 light:bg-cyan-50 border border-slate-600 light:border-cyan-200'
            : 'hover:bg-slate-800/50 light:hover:bg-slate-100 border border-transparent'
        } ${draggedPromptId === prompt.id ? 'opacity-50' : ''}`}
      >
        {dragEnabled ? (
          <GripVertical className="w-4 h-4 text-slate-600 light:text-slate-400 mt-0.5 flex-shrink-0 cursor-grab active:cursor-grabbing" />
        ) : (
          <div className="w-4 h-4 mt-0.5 flex-shrink-0" />
        )}
        {loadingPromptId === prompt.id ? (
          <Loader2 className="w-5 h-5 text-slate-500 light:text-slate-400 mt-0.5 flex-shrink-0 animate-spin" />
        ) : (
          <FileText className="w-5 h-5 text-slate-500 light:text-slate-400 mt-0.5 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">
            {prompt.name}
          </p>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500 light:text-slate-600 whitespace-nowrap">
            <span>v{prompt.currentVersion}</span>
            <span className="text-slate-600 light:text-slate-400">|</span>
            <Clock className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{formatRelativeTime(prompt.updatedAt)}</span>
          </div>
          {modelName && (
            <div className="flex items-center gap-1 mt-1.5">
              <Cpu className="w-3 h-3 text-cyan-500 light:text-cyan-600" />
              <span className="text-xs text-cyan-400 light:text-cyan-600 truncate">{modelName}</span>
            </div>
          )}
        </div>

        <div
          className={`flex items-center gap-1 mt-0.5 transition-opacity ${
            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          <button
            type="button"
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              handleQuickCopyPrompt(prompt.id);
            }}
            disabled={copyingPromptId === prompt.id || deletingPromptId === prompt.id}
            className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={tCommon('copy')}
          >
            {copyingPromptId === prompt.id ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              requestDeletePrompt(prompt.id);
            }}
            disabled={deletingPromptId === prompt.id || copyingPromptId === prompt.id}
            className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-rose-400 light:text-rose-500 hover:text-rose-300 light:hover:text-rose-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={tCommon('delete')}
          >
            {deletingPromptId === prompt.id ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    );
  };

  const renderGroupNode = (node: GroupTreeNode) => {
    const showEmptyGroups = !searchQuery.trim();
    const hasContent = groupHasVisibleContent(node);
    if (!showEmptyGroups && !hasContent) return null;

    const expanded = isGroupExpanded(node.id);
    const isEditingName = editingGroupId === node.id;
    const paddingLeft = 12 + Math.max(0, node.depth - 1) * 12;

    return (
      <div key={node.id} className="space-y-1">
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            if (isEditingName) return;
            toggleGroupExpanded(node.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (isEditingName) return;
              toggleGroupExpanded(node.id);
            }
          }}
          onDragOver={(e) => handleDragOverGroup(e, node.id)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void handleDragEnd();
          }}
          style={{ paddingLeft }}
          className="group w-full flex items-center gap-2 pr-3 py-2 rounded-lg text-left transition-colors cursor-pointer hover:bg-slate-800/50 light:hover:bg-slate-100 border border-transparent"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-500 light:text-slate-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500 light:text-slate-400 flex-shrink-0" />
          )}
          <Folder className="w-4 h-4 text-slate-500 light:text-slate-400 flex-shrink-0" />
          {isEditingName ? (
            <input
              ref={editingGroupInputRef}
              value={editingGroupName}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditingGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  ignoreGroupNameBlurRef.current = true;
                  void saveEditingGroupName(node.id);
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  ignoreGroupNameBlurRef.current = true;
                  cancelEditGroupName();
                }
              }}
              onBlur={() => {
                if (ignoreGroupNameBlurRef.current) {
                  ignoreGroupNameBlurRef.current = false;
                  return;
                }
                void saveEditingGroupName(node.id);
              }}
              className="flex-1 min-w-0 px-2 py-1 bg-slate-800/60 light:bg-white border border-slate-700 light:border-slate-300 rounded text-sm font-medium text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500"
            />
          ) : (
            <span
              className="flex-1 min-w-0 text-sm font-medium text-slate-200 light:text-slate-800 truncate"
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEditGroupName(node);
              }}
              title={tCommon('edit')}
            >
              {node.name}
            </span>
          )}

          <div className="flex items-center gap-1 transition-opacity opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            {node.depth < 3 && (
              <button
                type="button"
                draggable={false}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleQuickCreateGroup(node.id);
                }}
                disabled={creatingGroup}
                className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={t('addChildGroup')}
              >
                <FolderPlus className="w-4 h-4" />
              </button>
            )}
            {!isEditingName && (
              <button
                type="button"
                draggable={false}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  startEditGroupName(node);
                }}
                className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors"
                title={tCommon('edit')}
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                requestDeleteGroup(node);
              }}
              className="p-1.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-rose-400 light:text-rose-500 hover:text-rose-300 light:hover:text-rose-600 transition-colors"
              title={tCommon('delete')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {expanded && (
          <div className="space-y-1">
            {node.children.map((child) => renderGroupNode(child))}
            {(promptsByGroupId.get(node.id) ?? []).map((p) => renderPromptRow(p, node.depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const tabs = [
    { id: 'edit' as TabType, label: t('tabEdit'), icon: <FileText className="w-4 h-4" /> },
    { id: 'observe' as TabType, label: t('tabHistory'), icon: <Eye className="w-4 h-4" /> },
    { id: 'optimize' as TabType, label: t('tabOptimize'), icon: <Sparkles className="w-4 h-4" /> },
  ];

  return (
    <div className="h-full flex overflow-hidden bg-slate-950 light:bg-slate-50">
      {/* Left sidebar - Prompt list */}
      <div className="w-80 bg-slate-900/50 light:bg-white border-r border-slate-700 light:border-slate-200 flex flex-col overflow-hidden">
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
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => void handleQuickCreateGroup(null)}
            disabled={creatingGroup}
          >
            <FolderPlus className="w-4 h-4" />
            <span>{t('newGroup')}</span>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredPrompts.length === 0 && searchQuery.trim() ? (
            <div className="px-3 py-6 text-center text-sm text-slate-500 light:text-slate-600">
              {t('noResults')}
            </div>
          ) : (
            <>
              {groupTree.map((node) => renderGroupNode(node))}

              {(() => {
                const ungroupedPrompts = promptsByGroupId.get(null) ?? [];
                const showUngrouped = !searchQuery.trim() || ungroupedPrompts.length > 0;
                if (!showUngrouped) return null;

                const ungroupedKey = '__ungrouped__';
                const expanded = isGroupExpanded(ungroupedKey);

                return (
                  <div key={ungroupedKey} className="space-y-1">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleGroupExpanded(ungroupedKey)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleGroupExpanded(ungroupedKey);
                        }
                      }}
                      onDragOver={(e) => handleDragOverGroup(e, null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void handleDragEnd();
                      }}
                      style={{ paddingLeft: 12 }}
                      className="w-full flex items-center gap-2 pr-3 py-2 rounded-lg text-left transition-colors cursor-pointer hover:bg-slate-800/50 light:hover:bg-slate-100 border border-transparent"
                    >
                      {expanded ? (
                        <ChevronDown className="w-4 h-4 text-slate-500 light:text-slate-400 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-500 light:text-slate-400 flex-shrink-0" />
                      )}
                      <Folder className="w-4 h-4 text-slate-500 light:text-slate-400 flex-shrink-0" />
                      <span className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">{t('ungrouped')}</span>
                    </div>

                    {expanded && (
                      <div className="space-y-1">
                        {ungroupedPrompts.map((p) => renderPromptRow(p, 2))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
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
                <Badge variant="info">v{selectedPrompt.currentVersion}</Badge>
                {hasUnsavedChanges && <Badge variant="warning">{t('unsaved')}</Badge>}
                <button
                  onClick={async () => {
                    const newValue = !selectedPrompt.isPublic;
                    try {
                      await promptsApi.update(selectedPrompt.id, { isPublic: newValue });
                      setSelectedPrompt({ ...selectedPrompt, isPublic: newValue });
                      setPrompts((prev) => prev.map((p) => p.id === selectedPrompt.id ? { ...p, isPublic: newValue } : p));
                      showToast('success', newValue ? t('promptPublic') : t('promptPrivate'));
                    } catch {
                      showToast('error', t('updateFailed'));
                    }
                  }}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                    selectedPrompt.isPublic
                      ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                      : 'bg-slate-700 text-slate-400 hover:bg-slate-600 light:bg-slate-200 light:text-slate-500 light:hover:bg-slate-300'
                  }`}
                  title={selectedPrompt.isPublic ? t('clickToPrivate') : t('clickToPublic')}
                >
                  <Globe className="w-3 h-3" />
                  {selectedPrompt.isPublic ? t('public') : t('private')}
                </button>
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const hasContent =
                      promptMessages.length > 0
                        ? promptMessages.some((m) => m.content.trim().length > 0)
                        : promptContent.trim().length > 0;

                    if (!hasContent) {
                      showToast('error', t('writePromptFirst'));
                      return;
                    }

                    setVersionNotes('');
                    setVersionNotesError(null);
                    setShowSaveVersion(true);
                  }}
                  loading={saving}
                >
                  <Save className="w-4 h-4" />
                  <span>{t('submitNewVersion')}</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDeletePrompt} disabled={deletingPromptId === selectedPrompt.id}>
                  {deletingPromptId === selectedPrompt.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4 text-red-400" />
                  )}
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
                        modelId={models.find(m => m.id === selectedModel)?.modelId}
                        supportsReasoning={models.find(m => m.id === selectedModel)?.supportsReasoning}
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
                  <PromptTestPanel
                    models={models}
                    providers={providers}
                    selectedModelId={selectedModel}
                    onModelSelect={setSelectedModel}
                    variables={promptVariables}
                    variableValues={variableValues}
                    onVariableValuesChange={setVariableValues}
                    testInput={testInput}
                    onTestInputChange={setTestInput}
                    promptText={buildPromptFromMessages()}
                    config={promptConfig}
                    outputSchema={promptConfig.output_schema}
                    promptId={selectedPrompt?.id}
                    saveTrace={true}
                    showFileUpload={true}
                    attachedFiles={attachedFiles}
                    onAttachedFilesChange={setAttachedFiles}
                    externalOutput={testOutput}
                    externalThinking={testThinking}
                    onOutputChange={setTestOutput}
                    onThinkingChange={setTestThinking}
                    onRunComplete={(result) => {
                      const runId = `run_${Date.now()}`;
                        const newRun: DebugRun = {
                          id: runId,
                          input: result.input,
                          inputVariables: {},
                          output: result.output,
                          status: result.status,
                          errorMessage: result.errorMessage,
                          latencyMs: result.latencyMs,
                          tokensInput: result.tokensInput,
                          tokensOutput: result.tokensOutput,
                          timestamp: new Date(),
                          attachments: result.attachments,
                          thinking: result.thinking,
                          ocrUsed: result.ocrUsed,
                          ocrProvider: result.ocrProvider,
                        };
                      setDebugRuns((prev) => [newRun, ...prev.slice(0, 19)]);
                    }}
                    className="flex-1 min-w-0 basis-0 bg-slate-900/20 light:bg-slate-100"
                  />
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

                      let anyReplaced = false;

                      if (suggestion.messageIndex !== undefined && promptMessages[suggestion.messageIndex]) {
                        // Try to replace in specific message
                        const result = smartReplace(
                          promptMessages[suggestion.messageIndex].content,
                          suggestion.originalText,
                          suggestion.suggestedText
                        );
                        if (result.replaced) {
                          const newMessages = [...promptMessages];
                          newMessages[suggestion.messageIndex] = {
                            ...newMessages[suggestion.messageIndex],
                            content: result.content,
                          };
                          setPromptMessages(newMessages);
                          anyReplaced = true;
                        }
                      }

                      if (!anyReplaced) {
                        // Try to replace in all messages
                        const newMessages = promptMessages.map((msg) => {
                          const result = smartReplace(msg.content, suggestion.originalText!, suggestion.suggestedText!);
                          if (result.replaced) anyReplaced = true;
                          return {
                            ...msg,
                            content: result.content,
                          };
                        });
                        if (anyReplaced) {
                          setPromptMessages(newMessages);
                        }
                      }

                      if (anyReplaced) {
                        showToast('success', t('suggestionApplied'));
                      } else {
                        showToast('info', '未找到匹配的文本，请手动修改');
                      }
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

      {/* Delete confirmation modal */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setDeleteConfirmTarget(null);
        }}
        title={t('confirmDelete')}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300 light:text-slate-700">
            {t('confirmDeletePrompt', { name: deleteConfirmTarget?.name || '' })}
          </p>
          <p className="text-sm text-slate-500 light:text-slate-600">{t('deleteCannotUndo')}</p>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setShowDeleteConfirm(false);
                setDeleteConfirmTarget(null);
              }}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              variant="danger"
              loading={!!deleteConfirmTarget && deletingPromptId === deleteConfirmTarget.id}
              disabled={!deleteConfirmTarget}
              onClick={async () => {
                if (!deleteConfirmTarget) return;
                const ok = await deletePromptById(deleteConfirmTarget.id);
                if (ok) {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmTarget(null);
                }
              }}
            >
              <Trash2 className="w-4 h-4" />
              {tCommon('delete')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete group confirmation modal */}
      <Modal
        isOpen={showDeleteGroupConfirm}
        onClose={() => {
          setShowDeleteGroupConfirm(false);
          setDeleteGroupTarget(null);
        }}
        title={t('confirmDelete')}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300 light:text-slate-700">
            {t('confirmDeleteGroup', { name: deleteGroupTarget?.name || '' })}
          </p>

          {!!deleteGroupTarget && (
            <div className="space-y-2">
              {(() => {
                const directPromptCount = prompts.filter((p) => (p.groupId ?? null) === deleteGroupTarget.id).length;
                const directChildGroupCount = promptGroups.filter((g) => (g.parentId ?? null) === deleteGroupTarget.id).length;

                return (
                  <>
                    {directPromptCount > 0 && (
                      <p className="text-sm text-slate-500 light:text-slate-600">
                        {t('deleteGroupWillUngroupPrompts', { count: directPromptCount })}
                      </p>
                    )}
                    {directChildGroupCount > 0 && (
                      <p className="text-sm text-slate-500 light:text-slate-600">
                        {t('deleteGroupWillPromoteChildren', { count: directChildGroupCount })}
                      </p>
                    )}
                    <p className="text-sm text-slate-500 light:text-slate-600">{t('deleteCannotUndo')}</p>
                  </>
                );
              })()}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setShowDeleteGroupConfirm(false);
                setDeleteGroupTarget(null);
              }}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              variant="danger"
              loading={!!deleteGroupTarget && deletingGroupId === deleteGroupTarget.id}
              disabled={!deleteGroupTarget}
              onClick={async () => {
                if (!deleteGroupTarget) return;
                const ok = await deleteGroupById(deleteGroupTarget.id);
                if (ok) {
                  setShowDeleteGroupConfirm(false);
                  setDeleteGroupTarget(null);
                }
              }}
            >
              <Trash2 className="w-4 h-4" />
              {tCommon('delete')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* New Prompt Modal */}
      <Modal
        isOpen={showNewPrompt}
        onClose={() => {
          setShowNewPrompt(false);
          setNewPromptGroupId('');
        }}
        title={t("newPrompt")}
      >
        <div className="space-y-4">
          <Input
            label={t("promptName")}
            value={newPromptName}
            onChange={(e) => setNewPromptName(e.target.value)}
            placeholder={t("promptNamePlaceholder")}
            autoFocus
          />
          <Select
            label={t('group')}
            value={newPromptGroupId}
            onChange={(e) => setNewPromptGroupId(e.target.value)}
            options={[
              { value: '', label: t('noGroup') },
              ...groupSelectOptions.map((g) => ({ value: g.value, label: g.label })),
            ]}
          />
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                setShowNewPrompt(false);
                setNewPromptGroupId('');
              }}
            >
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleCreatePrompt} disabled={!newPromptName.trim()}>
              {tCommon('create')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Save Version Modal */}
      <Modal
        isOpen={showSaveVersion}
        onClose={() => {
          setShowSaveVersion(false);
          setVersionNotesError(null);
        }}
        title={`${t('submitNewVersion')} (v${(selectedPrompt?.currentVersion ?? 0) + 1})`}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
              {t('versionNotes')}
            </label>
            <textarea
              value={versionNotes}
              onChange={(e) => setVersionNotes(e.target.value)}
              placeholder={t('versionNotesPlaceholder')}
              rows={4}
              className={`w-full px-3 py-2 bg-slate-800 light:bg-white border rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all ${
                versionNotesError ? 'border-rose-500' : 'border-slate-700 light:border-slate-300'
              }`}
            />
            {versionNotesError ? (
              <p className="text-xs text-rose-500">{versionNotesError}</p>
            ) : (
              <p className="text-xs text-slate-500 light:text-slate-600">{t('versionNotesHint')}</p>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setShowSaveVersion(false)} disabled={saving}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleConfirmSaveVersion} loading={saving}>
              {t('submitNewVersion')}
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
                    {tCommon('version')} {version.version}
                  </p>
                  <p className="text-xs text-slate-500 light:text-slate-600 flex items-center gap-1 mt-1">
                    <Clock className="w-3 h-3" />
                    {formatDateTime(version.createdAt)}
                  </p>
                  {version.commitMessage ? (
                    <p className="text-xs text-slate-400 light:text-slate-600 mt-2 whitespace-pre-wrap break-words">
                      {version.commitMessage}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500 light:text-slate-500 mt-2 italic">
                      {t('noVersionNotes')}
                    </p>
                  )}
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
                    label: `v${v.version} - ${formatDateTime(v.createdAt)}`,
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
                      label: `v${v.version} - ${formatDateTime(v.createdAt)}`,
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
                      label: `v${v.version} - ${formatDateTime(v.createdAt)}`,
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
                className="flex items-center gap-1 text-xs transition-colors text-cyan-400 hover:text-cyan-300"
              >
                <Paperclip className="w-3.5 h-3.5" />
                {t('addFile')}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Select
                label={tEval('fileProcessing')}
                value={compareFileProcessing}
                onChange={(e) => setCompareFileProcessing(e.target.value as typeof compareFileProcessing)}
                options={[
                  { value: 'auto', label: tEval('fileProcessingAuto') },
                  ...(compareVisionEligible ? [{ value: 'vision', label: tEval('fileProcessingVision') }] : []),
                  { value: 'ocr', label: tEval('fileProcessingOcr') },
                  { value: 'none', label: tEval('fileProcessingNone') },
                ]}
              />
              {(compareFileProcessing === 'ocr' ||
                (compareFileProcessing === 'auto' &&
                  !compareVisionEligible &&
                  (compareMode === 'models' ? (compareModels[0] || compareModels[1]) : !!compareModel))) && (
                <Select
                  value={compareOcrProviderOverride}
                  onChange={(e) => setCompareOcrProviderOverride(e.target.value as OcrProvider | '')}
                  options={[
                    { value: '', label: tEval('ocrProviderFollow') },
                    { value: 'paddle', label: 'PaddleOCR' },
                    { value: 'paddle_vl', label: tEval('ocrProviderPaddleVl') },
                    { value: 'datalab', label: tEval('ocrProviderDatalab') },
                    { value: 'mineru', label: tEval('ocrProviderMineru') },
                  ]}
                />
              )}
            </div>
            <input
              ref={compareFileInputRef}
              type="file"
              accept={compareFileUploadCapabilities.accept}
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
                      <FileIcon className="w-4 h-4 text-slate-400" />
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
                    const leftModel = compareMode === 'models'
                      ? models.find((m) => m.id === compareModels[0])
                      : models.find((m) => m.id === selectedModel);
                    const leftModelId = leftModel?.modelId;
                    const leftSupportsReasoning = leftModel?.supportsReasoning ?? (leftModelId ? inferReasoningSupport(leftModelId) : false);
                    return leftModelId && leftSupportsReasoning && (
                      <div className="flex items-center justify-between pt-2 border-t border-slate-600 light:border-slate-300">
                        <span className="text-xs text-slate-500">{t('reasoningEffort')}</span>
                        <ReasoningSelector
                          modelId={leftModelId}
                          supportsReasoning={leftSupportsReasoning}
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
                    const rightModel = compareMode === 'models'
                      ? models.find((m) => m.id === compareModels[1])
                      : models.find((m) => m.id === selectedModel);
                    const rightModelId = rightModel?.modelId;
                    const rightSupportsReasoning = rightModel?.supportsReasoning ?? (rightModelId ? inferReasoningSupport(rightModelId) : false);
                    return rightModelId && rightSupportsReasoning && (
                      <div className="flex items-center justify-between pt-2 border-t border-slate-600 light:border-slate-300">
                        <span className="text-xs text-slate-500">{t('reasoningEffort')}</span>
                        <ReasoningSelector
                          modelId={rightModelId}
                          supportsReasoning={rightSupportsReasoning}
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

            {showDebugDetail.attachments && showDebugDetail.attachments.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Paperclip className="w-4 h-4 text-slate-400" />
                  <h4 className="text-sm font-medium text-slate-300 light:text-slate-700">
                    {t('attachments')} ({showDebugDetail.attachments.length})
                  </h4>
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg min-h-[60px]">
                  <AttachmentList
                    attachments={showDebugDetail.attachments}
                    size="md"
                    maxVisible={10}
                    onPreview={setPreviewAttachment}
                  />
                </div>
              </div>
            )}

            {showDebugDetail.ocrUsed && showDebugDetail.attachments && showDebugDetail.attachments.length > 0 && (
              <OcrResultsPanel
                attachments={showDebugDetail.attachments}
                provider={showDebugDetail.ocrProvider}
              />
            )}

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
