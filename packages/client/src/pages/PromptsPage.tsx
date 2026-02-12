import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { flushSync } from 'react-dom';
import { useLocation } from 'react-router-dom';
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
  Link,
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
  Square,
  AlertCircle,
  Settings2,
  Globe,
  Play,
} from 'lucide-react';
import { Button, Input, Modal, Badge, Select, Toggle, OutputRenderer, OutputRendererControls, Tabs, Collapsible, ModelSelector } from '../components/ui';
import { MessageList, ParameterPanel, VariableEditor, DebugHistory, PromptOptimizer, PromptObserver, StructuredOutputEditor, ThinkingBlock, AttachmentList, AttachmentModal, PromptTestPanel, OcrResultsPanel, ChatTranscript } from '../components/Prompt';
import { ReasoningSelector } from '../components/Common/ReasoningSelector';
import type { DebugRun } from '../components/Prompt';
import { promptsApi, promptGroupsApi, ApiError, shareApi } from '../api';
import { chatApi, type ContentPart } from '../api/chat';
import { uploadFileAttachment, extractThinking, type FileAttachment } from '../lib/ai-service';
import { useOutputRenderPreferences } from '../lib/output-renderer-prefs';
import { analyzePrompt, type PromptAnalysisResult } from '../lib/prompt-analyzer';
import { inferReasoningSupport } from '../lib/model-capabilities';
import { getFileInputAccept, isSupportedFileType } from '../lib/file-utils';
import { formatDateTime } from '../lib/date-utils';
import { getErrorMessage } from '../lib/error-messages';
import { smartReplace } from '../lib/text-utils';
import { toApiOutputSchema, toFrontendOutputSchema } from '../lib/output-schema';
import { buildExpiresAtByPreset, generateSharePassword, getShareExpirePreset, type ShareExpirePreset } from '../lib/share-link-settings';
import { buildOcrProviderOptions, useEnabledOcrProviders } from '../hooks/useEnabledOcrProviders';
import type { Prompt, PromptVersion, PromptGroup, OcrProvider, ShareLink } from '../types';
import { PromptMessage, PromptMessageRole, PromptConfig, PromptVariable, ReasoningEffort, DEFAULT_PROMPT_CONFIG } from '../types/database';
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

const createPromptMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

type PromptTestCache = {
  testInput: string;
  variableValues: Record<string, string>;
  attachedFiles: FileAttachment[];
  debugRuns: DebugRun[];
  selectedDebugRunId: string | null;
  testOutput: string;
  testThinking: string;
};

const promptTestCacheByPromptId = new Map<string, PromptTestCache>();

export function resetPromptsPageCaches(): void {
  promptTestCacheByPromptId.clear();
}

export function PromptsPage() {
  const { showToast } = useToast();
  const { t } = useTranslation('prompts');
  const { t: tEval } = useTranslation('evaluation');
  const { t: tCommon } = useTranslation('common');
  const { t: tTraces } = useTranslation('traces');
  const location = useLocation();
  const [outputRenderPrefs, setOutputRenderPrefs] = useOutputRenderPreferences('ssrprompt_output_render_prefs');

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
  const { enabledOcrProviders } = useEnabledOcrProviders();
  const compareOcrProviderOptions = useMemo(
    () => buildOcrProviderOptions(enabledOcrProviders, tEval, true),
    [enabledOcrProviders, tEval]
  );
  const [compareRunning, setCompareRunning] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  const [compareResults, setCompareResults] = useState<{
    left: { content: string; thinking: string; latency: number; tokensIn: number; tokensOut: number; error?: string; isThinking?: boolean } | null;
    right: { content: string; thinking: string; latency: number; tokensIn: number; tokensOut: number; error?: string; isThinking?: boolean } | null;
  }>({ left: null, right: null });
  const [compareParams, setCompareParams] = useState<{
    left: { temperature: number; top_p: number; max_tokens: number; frequency_penalty: number; presence_penalty: number; reasoning?: { enabled: boolean; effort: ReasoningEffort } };
    right: { temperature: number; top_p: number; max_tokens: number; frequency_penalty: number; presence_penalty: number; reasoning?: { enabled: boolean; effort: ReasoningEffort } };
  }>({
    left: { temperature: 0.7, top_p: 1, max_tokens: 8000, frequency_penalty: 0, presence_penalty: 0, reasoning: undefined },
    right: { temperature: 0.7, top_p: 1, max_tokens: 8000, frequency_penalty: 0, presence_penalty: 0, reasoning: undefined },
  });
  const compareAbortControllersRef = useRef<{ left: AbortController | null; right: AbortController | null }>({ left: null, right: null });
  const [searchQuery, setSearchQuery] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [promptName, setPromptName] = useState('');
  const [promptMessages, setPromptMessages] = useState<PromptMessage[]>([]);
  const [promptConfig, setPromptConfig] = useState<PromptConfig>(DEFAULT_PROMPT_CONFIG);
  const [promptVariables, setPromptVariables] = useState<PromptVariable[]>([]);
  const [promptApiEnabled, setPromptApiEnabled] = useState(false);
  const [promptApiVersionMode, setPromptApiVersionMode] = useState<'latest' | 'fixed'>('latest');
  const [promptApiFixedVersion, setPromptApiFixedVersion] = useState('');
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
  const initializedPromptIdRef = useRef<string | null>(null);
  const [publishPromptModal, setPublishPromptModal] = useState<{ promptId: string; step: 'confirm' | 'done' } | null>(null);
  const [publishingPrompt, setPublishingPrompt] = useState(false);
  const [privateShareModalOpen, setPrivateShareModalOpen] = useState(false);
  const [privateShareLink, setPrivateShareLink] = useState<ShareLink | null>(null);
  const [privateShareExpirePreset, setPrivateShareExpirePreset] = useState<ShareExpirePreset>('30d');
  const [privateSharePasswordMode, setPrivateSharePasswordMode] = useState<'none' | 'random' | 'custom'>('none');
  const [privateSharePassword, setPrivateSharePassword] = useState('');
  const [privateShareLoading, setPrivateShareLoading] = useState(false);
  const [privateShareSaving, setPrivateShareSaving] = useState(false);

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


  const promptTestCacheWriteReadyRef = useRef<string | null>(null);

  useEffect(() => {
    const promptId = selectedPrompt?.id;
    if (!promptId) return;

    if (promptTestCacheWriteReadyRef.current !== promptId) {
      promptTestCacheWriteReadyRef.current = promptId;
      return;
    }

    promptTestCacheByPromptId.set(promptId, {
      testInput,
      variableValues,
      attachedFiles,
      debugRuns,
      selectedDebugRunId: selectedDebugRun?.id ?? null,
      testOutput,
      testThinking,
    });
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
    const selectedApiMode = selectedPrompt.apiVersionMode || 'latest';
    const selectedApiFixedVersion =
      selectedApiMode === 'fixed' && selectedPrompt.apiFixedVersion
        ? String(selectedPrompt.apiFixedVersion)
        : '';
    const currentApiFixedVersion = promptApiVersionMode === 'fixed' ? promptApiFixedVersion.trim() : '';

    return (
      promptName !== selectedPrompt.name ||
      contentChanged ||
      messagesChanged ||
      JSON.stringify(promptConfig) !== JSON.stringify(selectedConfig) ||
      JSON.stringify(promptVariables) !== JSON.stringify(selectedPrompt.variables || []) ||
      (selectedModel || '') !== (selectedPrompt.defaultModelId || '') ||
      promptApiEnabled !== Boolean(selectedPrompt.apiEnabled) ||
      promptApiVersionMode !== selectedApiMode ||
      currentApiFixedVersion !== selectedApiFixedVersion
    );
  }, [
    promptApiEnabled,
    promptApiFixedVersion,
    promptApiVersionMode,
    promptConfig,
    promptContent,
    promptMessages,
    promptName,
    promptVariables,
    selectedModel,
    selectedPrompt,
  ]);

  const publishPromptModalPrompt = useMemo(() => {
    if (!publishPromptModal) return null;
    if (selectedPrompt?.id === publishPromptModal.promptId) return selectedPrompt;
    return prompts.find((p) => p.id === publishPromptModal.promptId) ?? null;
  }, [publishPromptModal, selectedPrompt, prompts]);

  const publishPromptShareUrl = useMemo(() => {
    if (!publishPromptModal) return '';
    const url = new URL('/plaza', window.location.origin);
    url.searchParams.set('promptId', publishPromptModal.promptId);
    return url.toString();
  }, [publishPromptModal]);

  const privateSharePromptUrl = useMemo(() => {
    if (!privateShareLink) return '';
    const url = new URL(`/share/p/${privateShareLink.token}`, window.location.origin);
    return url.toString();
  }, [privateShareLink]);

  const promptApiInvokeUrl = useMemo(() => {
    if (!selectedPrompt?.id) return '';
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';
    return `${baseUrl}/open/prompts/${selectedPrompt.id}/invoke`;
  }, [selectedPrompt?.id]);

  const promptApiVersionOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...(selectedPrompt?.currentVersion ? [selectedPrompt.currentVersion] : []),
          ...versions.map((version) => version.version),
        ])
      )
        .sort((a, b) => b - a)
        .map((version) => ({ value: String(version), label: `v${version}` })),
    [selectedPrompt?.currentVersion, versions]
  );

  const promptIdFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const promptId = params.get('promptId');
    return promptId && promptId.trim() ? promptId.trim() : null;
  }, [location.search]);

  const loadData = useCallback(async () => {
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
          const preferredPromptId =
            promptIdFromUrl && sorted.some((prompt) => prompt.id === promptIdFromUrl)
              ? promptIdFromUrl
              : sorted[0].id;
          const fullPrompt = await promptsApi.getById(preferredPromptId);
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
  }, [fetchProvidersAndModels, promptIdFromUrl, showToast, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadVersions = useCallback(async (promptId: string) => {
    try {
      const data = await promptsApi.getVersions(promptId);
      setVersions(data);
    } catch {
      setVersions([]);
    }
  }, []);

  useEffect(() => {
    if (!selectedPrompt) {
      initializedPromptIdRef.current = null;
      return;
    }

    // Only initialize editor state when switching prompts.
    if (initializedPromptIdRef.current === selectedPrompt.id) return;
    initializedPromptIdRef.current = selectedPrompt.id;

    // Reset prompt content and configuration
    setPromptContent(selectedPrompt.content || '');
    setPromptName(selectedPrompt.name);
    setPromptMessages(toFrontendMessages(selectedPrompt.messages));
    setPromptConfig(toFrontendConfig(selectedPrompt.config));
    setPromptVariables(selectedPrompt.variables || []);
    setPromptApiEnabled(Boolean(selectedPrompt.apiEnabled));
    setPromptApiVersionMode((selectedPrompt.apiVersionMode || 'latest') as 'latest' | 'fixed');
    setPromptApiFixedVersion(selectedPrompt.apiFixedVersion ? String(selectedPrompt.apiFixedVersion) : '');
    if (selectedPrompt.defaultModelId) {
      setSelectedModel(selectedPrompt.defaultModelId);
    }
    loadVersions(selectedPrompt.id);

    setShowDebugDetail(null);

    const cache = promptTestCacheByPromptId.get(selectedPrompt.id);
    if (cache) {
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
  }, [loadVersions, selectedPrompt?.id]);

  useEffect(() => {
    if (promptApiVersionMode !== 'fixed') return;
    if (promptApiFixedVersion.trim().length > 0) return;

    const fallbackVersion =
      promptApiVersionOptions[0]?.value ||
      (selectedPrompt?.currentVersion ? String(selectedPrompt.currentVersion) : '');
    if (fallbackVersion) {
      setPromptApiFixedVersion(fallbackVersion);
    }
  }, [promptApiFixedVersion, promptApiVersionMode, promptApiVersionOptions, selectedPrompt?.currentVersion]);

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
      showToast('error', t('loadFailed') + ': ' + getErrorMessage(e));
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
      showToast('error', t('createFailed') + ': ' + getErrorMessage(e));
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
      showToast('error', t('updateFailed') + ': ' + getErrorMessage(e));
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
      showToast('error', t('createGroupFailed') + ': ' + getErrorMessage(e));
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
      showToast('error', t('deleteGroupFailed') + ': ' + getErrorMessage(e));
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

    const parsedApiFixedVersion =
      promptApiVersionMode === 'fixed'
        ? Number.parseInt(promptApiFixedVersion.trim(), 10)
        : null;

    if (
      promptApiVersionMode === 'fixed' &&
      (!parsedApiFixedVersion || Number.isNaN(parsedApiFixedVersion) || parsedApiFixedVersion <= 0)
    ) {
      showToast('error', t('apiFixedVersionRequired', { defaultValue: '请设置固定可调用版本' }));
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
        apiEnabled: promptApiEnabled,
        apiVersionMode: promptApiVersionMode,
        apiFixedVersion: promptApiVersionMode === 'fixed' ? parsedApiFixedVersion : null,
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
      showToast('error', t('saveFailed') + ': ' + getErrorMessage(e));
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

  const formatMessagesToContent = useCallback((messages: PromptMessage[]) => {
    const formatted = messages
      .map((message) => ({
        role: message.role,
        content: message.content.trimEnd(),
      }))
      .filter((message) => message.content.trim().length > 0)
      .map((message) => `[${message.role.toUpperCase()}]\n${message.content}`);
    return formatted.join('\n\n');
  }, []);

  const parseContentToMessages = useCallback((content: string) => {
    const normalized = content.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const rolePattern = /^\s*\[(SYSTEM|USER|ASSISTANT)\]\s*$/i;
    const firstMeaningfulLine = lines.find((line) => line.trim().length > 0);

    if (!firstMeaningfulLine || !rolePattern.test(firstMeaningfulLine)) {
      return null;
    }

    const messages: PromptMessage[] = [];
    let currentRole: PromptMessageRole | null = null;
    let currentLines: string[] = [];

    const pushMessage = () => {
      if (!currentRole) return;
      const messageContent = currentLines.join('\n').trimEnd();
      if (messageContent.trim().length === 0) return;
      messages.push({
        id: createPromptMessageId(),
        role: currentRole,
        content: messageContent,
      });
    };

    lines.forEach((line) => {
      const match = line.match(rolePattern);
      if (match) {
        pushMessage();
        currentRole = match[1].toLowerCase() as PromptMessageRole;
        currentLines = [];
        return;
      }
      if (currentRole) {
        currentLines.push(line);
      }
    });

    pushMessage();
    return messages.length > 0 ? messages : null;
  }, []);

  const handleSwitchToSingleMessage = useCallback(() => {
    if (promptMessages.length === 0) return;
    const content = formatMessagesToContent(promptMessages);
    setPromptContent(content);
    setPromptMessages([]);
  }, [formatMessagesToContent, promptMessages]);

  const handleSwitchToMultiMessage = useCallback(() => {
    const parsedMessages = parseContentToMessages(promptContent);
    if (parsedMessages) {
      setPromptMessages(parsedMessages);
      setPromptContent('');
      return;
    }

    setPromptMessages([
      { id: createPromptMessageId(), role: 'system', content: promptContent || 'You are a helpful assistant.' },
      { id: createPromptMessageId(), role: 'user', content: '' },
    ]);
    setPromptContent('');
  }, [parseContentToMessages, promptContent]);

  // Build prompt from messages
  const buildPromptFromMessages = useCallback(() => {
    if (promptMessages.length > 0) {
      return formatMessagesToContent(promptMessages);
    }
    return promptContent;
  }, [formatMessagesToContent, promptMessages, promptContent]);

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
      showToast('error', t('copyFailed') + ': ' + getErrorMessage(e));
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
      showToast('error', t('deleteFailed') + ': ' + getErrorMessage(e));
      return false;
    } finally {
      setDeletingPromptId(null);
    }
  };

  const handleDeletePrompt = () => {
    if (!selectedPrompt) return;
    requestDeletePrompt(selectedPrompt.id);
  };

  const handleCopyPromptShareLink = async (promptId: string) => {
    try {
      const url = new URL('/plaza', window.location.origin);
      url.searchParams.set('promptId', promptId);
      await navigator.clipboard.writeText(url.toString());
      showToast('success', tCommon('linkCopied'));
    } catch {
      showToast('error', t('copyFailed'));
    }
  };

  const handleCreatePublishedPromptLink = async (promptId: string) => {
    await handleCopyPromptShareLink(promptId);
    closePublishPromptModal();
  };

  const openPublishPromptModal = () => {
    if (!selectedPrompt || selectedPrompt.isPublic) return;
    setPublishPromptModal({ promptId: selectedPrompt.id, step: 'confirm' });
  };

  const closePublishPromptModal = () => {
    if (publishingPrompt) return;
    setPublishPromptModal(null);
  };

  const handleConfirmPublishPrompt = async () => {
    if (!publishPromptModalPrompt || publishPromptModalPrompt.isPublic) return;
    setPublishingPrompt(true);
    try {
      const updated = await promptsApi.update(publishPromptModalPrompt.id, { isPublic: true });
      setSelectedPrompt((prev) => (prev && prev.id === updated.id ? (updated as Prompt) : prev));
      setPrompts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, isPublic: true } : p)));
      invalidatePromptsCache(updated);
      showToast('success', t('promptPublic'));
      setPublishPromptModal((prev) => (prev ? { ...prev, step: 'done' } : prev));
    } catch (e) {
      showToast('error', t('updateFailed') + ': ' + getErrorMessage(e));
    } finally {
      setPublishingPrompt(false);
    }
  };

  const handleSetPromptPrivate = async () => {
    if (!selectedPrompt || !selectedPrompt.isPublic) return;
    try {
      const updated = await promptsApi.update(selectedPrompt.id, { isPublic: false });
      setSelectedPrompt((prev) => (prev && prev.id === updated.id ? (updated as Prompt) : prev));
      setPrompts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, isPublic: false } : p)));
      invalidatePromptsCache(updated);
      showToast('success', t('promptPrivate'));
    } catch (e) {
      showToast('error', t('updateFailed') + ': ' + getErrorMessage(e));
    }
  };

  const openPrivateShareModal = async () => {
    if (!selectedPrompt) return;
    setPrivateShareModalOpen(true);
    setPrivateShareLoading(true);
    try {
      const link = await shareApi.createLink({
        resourceType: 'prompt',
        resourceId: selectedPrompt.id,
        allowCopy: true,
      });
      setPrivateShareLink(link);
      setPrivateShareExpirePreset(getShareExpirePreset(link.expiresAt));
      setPrivateSharePasswordMode(link.hasPassword ? 'custom' : 'none');
      setPrivateSharePassword('');
    } catch (error) {
      showToast('error', getErrorMessage(error));
      setPrivateShareModalOpen(false);
    } finally {
      setPrivateShareLoading(false);
    }
  };

  const closePrivateShareModal = () => {
    if (privateShareSaving) return;
    setPrivateShareModalOpen(false);
    setPrivateShareLink(null);
    setPrivateShareExpirePreset('30d');
    setPrivateSharePasswordMode('none');
    setPrivateSharePassword('');
  };

  const handleCreatePrivateShareLink = async () => {
    if (!privateShareLink) return;

    if (privateSharePasswordMode === 'custom' && !privateSharePassword.trim() && !privateShareLink.hasPassword) {
      showToast('error', tCommon('privateSharePasswordRequired'));
      return;
    }

    setPrivateShareSaving(true);
    try {
      const updated = await shareApi.updateLink(privateShareLink.id, {
        allowCopy: true,
        expiresAt: buildExpiresAtByPreset(privateShareExpirePreset),
        ...(privateSharePasswordMode === 'none' ? { clearPassword: true } : {}),
        ...(privateSharePasswordMode !== 'none' && privateSharePassword.trim()
          ? { password: privateSharePassword.trim() }
          : {}),
      });

      setPrivateShareLink(updated);
      setPrivateShareExpirePreset(getShareExpirePreset(updated.expiresAt));
      setPrivateSharePasswordMode(updated.hasPassword ? 'custom' : 'none');
      setPrivateSharePassword('');

      const shareUrl = new URL(`/share/p/${updated.token}`, window.location.origin).toString();
      await navigator.clipboard.writeText(shareUrl);
      showToast('success', tCommon('privateShareCreatedAndCopied'));
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setPrivateShareSaving(false);
    }
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

  useEffect(() => {
    if (!compareOcrProviderOverride) return;
    if (enabledOcrProviders.includes(compareOcrProviderOverride)) return;
    setCompareOcrProviderOverride('');
  }, [compareOcrProviderOverride, enabledOcrProviders]);

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
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={promptName}
                  onChange={(e) => setPromptName(e.target.value)}
                  className="text-lg font-medium text-white light:text-slate-900 bg-transparent border-none focus:outline-none"
                />
                <Badge variant="info">v{selectedPrompt.currentVersion}</Badge>
                {hasUnsavedChanges && <Badge variant="warning">{t('unsaved')}</Badge>}
                <button
                  onClick={() => {
                    if (!selectedPrompt.isPublic) {
                      openPublishPromptModal();
                      return;
                    }
                    void handleSetPromptPrivate();
                  }}
                  disabled={saving || publishingPrompt}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
                    selectedPrompt.isPublic
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 light:border-emerald-300 light:bg-emerald-50 light:text-emerald-700'
                      : 'border-slate-600/70 bg-slate-800/70 text-slate-200 hover:bg-slate-700 light:border-slate-300 light:bg-slate-100 light:text-slate-600 light:hover:bg-slate-200'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                  title={selectedPrompt.isPublic ? t('clickToPrivate') : t('clickToPublic')}
                >
                  <Globe className="w-3.5 h-3.5" />
                  {selectedPrompt.isPublic ? t('public') : t('private')}
                </button>
                <div className="inline-flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void openPrivateShareModal()}
                    disabled={saving || publishingPrompt}
                    className="h-8 px-3"
                  >
                    <Link className="w-4 h-4" />
                    <span>{tCommon('privateShare')}</span>
                  </Button>
                  {selectedPrompt.isPublic && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleCopyPromptShareLink(selectedPrompt.id)}
                      disabled={saving || publishingPrompt}
                      className="h-8 px-3"
                    >
                      <Link className="w-4 h-4" />
                      <span>{tCommon('shareLink')}</span>
                    </Button>
                  )}
                </div>
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
                          <div className="space-y-4">
                            <MessageList
                              messages={promptMessages}
                              onChange={setPromptMessages}
                            />
                            <div className="text-center">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleSwitchToSingleMessage}
                              >
                                <FileText className="w-4 h-4 mr-1" />
                                {t('switchToSingleMessage')}
                              </Button>
                            </div>
                          </div>
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
                                onClick={handleSwitchToMultiMessage}
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

                      <div className="p-3 bg-slate-800/50 light:bg-white rounded-lg border border-slate-700 light:border-slate-200 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs text-slate-300 light:text-slate-700 font-medium">
                              {t('promptApiAccessTitle', { defaultValue: 'API 调用' })}
                            </p>
                            <p className="text-[11px] text-slate-500 light:text-slate-600 mt-1">
                              {t('promptApiEnablePromptHint', { defaultValue: '仅开启后，外部系统才可通过统一 URL 调用该 Prompt。' })}
                            </p>
                          </div>
                          <Toggle enabled={promptApiEnabled} onChange={setPromptApiEnabled} size="sm" />
                        </div>

                        {promptApiEnabled && (
                          <div className="space-y-2">
                            <Select
                              label={t('promptApiVersionMode', { defaultValue: '默认调用版本' })}
                              value={promptApiVersionMode}
                              onChange={(e) => setPromptApiVersionMode(e.target.value as 'latest' | 'fixed')}
                              options={[
                                { value: 'latest', label: t('promptApiVersionLatest', { defaultValue: '最新版本（latest）' }) },
                                { value: 'fixed', label: t('promptApiVersionFixed', { defaultValue: '固定版本' }) },
                              ]}
                            />
                            {promptApiVersionMode === 'fixed' && (
                              <Select
                                label={t('promptApiFixedVersion', { defaultValue: '固定版本号' })}
                                value={promptApiFixedVersion}
                                onChange={(e) => setPromptApiFixedVersion(e.target.value)}
                                options={
                                  promptApiVersionOptions.length > 0
                                    ? promptApiVersionOptions
                                    : [
                                        {
                                          value: selectedPrompt?.currentVersion ? String(selectedPrompt.currentVersion) : '',
                                          label: selectedPrompt?.currentVersion ? `v${selectedPrompt.currentVersion}` : 'v1',
                                        },
                                      ]
                                }
                              />
                            )}
                            <div className="rounded-md border border-slate-700 light:border-slate-200 bg-slate-950/60 light:bg-slate-100 px-2 py-1.5">
                              <p className="text-[11px] text-slate-500 light:text-slate-600 mb-1">
                                {t('promptApiInvokeUrl', { defaultValue: '调用 URL（示例）' })}
                              </p>
                              <code className="text-[11px] text-cyan-300 light:text-cyan-700 break-all">
                                {promptApiInvokeUrl || '-'}
                              </code>
                              <p className="text-[11px] text-slate-500 light:text-slate-600 mt-1">
                                {t('promptApiInvokeSpecHint', {
                                  defaultValue: '调用规范（入参/回参/SSE 示例）见：设置 -> Prompt API',
                                })}
                              </p>
                            </div>
                          </div>
                        )}
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
                    showModelSelector={false}
                    variables={promptVariables}
                    variableValues={variableValues}
                    onVariableValuesChange={setVariableValues}
                    testInput={testInput}
                    onTestInputChange={setTestInput}
                    promptText={buildPromptFromMessages()}
                    promptMessages={promptMessages.length > 0 ? promptMessages.map((m) => ({ role: m.role, content: m.content })) : undefined}
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
                      if (result.mode === 'chat' && result.chatRunId && result.messages) {
                        const chatId = result.chatRunId;
                        const firstUser = result.messages.find((m) => m.role === 'user')?.content || result.input;

                        setDebugRuns((prev) => {
                          const existing = prev.find((r) => r.id === chatId);

                          const merged: DebugRun = {
                            id: chatId,
                            mode: 'chat',
                            chatRunId: chatId,
                            modelId: selectedModel,
                            modelParameters: {
                              temperature: promptConfig.temperature,
                              top_p: promptConfig.top_p,
                              max_tokens: promptConfig.max_tokens,
                              frequency_penalty: promptConfig.frequency_penalty,
                              presence_penalty: promptConfig.presence_penalty,
                            },
                            input: existing?.input || firstUser,
                            inputVariables: existing?.inputVariables || {},
                            output: result.output,
                            status: result.status === 'error' ? 'error' : (existing?.status || 'success'),
                            errorMessage: result.errorMessage ?? existing?.errorMessage,
                            latencyMs: (existing?.latencyMs || 0) + result.latencyMs,
                            tokensInput: (existing?.tokensInput || 0) + result.tokensInput,
                            tokensOutput: (existing?.tokensOutput || 0) + result.tokensOutput,
                            timestamp: existing?.timestamp || new Date(),
                            attachments: existing?.attachments ?? result.attachments,
                            thinking: result.thinking ?? existing?.thinking,
                            ocrUsed: existing?.ocrUsed || result.ocrUsed,
                            ocrProvider: existing?.ocrProvider ?? result.ocrProvider,
                            messages: result.messages,
                          };

                          const without = prev.filter((r) => r.id !== chatId);
                          return [merged, ...without].slice(0, 20);
                        });
                        return;
                      }

                      const runId = `run_${Date.now()}`;
                      const newRun: DebugRun = {
                        id: runId,
                        mode: 'single',
                        modelId: selectedModel,
                        modelParameters: {
                          temperature: promptConfig.temperature,
                          top_p: promptConfig.top_p,
                          max_tokens: promptConfig.max_tokens,
                          frequency_penalty: promptConfig.frequency_penalty,
                          presence_penalty: promptConfig.presence_penalty,
                        },
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
                    promptName={selectedPrompt.name}
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

      <Modal
        isOpen={privateShareModalOpen}
        onClose={closePrivateShareModal}
        title={tCommon('privateShareSettings')}
        size="lg"
      >
        {privateShareLoading ? (
          <div className="rounded-xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 via-cyan-500/5 to-transparent p-5">
            <div className="flex items-center gap-3 text-sm text-slate-300 light:text-slate-700">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-300 light:bg-cyan-500/15 light:text-cyan-700">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
              <div>
                <p className="font-medium text-slate-200 light:text-slate-900">{tCommon('privateShareGenerating')}</p>
                <p className="mt-0.5 text-xs text-slate-400 light:text-slate-600">{tCommon('privateShareGeneratingHint')}</p>
              </div>
            </div>
          </div>
        ) : !privateShareLink ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
            <div className="flex items-start gap-2 text-sm text-rose-200 light:text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <div>
                <p className="font-medium">{tCommon('privateShareCreateFailed')}</p>
                <p className="mt-1 text-xs text-rose-200/80 light:text-rose-700/80">{tCommon('privateShareCreateFailedHint')}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 via-cyan-500/5 to-transparent p-4">
              <p className="text-xs uppercase tracking-wider text-cyan-300 light:text-cyan-700">{tCommon('privateShareNoticeTitle')}</p>
              <p className="mt-1 text-sm text-slate-200 light:text-slate-800">{tCommon('privateShareNoticeDesc')}</p>
            </div>

            <div className="space-y-4 rounded-xl border border-slate-700/70 light:border-slate-200 bg-slate-900/40 light:bg-slate-50 p-4">
              <Input
                label={tCommon('shareLink')}
                value={privateSharePromptUrl}
                readOnly
                className="font-mono text-xs md:text-sm"
                onFocus={(event) => event.currentTarget.select()}
              />

              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-200 light:text-slate-800">{tCommon('privateShareExpiry')}</p>
                <div className="grid grid-cols-5 gap-2">
                  {[
                    { key: '1d' as const, label: tCommon('privateShareExpiry1d') },
                    { key: '7d' as const, label: tCommon('privateShareExpiry7d') },
                    { key: '30d' as const, label: tCommon('privateShareExpiry30d') },
                    { key: '1y' as const, label: tCommon('privateShareExpiry1y') },
                    { key: 'never' as const, label: tCommon('privateShareExpiryNever') },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setPrivateShareExpirePreset(item.key)}
                      className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                        privateShareExpirePreset === item.key
                          ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200 light:border-cyan-500 light:bg-cyan-50 light:text-cyan-700'
                          : 'border-slate-700 light:border-slate-300 text-slate-300 light:text-slate-700 hover:border-cyan-500/50'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-200 light:text-slate-800">{tCommon('privateSharePassword')}</p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPrivateSharePasswordMode('none');
                      setPrivateSharePassword('');
                    }}
                    className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                      privateSharePasswordMode === 'none'
                        ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200 light:border-cyan-500 light:bg-cyan-50 light:text-cyan-700'
                        : 'border-slate-700 light:border-slate-300 text-slate-300 light:text-slate-700 hover:border-cyan-500/50'
                    }`}
                  >
                    {tCommon('privateSharePasswordNone')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPrivateSharePasswordMode('random');
                      setPrivateSharePassword(generateSharePassword(4));
                    }}
                    className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                      privateSharePasswordMode === 'random'
                        ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200 light:border-cyan-500 light:bg-cyan-50 light:text-cyan-700'
                        : 'border-slate-700 light:border-slate-300 text-slate-300 light:text-slate-700 hover:border-cyan-500/50'
                    }`}
                  >
                    {tCommon('privateSharePasswordRandom')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrivateSharePasswordMode('custom')}
                    className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                      privateSharePasswordMode === 'custom'
                        ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200 light:border-cyan-500 light:bg-cyan-50 light:text-cyan-700'
                        : 'border-slate-700 light:border-slate-300 text-slate-300 light:text-slate-700 hover:border-cyan-500/50'
                    }`}
                  >
                    {tCommon('privateSharePasswordCustom')}
                  </button>
                </div>
                {privateSharePasswordMode !== 'none' && (
                  <Input
                    label={privateShareLink.hasPassword ? tCommon('privateSharePasswordWithKeep') : tCommon('privateSharePassword')}
                    type="text"
                    value={privateSharePassword}
                    onChange={(event) => setPrivateSharePassword(event.target.value.toUpperCase())}
                    placeholder={privateSharePasswordMode === 'random' ? tCommon('privateSharePasswordAutoGenerated') : tCommon('privateSharePasswordPlaceholder')}
                    readOnly={privateSharePasswordMode === 'random'}
                    maxLength={8}
                    className="uppercase tracking-widest"
                  />
                )}
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button className="min-w-[132px]" onClick={() => void handleCreatePrivateShareLink()} loading={privateShareSaving}>
                <Link className="w-4 h-4" />
                <span>{tCommon('privateShareCreateLink')}</span>
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={publishPromptModal !== null}
        onClose={closePublishPromptModal}
        title={t('publishPrompt')}
        size="md"
      >
        {publishPromptModal && publishPromptModal.step === 'confirm' && (
          <div className="space-y-4">
            {!publishPromptModalPrompt ? (
              <div className="text-sm text-slate-500 light:text-slate-600">{tCommon('loading')}</div>
            ) : (
              <>
                <div>
                  <p className="text-sm text-slate-200 light:text-slate-800">{t('publishPromptIntro')}</p>
                  <p className="mt-2 text-xs text-slate-500 light:text-slate-600">{t('publishPromptVisibleTitle')}</p>
                  <ul className="mt-2 space-y-1 text-sm text-slate-300 light:text-slate-700 list-disc pl-5">
                    <li>{t('publishPromptVisibleItemMeta')}</li>
                    <li>{t('publishPromptVisibleItemContent')}</li>
                    <li>{t('publishPromptVisibleItemVariables')}</li>
                    <li>{t('publishPromptVisibleItemConfig')}</li>
                  </ul>
                  <p className="mt-2 text-xs text-slate-500 light:text-slate-600">{t('publishPromptSafetyHint')}</p>
                </div>

                <div className="p-3 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-slate-50">
                  <p className="text-xs text-slate-500 light:text-slate-600">{tCommon('name')}</p>
                  <p className="text-sm text-slate-200 light:text-slate-900 mt-1">{publishPromptModalPrompt.name}</p>
                </div>

                {publishPromptModalPrompt.id === selectedPrompt?.id && hasUnsavedChanges && (
                  <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5" />
                      <p className="text-xs text-slate-300 light:text-slate-700">{t('publishPromptUnsavedWarning')}</p>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-700 light:border-slate-200">
                  <Button variant="ghost" onClick={closePublishPromptModal}>
                    {tCommon('cancel')}
                  </Button>
                  <Button onClick={() => void handleConfirmPublishPrompt()} loading={publishingPrompt}>
                    {t('publishNow')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {publishPromptModal && publishPromptModal.step === 'done' && (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-200 light:text-slate-800">{t('publishPromptDone')}</p>
              <p className="text-xs text-slate-500 light:text-slate-600 mt-1">{t('publishPromptDoneHint')}</p>
            </div>
            <Input
              label={tCommon('shareLink')}
              value={publishPromptShareUrl}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-700 light:border-slate-200">
              <Button
                onClick={() => void handleCreatePublishedPromptLink(publishPromptModal.promptId)}
              >
                <Link className="w-4 h-4" />
                <span>{tCommon('privateShareCreateLink')}</span>
              </Button>
            </div>
          </div>
        )}
      </Modal>

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
        size="full"
      >
        <div className="flex flex-col gap-4 min-h-[76vh] max-h-[90vh] overflow-hidden">
          <div className="flex-1 grid grid-cols-1 xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)] gap-4 min-h-0">
            <div className="flex flex-col min-h-0">
              <div className="flex-1 space-y-4 min-h-0 overflow-y-auto pr-1">
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
                    rows={4}
                    className="w-full min-h-[120px] p-3 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 resize-none focus:outline-none focus:border-cyan-500"
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
                        options={compareOcrProviderOptions}
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
                            max="128000"
                            step="1"
                            value={compareParams.left.max_tokens}
                            onChange={(e) => setCompareParams((prev) => ({ ...prev, left: { ...prev.left, max_tokens: parseInt(e.target.value) || 8000 } }))}
                            className="w-20 px-2 py-1 text-xs bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-slate-200 light:text-slate-800"
                          />
                        </div>
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
                            max="128000"
                            step="1"
                            value={compareParams.right.max_tokens}
                            onChange={(e) => setCompareParams((prev) => ({ ...prev, right: { ...prev.right, max_tokens: parseInt(e.target.value) || 8000 } }))}
                            className="w-20 px-2 py-1 text-xs bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-slate-200 light:text-slate-800"
                          />
                        </div>
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
              </div>
              <div className="pt-3">
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
              </div>
            </div>

            <div className="flex flex-col min-h-0">
              <div className="flex items-center justify-between pb-2">
                <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">{t('outputResult')}</h3>
                <OutputRendererControls
                  preferences={outputRenderPrefs}
                  onChange={setOutputRenderPrefs}
                />
              </div>
              <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="flex flex-col min-h-0 gap-2">
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
                  <div className="flex-1 min-h-0 p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg overflow-y-auto">
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
                          <OutputRenderer
                            content={compareResults.left.content}
                            preferences={outputRenderPrefs}
                            isStreaming={compareRunning.left}
                          />
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

                <div className="flex flex-col min-h-0 gap-2">
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
                  <div className="flex-1 min-h-0 p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg overflow-y-auto">
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
                          <OutputRenderer
                            content={compareResults.right.content}
                            preferences={outputRenderPrefs}
                            isStreaming={compareRunning.right}
                          />
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
            </div>
          </div>
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
        size="wide"
      >
        {showDebugDetail && (() => {
          const candidate = (showDebugDetail.modelParameters ?? {}) as Record<string, unknown>;
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
          const parameters = [
            { label: t('temperature'), value: candidate.temperature },
            { label: t('topP'), value: candidate.top_p ?? candidate.topP },
            { label: t('maxTokens'), value: candidate.max_tokens ?? candidate.maxTokens },
            { label: t('frequencyPenalty'), value: candidate.frequency_penalty ?? candidate.frequencyPenalty },
            { label: t('presencePenalty'), value: candidate.presence_penalty ?? candidate.presencePenalty },
          ].filter((item) => item.value !== undefined && item.value !== null);

           const modelName =
             models.find((m) => m.id === showDebugDetail.modelId)?.name || showDebugDetail.modelId || '-';

           const transcriptMessages =
             showDebugDetail.messages && showDebugDetail.messages.length > 0
               ? showDebugDetail.messages
               : [
                   {
                     id: `${showDebugDetail.id}_user`,
                     role: 'user' as const,
                     content: showDebugDetail.input,
                     attachments: showDebugDetail.attachments,
                   },
                   {
                     id: `${showDebugDetail.id}_assistant`,
                     role: 'assistant' as const,
                     content: showDebugDetail.output,
                     thinking: showDebugDetail.thinking,
                   },
                 ];

           const detailAttachments =
             showDebugDetail.attachments ??
             (showDebugDetail.messages ? showDebugDetail.messages.flatMap((m) => m.attachments ?? []) : []);
           const hasDetailAttachments = detailAttachments.length > 0;

           return (
             <div className="h-[72vh] overflow-hidden">
              <div className="h-full grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
              <div className="h-full overflow-y-auto space-y-4 pr-1">
                <div className="grid grid-cols-2 gap-3">
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
                    <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('input')} Tokens</p>
                    <p className="text-sm font-medium text-cyan-400 light:text-cyan-600">{showDebugDetail.tokensInput}</p>
                  </div>
                  <div className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                    <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('output')} Tokens</p>
                    <p className="text-sm font-medium text-teal-400 light:text-teal-600">{showDebugDetail.tokensOutput}</p>
                  </div>
                </div>

                <div className="p-3 bg-slate-800/40 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{tTraces('prompt')}</p>
                  <p className="text-sm text-slate-200 light:text-slate-800">{selectedPrompt?.name || promptName || '-'}</p>
                </div>

                <div className="p-3 bg-slate-800/40 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('model')}</p>
                  <p className="text-sm text-slate-200 light:text-slate-800">{modelName}</p>
                </div>

                <div className="p-3 bg-slate-800/40 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('modelParameters')}</p>
                  <div className="mt-2 space-y-1 text-xs">
                    {parameters.length > 0 ? (
                      parameters.map((item) => (
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

                {hasDetailAttachments && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Paperclip className="w-4 h-4 text-slate-400" />
                      <h4 className="text-sm font-medium text-slate-300 light:text-slate-700">
                        {t('attachments')} ({detailAttachments.length})
                      </h4>
                    </div>
                    <div className="p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg min-h-[60px]">
                      <AttachmentList
                        attachments={detailAttachments}
                        size="md"
                        maxVisible={10}
                        onPreview={setPreviewAttachment}
                      />
                    </div>
                  </div>
                )}

                {showDebugDetail.ocrUsed && hasDetailAttachments && (
                  <OcrResultsPanel
                    attachments={detailAttachments}
                    provider={showDebugDetail.ocrProvider}
                    defaultOpen={true}
                    heightClassName="h-[260px]"
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

              <div className="h-full min-h-0 p-4 bg-slate-800/30 light:bg-slate-50 border border-slate-700 light:border-slate-200 rounded-lg overflow-y-auto">
                <ChatTranscript
                  messages={transcriptMessages}
                  assistantLabel={modelName}
                  onPreviewAttachment={setPreviewAttachment}
                />
              </div>
              </div>
            </div>
          );
        })()}
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
            <div className="flex items-center justify-between gap-3">
              {debugDetailExpanded.field === 'output' ? (
                <OutputRendererControls
                  preferences={outputRenderPrefs}
                  onChange={setOutputRenderPrefs}
                />
              ) : (
                <span />
              )}
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
                <OutputRenderer
                  content={debugDetailExpanded.content}
                  preferences={
                    debugDetailExpanded.field === 'output'
                      ? outputRenderPrefs
                      : outputRenderPrefs.format === 'text'
                        ? { ...outputRenderPrefs, format: 'text' }
                        : { ...outputRenderPrefs, format: 'markdown' }
                  }
                />
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
