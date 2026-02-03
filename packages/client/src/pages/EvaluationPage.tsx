import { useState, useEffect, useCallback, useRef, useMemo, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import {
  Plus,
  Play,
  BarChart3,
  Trash2,
  AlertCircle,
  Settings2,
  FileText,
  Loader2,
  History,
  Scale,
  Copy,
  Download,
  Pencil,
  Check,
  X,
  Globe,
  Link,
  Search,
} from 'lucide-react';
import { Button, Input, Modal, Badge, Select, useToast, ModelSelector } from '../components/ui';
import { PromptCascader } from '../components/Common/PromptCascader';
import { TestCaseList, CriteriaEditor, EvaluationResultsView, RunHistory } from '../components/Evaluation';
import { ParameterPanel } from '../components/Prompt/ParameterPanel';
import { evaluationsApi, runsApi, testCasesApi, criteriaApi, promptsApi, promptGroupsApi, providersApi, modelsApi, filesApi, type EvaluationWithRelations } from '../api';
import { chatApi, type ContentPart } from '../api/chat';
import type { FileAttachment } from '../lib/ai-service';
import { getFileUploadCapabilities } from '../lib/model-capabilities';
import { cacheEvents } from '../lib/cache-events';
import { formatDateTime } from '../lib/date-utils';
import { getErrorMessage } from '../lib/error-messages';
import { DEFAULT_PROMPT_CONFIG } from '../types';
import { useAuthStore } from '../store/useAuthStore';
import type {
  Prompt,
  Model,
  Provider,
  EvaluationStatus,
  TestCase,
  EvaluationCriterion,
  TestCaseResult,
  PromptVariable,
  EvaluationRun,
  RunConfig,
  PromptConfig,
  ModelParameters,
  EvaluationConfig,
  PromptGroup,
} from '../types';

const statusConfig: Record<EvaluationStatus, { labelKey: string; variant: 'info' | 'warning' | 'success' | 'error' }> = {
  pending: { labelKey: 'pending', variant: 'info' },
  running: { labelKey: 'running', variant: 'warning' },
  completed: { labelKey: 'completed', variant: 'success' },
  failed: { labelKey: 'failed', variant: 'error' },
};

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

type CsvColumn = { key: string; label: string };

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(columns: CsvColumn[], rows: Array<Record<string, unknown>>): string {
  const header = columns.map((column) => csvEscape(column.label)).join(',');
  const lines = rows.map((row) => columns.map((column) => csvEscape(row[column.key])).join(','));
  return [header, ...lines].join('\r\n');
}

function formatModelParameters(params?: ModelParameters | null): string {
  if (!params) return '';
  const entries: string[] = [];
  if (params.temperature !== undefined) entries.push(`temperature=${params.temperature}`);
  if (params.max_tokens !== undefined) entries.push(`max_tokens=${params.max_tokens}`);
  if (params.top_p !== undefined) entries.push(`top_p=${params.top_p}`);
  if (params.frequency_penalty !== undefined) entries.push(`frequency_penalty=${params.frequency_penalty}`);
  if (params.presence_penalty !== undefined) entries.push(`presence_penalty=${params.presence_penalty}`);
  return entries.join('; ');
}

function formatScoreDetails(
  scores: Record<string, number>,
  feedback: Record<string, unknown>
): string {
  const entries = Object.entries(scores || {});
  if (entries.length === 0) return '';
  return entries
    .map(([name, score]) => {
      const scoreValue = typeof score === 'number' && !Number.isNaN(score) ? (score * 10).toFixed(1) : String(score);
      const feedbackValue = feedback?.[name];
      let feedbackText = '';
      if (feedbackValue !== undefined && feedbackValue !== null && feedbackValue !== '') {
        if (typeof feedbackValue === 'string') {
          feedbackText = feedbackValue;
        } else {
          try {
            feedbackText = JSON.stringify(feedbackValue);
          } catch {
            feedbackText = String(feedbackValue);
          }
        }
      }
      return feedbackText ? `${name}:${scoreValue} (${feedbackText})` : `${name}:${scoreValue}`;
    })
    .join(' | ');
}

function formatAttachmentLinks(attachments?: FileAttachment[] | null): string {
  if (!attachments || attachments.length === 0) return '';
  return attachments
    .map((attachment) => {
      const link = `${API_BASE_URL}/files/${attachment.fileId}`;
      return attachment.name ? `${attachment.name}: ${link}` : link;
    })
    .join('; ');
}

function mergeResultsByTestCase(prev: TestCaseResult[], updates: TestCaseResult[]): TestCaseResult[] {
  if (updates.length === 0) return prev;
  const updatesById = new Map(updates.map((result) => [result.testCaseId, result]));
  const prevIds = new Set(prev.map((result) => result.testCaseId));
  const next = prev.map((result) => updatesById.get(result.testCaseId) ?? result);
  for (const result of updates) {
    if (!prevIds.has(result.testCaseId)) {
      next.push(result);
    }
  }
  return next;
}

function formatTimestampForFilename(dateValue: string | Date | null | undefined): string {
  if (!dateValue) return 'unknown-time';
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'unknown-time';
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function sanitizeFilenamePart(value: string, fallback: string): string {
  const trimmed = value.trim();
  const base = trimmed || fallback;
  const sanitized = base
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '');
  return sanitized || fallback;
}

function getFileProcessingLabel(t: (key: string) => string, fileProcessing?: string | null): string {
  const value = fileProcessing || 'auto';
  switch (value) {
    case 'auto':
      return t('fileProcessingAuto');
    case 'vision':
      return t('fileProcessingVision');
    case 'ocr':
      return t('fileProcessingOcr');
    case 'none':
      return t('fileProcessingNone');
    default:
      return value;
  }
}

function getOcrProviderLabel(t: (key: string) => string, ocrProvider?: string | null): string {
  if (!ocrProvider) return t('ocrProviderFollow');
  switch (ocrProvider) {
    case 'paddle':
      return 'PaddleOCR';
    case 'paddle_vl':
      return t('ocrProviderPaddleVl');
    case 'paddle_vl_1_5':
      return t('ocrProviderPaddleVl15');
    case 'datalab':
      return t('ocrProviderDatalab');
    case 'mineru':
      return t('ocrProviderMineru');
    default:
      return ocrProvider;
  }
}

type RunAbortController = {
  aborted: boolean;
  controller: AbortController;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function formatMsAsSeconds(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '-';
  return `${(ms / 1000).toFixed(1)}s`;
}

type TabType = 'testcases' | 'criteria' | 'history' | 'results';

// 缓存数据类型（不包含附件文件本体，仅 fileId 引用，避免内存过大）
interface EvaluationCacheData {
  testCases: TestCase[];
  criteria: EvaluationCriterion[];
  runs: EvaluationRun[];
  results: TestCaseResult[];
  selectedRunId: string | null;
}

// 使用内存缓存，不用 localStorage（附件数据太大）
const evaluationCache = new Map<string, EvaluationCacheData>();

// 列表缓存
interface ListCache {
  evaluations: EvaluationWithRelations[];
  prompts: Prompt[];
  promptGroups: PromptGroup[];
  models: Model[];
  providers: Provider[];
}

let evaluationCacheUserId: string | null = null;
let listCache: ListCache | null = null;
const loadingEvaluations = new Set<string>();  // 正在加载的评测ID集合

export function resetEvaluationPageCaches(): void {
  evaluationCache.clear();
  listCache = null;
  loadingEvaluations.clear();
  evaluationCacheUserId = null;
}

export function EvaluationPage() {
  const { showToast } = useToast();
  const { t } = useTranslation('evaluation');
  const { t: tCommon } = useTranslation('common');
  const location = useLocation();
  const { user } = useAuthStore();
  const currentUserId = user?.id;
  const evaluationIdFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const evaluationId = params.get('evaluationId');
    return evaluationId && evaluationId.trim() ? evaluationId.trim() : null;
  }, [location.search]);
  const [evaluations, setEvaluations] = useState<EvaluationWithRelations[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptGroups, setPromptGroups] = useState<PromptGroup[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedEvaluation, setSelectedEvaluation] = useState<EvaluationWithRelations | null>(null);
  const [listMode, setListMode] = useState<'mine' | 'public'>('mine');
  const [showNewEval, setShowNewEval] = useState(false);
  const [newEvalName, setNewEvalName] = useState('');
  const [newEvalPrompt, setNewEvalPrompt] = useState('');
  const [newEvalModel, setNewEvalModel] = useState('');
  const [newEvalJudgeModel, setNewEvalJudgeModel] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [evaluationQuery, setEvaluationQuery] = useState('');
  const [evaluationStatusFilter, setEvaluationStatusFilter] = useState<EvaluationStatus | 'all'>('all');

  const [activeTab, setActiveTab] = useState<TabType>('testcases');
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [selectedTestCaseIds, setSelectedTestCaseIds] = useState<Set<string>>(() => new Set());
  const [criteria, setCriteria] = useState<EvaluationCriterion[]>([]);
  const [results, setResults] = useState<TestCaseResult[]>([]);
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<EvaluationRun | null>(null);
  const [runningCount, setRunningCount] = useState(0);
  const runningTestCaseId: string | null = null;
  const [retryingOutputTestCaseId, setRetryingOutputTestCaseId] = useState<string | null>(null);
  const [retryingAiEvaluationTestCaseId, setRetryingAiEvaluationTestCaseId] = useState<string | null>(null);
  const [retryingAllScores, setRetryingAllScores] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [batchExporting, setBatchExporting] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [submittingNewVersion, setSubmittingNewVersion] = useState(false);
  const [draggedEvaluationId, setDraggedEvaluationId] = useState<string | null>(null);
  // 评测模型参数配置
  const [evalModelConfig, setEvalModelConfig] = useState<PromptConfig>(DEFAULT_PROMPT_CONFIG);
  const [showParamsModal, setShowParamsModal] = useState(false);
  const [publishModal, setPublishModal] = useState<{ evaluationId: string; step: 'confirm' | 'done' } | null>(null);
  const [publishShareAttachments, setPublishShareAttachments] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const abortControllersRef = useRef<Map<string, RunAbortController>>(new Map());
  const retryOutputAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const retryAiEvaluationAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const isFinalizingEvaluationDragRef = useRef(false);
  const selectedEvaluationIdRef = useRef<string | null>(null);
  const listModeRef = useRef<'mine' | 'public'>('mine');
  const runPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runsRef = useRef<EvaluationRun[]>([]);

  useEffect(() => {
    const nextUserId = currentUserId ?? null;

    if (evaluationCacheUserId && evaluationCacheUserId !== nextUserId) {
      resetEvaluationPageCaches();
      setEvaluations([]);
      setPrompts([]);
      setPromptGroups([]);
      setModels([]);
      setProviders([]);
      setSelectedEvaluation(null);
      selectedEvaluationIdRef.current = null;
      setTestCases([]);
      setSelectedTestCaseIds(new Set<string>());
      setCriteria([]);
      setResults([]);
      setRuns([]);
      setSelectedRun(null);
      setRunningCount(0);
      setListLoading(true);
      setDetailsLoading(false);
    }

    evaluationCacheUserId = nextUserId;
  }, [currentUserId]);

  // 同步 ref 以便在异步操作中访问最新的 selectedEvaluation
  useEffect(() => {
    selectedEvaluationIdRef.current = selectedEvaluation?.id || null;
  }, [selectedEvaluation]);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  useEffect(() => {
    listModeRef.current = listMode;
  }, [listMode]);

  const filteredEvaluations = useMemo(() => {
    const query = evaluationQuery.trim().toLowerCase();
    const base =
      listMode === 'public'
        ? evaluations.filter((evaluation) => evaluation.isPublic && evaluation.userId !== currentUserId)
        : evaluations.filter((evaluation) => !currentUserId || evaluation.userId === currentUserId);

    return base.filter((evaluation) => {
      if (evaluationStatusFilter !== 'all' && evaluation.status !== evaluationStatusFilter) {
        return false;
      }
      if (!query) return true;
      return evaluation.name.toLowerCase().includes(query);
    });
  }, [evaluations, evaluationQuery, evaluationStatusFilter, listMode, currentUserId]);

  const hasEvaluationFilter = evaluationQuery.trim() !== '' || evaluationStatusFilter !== 'all';

  const selectEvaluation = useCallback((evaluation: EvaluationWithRelations | null) => {
    setSelectedEvaluation(evaluation);

    if (!evaluation) {
      setDetailsLoading(false);
      setTestCases([]);
      setSelectedTestCaseIds(new Set());
      setCriteria([]);
      setResults([]);
      setRuns([]);
      setSelectedRun(null);
      return;
    }

    const cached = evaluationCache.get(evaluation.id);
    if (cached) {
      setDetailsLoading(false);
      setTestCases(cached.testCases);
      setCriteria(cached.criteria);
      setRuns(cached.runs);
      setResults(cached.results);
      setSelectedRun(cached.runs.find((r) => r.id === cached.selectedRunId) || null);
      return;
    }

    setDetailsLoading(true);
    setTestCases([]);
    setSelectedTestCaseIds(new Set());
    setCriteria([]);
    setResults([]);
    setRuns([]);
    setSelectedRun(null);
  }, []);

  // 计算当前评测模型的文件上传能力
  const fileUploadCapabilities = useMemo(() => {
    if (!selectedEvaluation?.modelId) {
      return { accept: '.txt,.md,.json,.csv,.xml,.yaml,.yml', canUploadImage: false, canUploadPdf: false, canUploadText: true };
    }
    const model = models.find((m) => m.id === selectedEvaluation.modelId);
    const provider = providers.find((p) => p.id === model?.providerId);
    if (!model || !provider) {
      return { accept: '.txt,.md,.json,.csv,.xml,.yaml,.yml', canUploadImage: false, canUploadPdf: false, canUploadText: true };
    }
    return getFileUploadCapabilities(provider.type, model.modelId, model.supportsVision ?? true);
  }, [selectedEvaluation?.modelId, models, providers]);

  // 获取当前评测模型的信息用于传递给子组件
  const currentModelInfo = useMemo(() => {
    if (!selectedEvaluation?.modelId) {
      return { providerType: undefined, modelId: undefined, supportsVision: true };
    }
    const model = models.find((m) => m.id === selectedEvaluation.modelId);
    const provider = providers.find((p) => p.id === model?.providerId);
    return {
      providerType: provider?.type,
      modelId: model?.modelId,
      supportsVision: model?.supportsVision ?? true,
    };
  }, [selectedEvaluation?.modelId, models, providers]);

  // 监听缓存失效事件，当其他页面更新数据时刷新
  useEffect(() => {
    const unsubscribe = cacheEvents.subscribe((type, data) => {
      if (type === 'prompts') {
        // 如果有更新的 prompt 数据，直接更新 prompts 状态
        if (data && typeof data === 'object' && 'id' in data) {
          const updatedPrompt = data as Prompt;
          setPrompts((prev) =>
            prev.some((p) => p.id === updatedPrompt.id)
              ? prev.map((p) => (p.id === updatedPrompt.id ? updatedPrompt : p))
              : [updatedPrompt, ...prev]
          );
          // 同时更新 listCache（如果存在）
          if (listCache) {
            listCache.prompts = listCache.prompts.some((p: Prompt) => p.id === updatedPrompt.id)
              ? listCache.prompts.map((p: Prompt) => (p.id === updatedPrompt.id ? updatedPrompt : p))
              : [updatedPrompt, ...listCache.prompts];
          }
        } else {
          // 清除列表缓存，下次加载时会重新获取数据
          listCache = null;
        }
      }

      if (type === 'models') {
        (async () => {
          try {
            const modelsData = await modelsApi.list();
            setModels(modelsData);
            if (listCache) {
              listCache.models = modelsData;
            }
          } catch (e) {
            console.error('Failed to refresh models:', e);
          }
        })();
        return;
      }

      if (type === 'providers') {
        (async () => {
          try {
            const providersData = await providersApi.list();
            const enabledProviders = providersData.filter((p) => p.enabled);
            setProviders(enabledProviders);
            if (listCache) {
              listCache.providers = enabledProviders;
            }
          } catch (e) {
            console.error('Failed to refresh providers:', e);
          }
        })();
        return;
      }

      if (type === 'evaluations') {
        // Fallback to full reload of list cache on evaluation mutations.
        listCache = null;
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const loadEvaluationDetails = useCallback(async (evaluationId: string) => {
    // 检查缓存 - 有缓存直接使用
    const cached = evaluationCache.get(evaluationId);
    if (cached) {
      setDetailsLoading(false);
      setTestCases(cached.testCases);
      setCriteria(cached.criteria);
      setRuns(cached.runs);
      setResults(cached.results);
      setSelectedRun(cached.runs.find(r => r.id === cached.selectedRunId) || null);
      return;
    }

    // 如果正在加载这个评测，只需要显示加载状态，不重复发起请求
    if (loadingEvaluations.has(evaluationId)) {
      setDetailsLoading(true);
      setTestCases([]);
      setCriteria([]);
      setRuns([]);
      setResults([]);
      setSelectedRun(null);
      return;
    }

    loadingEvaluations.add(evaluationId);
    setDetailsLoading(true);
    setTestCases([]);
    setCriteria([]);
    setRuns([]);
    setResults([]);
    setSelectedRun(null);

    try {
      // 使用新 API 获取评测详情（包含所有关联数据）
      const evaluation = await evaluationsApi.getById(evaluationId);

      // 同步评测状态/结果，避免列表缓存导致状态漂移（例如 run 已完成但列表仍显示运行中）
      setSelectedEvaluation((prev) =>
        prev?.id === evaluationId
          ? { ...prev, status: evaluation.status, results: evaluation.results, completedAt: evaluation.completedAt }
          : prev
      );
      setEvaluations((prev) => {
        const next = prev.map((e) =>
          e.id === evaluationId
            ? { ...e, status: evaluation.status, results: evaluation.results, completedAt: evaluation.completedAt }
            : e
        );
        updateListCache({ evaluations: next });
        return next;
      });

      const loadedTestCases = (evaluation.testCases || []).map(tc => ({
        ...tc,
        attachments: (tc.attachments as FileAttachment[]) || [],
        notes: tc.notes || null,
      })) as TestCase[];
      const loadedCriteria = (evaluation.criteria || []) as EvaluationCriterion[];
      const loadedRuns = (evaluation.runs || []) as EvaluationRun[];

      let loadedResults: TestCaseResult[] = [];
      let loadedSelectedRunId: string | null = null;

      if (loadedRuns.length > 0) {
        const latestActiveRun = loadedRuns.find((r) => r.status === 'running' || r.status === 'pending');
        const latestCompletedRun = loadedRuns.find((r) => r.status === 'completed');
        const latestFailedRun = loadedRuns.find((r) => r.status === 'failed');
        const preferredRun = latestActiveRun ?? latestCompletedRun ?? latestFailedRun;
        if (preferredRun) {
          loadedSelectedRunId = preferredRun.id;
          try {
            loadedResults = await runsApi.getResults(preferredRun.id);
          } catch (e) {
            // Keep evaluation details visible even if loading run results fails.
            console.error('Failed to load run results:', e);
            loadedResults = [];
          }
        }
      }

      // 存入缓存
      evaluationCache.set(evaluationId, {
        testCases: loadedTestCases,
        criteria: loadedCriteria,
        runs: loadedRuns,
        results: loadedResults,
        selectedRunId: loadedSelectedRunId,
      });

      // 只有当前选中的评测还是这个时才更新状态
      if (selectedEvaluationIdRef.current === evaluationId) {
        setTestCases(loadedTestCases);
        setCriteria(loadedCriteria);
        setRuns(loadedRuns);
        setResults(loadedResults);
        setSelectedRun(loadedRuns.find(r => r.id === loadedSelectedRunId) || null);
      }
    } catch (error) {
      console.error('Failed to load evaluation details:', error);
    } finally {
      loadingEvaluations.delete(evaluationId);
      if (selectedEvaluationIdRef.current === evaluationId) {
        setDetailsLoading(false);
      }
    }
  }, []);

  // 只在 selectedEvaluation.id 变化时重新加载，避免 status 变化触发重载覆盖数据
  const selectedEvaluationId = selectedEvaluation?.id;
  useEffect(() => {
    if (selectedEvaluationId) {
      loadEvaluationDetails(selectedEvaluationId);
    } else {
      setTestCases([]);
      setCriteria([]);
      setResults([]);
      setRuns([]);
      setSelectedRun(null);
    }
  }, [selectedEvaluationId, loadEvaluationDetails]);

  useEffect(() => {
    const activeRuns = runs.filter((r) => r.status === 'running' || r.status === 'pending').length;
    setRunningCount(activeRuns);
  }, [runs]);

  const activeRun = useMemo(() => {
    if (selectedRun && (selectedRun.status === 'running' || selectedRun.status === 'pending')) {
      return selectedRun;
    }
    return runs.find((r) => r.status === 'running' || r.status === 'pending') || null;
  }, [selectedRun, runs]);

  const activeRunId = activeRun?.id ?? null;
  const activeRunStatus = activeRun?.status ?? null;
  const selectedRunId = selectedRun?.id ?? null;

  useEffect(() => {
    if (!selectedEvaluationId || !activeRunId) {
      if (runPollerRef.current) {
        clearInterval(runPollerRef.current);
        runPollerRef.current = null;
      }
      return;
    }

    const evalId = selectedEvaluationId;
    const pollRunId = activeRunId;
    const shouldUpdateResults = selectedRunId === pollRunId;
    let canceled = false;
    let polling = false;

    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const activeRunIds = Array.from(
          new Set([
            ...runsRef.current
              .filter((r) => r.status === 'running' || r.status === 'pending')
              .map((r) => r.id),
            pollRunId,
          ])
        );

        const settled = await Promise.allSettled(activeRunIds.map((runId) => runsApi.getById(runId)));
        if (canceled) return;

        const latestRuns = settled
          .filter((result): result is PromiseFulfilledResult<EvaluationRun> => result.status === 'fulfilled')
          .map((result) => result.value);

        if (latestRuns.length === 0) return;

        const latestById = new Map(latestRuns.map((r) => [r.id, r]));
        const primaryRun = latestById.get(pollRunId);

        setRuns((prev) => {
          let changed = false;
          const next = prev.map((r) => {
            const updated = latestById.get(r.id);
            if (!updated) return r;
            changed = true;
            return updated;
          });
          if (!changed) return prev;

          const cached = evaluationCache.get(evalId);
          if (cached) {
            evaluationCache.set(evalId, { ...cached, runs: next });
          }
          return next;
        });

        setSelectedRun((prev) => {
          if (!prev) return prev;
          const updated = latestById.get(prev.id);
          return updated ?? prev;
        });

        if (primaryRun) {
          setSelectedEvaluation((prev) =>
            prev?.id === evalId
              ? {
                  ...prev,
                  status: primaryRun.status,
                  results: primaryRun.status === 'completed' ? primaryRun.results : prev.results,
                  completedAt: primaryRun.completedAt ?? prev.completedAt,
                }
              : prev
          );
          setEvaluations((prev) => {
            const next = prev.map((e) =>
              e.id === evalId
                ? {
                    ...e,
                    status: primaryRun.status,
                    results: primaryRun.status === 'completed' ? primaryRun.results : e.results,
                    completedAt: primaryRun.completedAt ?? e.completedAt,
                  }
                : e
            );
            updateListCache({ evaluations: next });
            return next;
          });

          if (shouldUpdateResults) {
            const latestResults = await runsApi.getResults(primaryRun.id);
            if (canceled) return;
            setResults((prev) => {
              const next = mergeResultsByTestCase(prev, latestResults);
              updateEvaluationCache(evalId, { results: next, selectedRunId: primaryRun.id });
              return next;
            });
          }
        }
      } catch (error) {
        console.error('Failed to poll run status:', error);
      } finally {
        polling = false;
      }
    };

    if (runPollerRef.current) {
      clearInterval(runPollerRef.current);
    }
    runPollerRef.current = setInterval(poll, 2000);
    void poll();

    return () => {
      canceled = true;
      if (runPollerRef.current) {
        clearInterval(runPollerRef.current);
        runPollerRef.current = null;
      }
    };
  }, [activeRunId, activeRunStatus, selectedEvaluationId, selectedRunId]);

  // Keep the selected test case IDs in sync with the loaded test cases.
  useEffect(() => {
    setSelectedTestCaseIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(testCases.map((tc) => tc.id));
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [testCases]);

  const toggleTestCaseSelected = (testCaseId: string, selected: boolean) => {
    setSelectedTestCaseIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(testCaseId);
      else next.delete(testCaseId);
      return next;
    });
  };

  const canDragEvaluation = useCallback(
    (evaluation: EvaluationWithRelations) =>
      !!currentUserId && evaluation.userId === currentUserId && !hasEvaluationFilter,
    [currentUserId, hasEvaluationFilter]
  );

  const isSelectedEvaluationOwner =
    !!currentUserId && !!selectedEvaluation && selectedEvaluation.userId === currentUserId;

  const downloadAttachmentBlob = useCallback(
    (fileId: string, options?: { signal?: AbortSignal }) => {
      if (!selectedEvaluationId) {
        return Promise.reject(new Error('No evaluation selected'));
      }

      if (isSelectedEvaluationOwner) {
        return filesApi.downloadBlob(fileId, options);
      }

      return filesApi.downloadEvaluationAttachmentBlob(selectedEvaluationId, fileId, options);
    },
    [isSelectedEvaluationOwner, selectedEvaluationId]
  );

  const reorderEvaluations = useCallback(
    (list: EvaluationWithRelations[], fromId: string, toId: string) => {
      const fromIndex = list.findIndex((evaluation) => evaluation.id === fromId);
      const toIndex = list.findIndex((evaluation) => evaluation.id === toId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
        return list;
      }

      const reordered = [...list];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);

      return reordered.map((evaluation, index) => (
        evaluation.orderIndex === index ? evaluation : { ...evaluation, orderIndex: index }
      ));
    },
    []
  );

  const handleEvaluationDragStart = (evaluation: EvaluationWithRelations) => {
    if (!canDragEvaluation(evaluation)) return;
    setDraggedEvaluationId(evaluation.id);
  };

  const handleEvaluationDragOver = (event: DragEvent<HTMLButtonElement>, target: EvaluationWithRelations) => {
    event.preventDefault();
    if (!draggedEvaluationId || draggedEvaluationId === target.id) return;
    if (!canDragEvaluation(target)) return;

    setEvaluations((prev) => {
      const next = reorderEvaluations(prev, draggedEvaluationId, target.id);
      if (next === prev) return prev;
      updateListCache({ evaluations: next });
      return next;
    });
  };

  const handleEvaluationDragEnd = async () => {
    if (isFinalizingEvaluationDragRef.current) return;
    const draggedId = draggedEvaluationId;
    setDraggedEvaluationId(null);
    if (!draggedId || !currentUserId) return;

    isFinalizingEvaluationDragRef.current = true;
    const updates = evaluations
      .filter((evaluation) => evaluation.userId === currentUserId)
      .map((evaluation, index) => ({ id: evaluation.id, orderIndex: index }));

    try {
      if (updates.length > 0) {
        await evaluationsApi.batchUpdateOrder(updates);
      }
    } catch (e) {
      console.error('Failed to update evaluation order:', e);
    } finally {
      isFinalizingEvaluationDragRef.current = false;
    }
  };

  // 同步评测配置中的模型参数到 evalModelConfig
  useEffect(() => {
    if (selectedEvaluation?.config?.model_parameters) {
      const params = selectedEvaluation.config.model_parameters;
      setEvalModelConfig({
        temperature: params.temperature ?? DEFAULT_PROMPT_CONFIG.temperature,
        top_p: params.top_p ?? DEFAULT_PROMPT_CONFIG.top_p,
        frequency_penalty: params.frequency_penalty ?? DEFAULT_PROMPT_CONFIG.frequency_penalty,
        presence_penalty: params.presence_penalty ?? DEFAULT_PROMPT_CONFIG.presence_penalty,
        max_tokens: params.max_tokens ?? DEFAULT_PROMPT_CONFIG.max_tokens,
        reasoning: DEFAULT_PROMPT_CONFIG.reasoning,
      });
    } else {
      setEvalModelConfig(DEFAULT_PROMPT_CONFIG);
    }
  }, [selectedEvaluation?.config?.model_parameters]);

  const loadData = useCallback(async () => {
    // 检查是否有 prompts 更新（精确更新缓存，而不是全量刷新）
    if (cacheEvents.hasPendingUpdates('prompts')) {
      const updatedPrompts = cacheEvents.consumePendingUpdates('prompts') as Prompt[];
      if (listCache && updatedPrompts.length > 0) {
        const existingIds = new Set(listCache.prompts.map((p) => p.id));
        const updatedById = new Map(updatedPrompts.map((p) => [p.id, p]));
        const merged = listCache.prompts.map((p) => updatedById.get(p.id) || p);

        for (const [id, prompt] of updatedById) {
          if (!existingIds.has(id)) {
            merged.unshift(prompt);
          }
        }

        listCache.prompts = merged;
      }
    }

    const shouldInvalidateListCache =
      cacheEvents.hasPendingUpdates('models') ||
      cacheEvents.hasPendingUpdates('providers') ||
      cacheEvents.hasPendingUpdates('evaluations');

    if (shouldInvalidateListCache) {
      cacheEvents.consumePendingUpdates('models');
      cacheEvents.consumePendingUpdates('providers');
      cacheEvents.consumePendingUpdates('evaluations');
      listCache = null;
    }

    // 如果有缓存，先使用缓存
    if (listCache) {
      setEvaluations(listCache.evaluations);
      setPrompts(listCache.prompts);
      setPromptGroups(listCache.promptGroups);
      setModels(listCache.models);
      setProviders(listCache.providers);
      if (listCache.evaluations.length > 0 && !selectedEvaluationIdRef.current) {
        const byId = evaluationIdFromUrl
          ? listCache.evaluations.find((e) => e.id === evaluationIdFromUrl) ?? null
          : null;
        const firstMine = currentUserId
          ? listCache.evaluations.find((e) => e.userId === currentUserId) ?? null
          : listCache.evaluations[0] ?? null;
        const firstPublic = currentUserId
          ? listCache.evaluations.find((e) => e.isPublic && e.userId !== currentUserId) ?? null
          : listCache.evaluations.find((e) => e.isPublic) ?? null;

        const pickForMode =
          listModeRef.current === 'public'
            ? firstPublic ?? firstMine
            : firstMine ?? firstPublic;

        const initial = byId ?? pickForMode ?? null;
        if (initial) {
          setListMode(initial.userId === currentUserId ? 'mine' : 'public');
          selectEvaluation(initial);
        }
      }
      setListLoading(false);

      // Evaluation status/progress can change while the list is cached (e.g. runs completing in background).
      // Refresh evaluation list in background only when there are running/pending items to avoid extra churn.
      if (listCache.evaluations.some((e) => e.status === 'running' || e.status === 'pending')) {
        (async () => {
          try {
            const latest = await evaluationsApi.list();
            setEvaluations(latest as EvaluationWithRelations[]);
            if (listCache) {
              listCache.evaluations = latest as EvaluationWithRelations[];
            }
          } catch (e) {
            console.error('Failed to refresh evaluations:', e);
          }
        })();
      }
      return;
    }

    setListLoading(true);
    try {
      // 并行加载所有数据
      const [evalsData, promptsData, promptGroupsData, modelsData, providersData] = await Promise.all([
        evaluationsApi.list(),
        promptsApi.list(),
        promptGroupsApi.list(),
        modelsApi.list(),
        providersApi.list(),
      ]);

      const loadedEvaluations = (evalsData || []) as EvaluationWithRelations[];
      const loadedPrompts = (promptsData || []) as Prompt[];
      const loadedPromptGroups = (promptGroupsData || []) as PromptGroup[];
      const loadedModels = (modelsData || []) as Model[];
      const loadedProviders = (providersData || []).filter(p => p.enabled) as Provider[];

      // 保存到缓存
      listCache = {
        evaluations: loadedEvaluations,
        prompts: loadedPrompts,
        promptGroups: loadedPromptGroups,
        models: loadedModels,
        providers: loadedProviders,
      };

      setEvaluations(loadedEvaluations);
      setPrompts(loadedPrompts);
      setPromptGroups(loadedPromptGroups);
      setModels(loadedModels);
      setProviders(loadedProviders);

      if (loadedEvaluations.length > 0 && !selectedEvaluationIdRef.current) {
        const byId = evaluationIdFromUrl
          ? loadedEvaluations.find((e) => e.id === evaluationIdFromUrl) ?? null
          : null;
        const firstMine = currentUserId
          ? loadedEvaluations.find((e) => e.userId === currentUserId) ?? null
          : loadedEvaluations[0] ?? null;
        const firstPublic = currentUserId
          ? loadedEvaluations.find((e) => e.isPublic && e.userId !== currentUserId) ?? null
          : loadedEvaluations.find((e) => e.isPublic) ?? null;

        const pickForMode =
          listModeRef.current === 'public'
            ? firstPublic ?? firstMine
            : firstMine ?? firstPublic;

        const initial = byId ?? pickForMode ?? null;
        if (initial) {
          setListMode(initial.userId === currentUserId ? 'mine' : 'public');
          selectEvaluation(initial);
        }
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setListLoading(false);
    }
  }, [selectEvaluation, currentUserId, evaluationIdFromUrl]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 更新缓存的辅助函数
  const updateEvaluationCache = (evaluationId: string, updates: Partial<EvaluationCacheData>) => {
    const cached = evaluationCache.get(evaluationId);
    if (cached) {
      evaluationCache.set(evaluationId, { ...cached, ...updates });
    }
  };

  const clearEvaluationCache = (evaluationId: string) => {
    evaluationCache.delete(evaluationId);
  };

  // 更新列表缓存
  const updateListCache = (updates: Partial<ListCache>) => {
    if (listCache) {
      listCache = { ...listCache, ...updates };
    }
  };

  const hasPromptDetail = (prompt: Prompt | null | undefined) =>
    !!prompt && Object.prototype.hasOwnProperty.call(prompt, 'config');

  const formatPromptMessages = (messages: Prompt['messages']) =>
    messages.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n');

  type PromptConfigLike = PromptConfig | Prompt['config'];
  type ResolvedModelParameters = Pick<
    PromptConfig,
    'temperature' | 'top_p' | 'frequency_penalty' | 'presence_penalty' | 'max_tokens'
  >;
  type PromptSnapshot = {
    content: Prompt['content'];
    messages: Prompt['messages'];
    config?: PromptConfigLike;
  };

  const getPromptTemplate = (prompt: PromptSnapshot | null | undefined) => {
    if (!prompt) return '';
    if (Array.isArray(prompt.messages) && prompt.messages.length > 0) {
      return formatPromptMessages(prompt.messages);
    }
    return prompt.content || '';
  };

  const buildModelParamsFromPrompt = (config?: PromptConfigLike): ResolvedModelParameters => ({
    temperature: config?.temperature ?? DEFAULT_PROMPT_CONFIG.temperature,
    top_p: config?.top_p ?? DEFAULT_PROMPT_CONFIG.top_p,
    frequency_penalty: config?.frequency_penalty ?? DEFAULT_PROMPT_CONFIG.frequency_penalty,
    presence_penalty: config?.presence_penalty ?? DEFAULT_PROMPT_CONFIG.presence_penalty,
    max_tokens: config?.max_tokens ?? DEFAULT_PROMPT_CONFIG.max_tokens,
  });

  const buildPromptConfigWithDefaults = (config?: PromptConfigLike): PromptConfig => ({
    ...buildModelParamsFromPrompt(config),
    reasoning: config?.reasoning ?? DEFAULT_PROMPT_CONFIG.reasoning,
  });

  const resolveModelParameters = (
    config: EvaluationConfig,
    prompt: PromptSnapshot | null
  ): ModelParameters | undefined => {
    if (config.inherited_from_prompt && prompt?.config) {
      return buildModelParamsFromPrompt(prompt.config);
    }
    if (config.model_parameters) {
      return config.model_parameters;
    }
    if (prompt?.config) {
      return buildModelParamsFromPrompt(prompt.config);
    }
    return undefined;
  };

  const upsertPrompt = (nextPrompt: Prompt) => {
    setPrompts((prev) => {
      const exists = prev.some((p) => p.id === nextPrompt.id);
      const next = exists ? prev.map((p) => (p.id === nextPrompt.id ? nextPrompt : p)) : [nextPrompt, ...prev];
      updateListCache({ prompts: next });
      return next;
    });
  };

  const ensurePromptDetail = async (promptId: string | null | undefined): Promise<PromptSnapshot | null> => {
    if (!promptId) return null;
    const cached = prompts.find((p) => p.id === promptId);
    if (cached && hasPromptDetail(cached)) return cached;

    try {
      const fullPrompt = await promptsApi.getById(promptId);
      upsertPrompt(fullPrompt as Prompt);
      return fullPrompt as Prompt;
    } catch (e) {
      // Fallback for public prompts (e.g. public evaluations referencing a public prompt not owned by the user).
      try {
        const publicPrompt = await promptsApi.getPublicById(promptId);
        return {
          content: publicPrompt.content,
          messages: (publicPrompt.messages && publicPrompt.messages.length > 0)
            ? (publicPrompt.messages as Prompt['messages'])
            : parseMessagesFromContent(publicPrompt.content),
          config: publicPrompt.config as PromptConfigLike,
        };
      } catch (publicError) {
        console.error('Failed to load prompt detail:', e, publicError);
        return cached ?? null;
      }
    }
  };

  const parseMessagesFromContent = (content: string | null | undefined): Prompt['messages'] => {
    if (!content) return [];
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed.filter((m) => m && typeof m === 'object' && 'role' in m && 'content' in m) as Prompt['messages'];
      }
    } catch {
      return [];
    }
    return [];
  };

  const getPromptSnapshotForRun = async (
    runConfig: EvaluationRun['runConfig'],
    fallbackPromptId: string | null | undefined
  ): Promise<PromptSnapshot | null> => {
    const promptId = runConfig?.promptId || fallbackPromptId;
    if (!promptId) return null;
    const promptVersion = runConfig?.promptVersion ?? null;

    if (promptVersion) {
      try {
        const version = await promptsApi.getVersion(promptId, promptVersion);
        const messages = version.messages && version.messages.length > 0
          ? version.messages
          : parseMessagesFromContent(version.content);
        return {
          content: version.content,
          messages,
          config: version.config,
        };
      } catch (e) {
        console.error('Failed to load prompt version:', e);
      }
    }

    return ensurePromptDetail(promptId);
  };

  const handleCreateEvaluation = async () => {
    if (!newEvalName.trim()) return;
    try {
      const data = await evaluationsApi.create({
        name: newEvalName.trim(),
        promptId: newEvalPrompt || undefined,
        modelId: newEvalModel || undefined,
        judgeModelId: newEvalJudgeModel || undefined,
        config: { pass_threshold: 0.6 },
      });

      const newEvaluations = [data as EvaluationWithRelations, ...evaluations];
      updateListCache({ evaluations: newEvaluations });
      setEvaluations(newEvaluations);
      selectEvaluation(data as EvaluationWithRelations);
      setNewEvalName('');
      setNewEvalPrompt('');
      setNewEvalModel('');
      setNewEvalJudgeModel('');
      setShowNewEval(false);
      showToast('success', t('evaluationCreated'));
    } catch (e) {
      showToast('error', t('createFailed') + ': ' + getErrorMessage(e));
    }
  };

  const handleAddTestCase = async (): Promise<TestCase | null> => {
    if (!selectedEvaluation) return null;

    try {
      // 先调用 API 创建测试用例
      const savedTestCase = await testCasesApi.create(selectedEvaluation.id, {
        name: '',
        inputText: '',
        inputVariables: {},
        attachments: [],
        expectedOutput: undefined,
        notes: undefined,
        orderIndex: testCases.length,
      });

      const newTestCases = [...testCases, savedTestCase];
      setTestCases(newTestCases);
      updateEvaluationCache(selectedEvaluation.id, { testCases: newTestCases });
      return savedTestCase;
    } catch (e) {
      console.error('Failed to add test case:', e);
      showToast('error', t('updateFailed'));
    }
    return null;
  };

  const handleUpdateTestCase = async (testCase: TestCase) => {
    if (!selectedEvaluation) return;

    const newTestCases = testCases.map((tc) => (tc.id === testCase.id ? testCase : tc));
    setTestCases(newTestCases);
    updateEvaluationCache(selectedEvaluation.id, { testCases: newTestCases });

    // 立即保存到数据库
    try {
      await testCasesApi.update(testCase.id, {
        name: testCase.name || undefined,
        inputText: testCase.inputText,
        inputVariables: testCase.inputVariables,
        attachments: testCase.attachments,
        expectedOutput: testCase.expectedOutput ?? undefined,
        notes: testCase.notes ?? undefined,
        orderIndex: testCase.orderIndex,
      });
    } catch (e) {
      console.error('Failed to update test case:', e);
      showToast('error', t('updateFailed'));
    }
  };

  const handleDeleteTestCase = async (id: string) => {
    if (!selectedEvaluation) return;

    // 先调用 API 删除
    try {
      await testCasesApi.delete(id);
    } catch (e) {
      console.error('Failed to delete test case:', e);
      showToast('error', t('deleteFailed'));
      return;
    }

    const newTestCases = testCases
      .filter((tc) => tc.id !== id)
      .map((tc, idx) => ({ ...tc, orderIndex: idx }));
    setTestCases(newTestCases);
    updateEvaluationCache(selectedEvaluation.id, { testCases: newTestCases });
  };

  const handleCopyTestCase = async (testCase: TestCase): Promise<TestCase | null> => {
    if (!selectedEvaluation) return null;

    const baseName = testCase.name?.trim();
    const name = baseName ? `${baseName} ${t('copy')}` : t('testCaseNum', { num: testCases.length + 1 });

    try {
      const savedTestCase = await testCasesApi.create(selectedEvaluation.id, {
        name,
        inputText: testCase.inputText,
        inputVariables: testCase.inputVariables,
        attachments: testCase.attachments,
        expectedOutput: testCase.expectedOutput ?? undefined,
        notes: testCase.notes ?? undefined,
        orderIndex: testCases.length,
      });

      const newTestCases = [...testCases, savedTestCase];
      setTestCases(newTestCases);
      updateEvaluationCache(selectedEvaluation.id, { testCases: newTestCases });
      return savedTestCase;
    } catch (e) {
      console.error('Failed to copy test case:', e);
      showToast('error', t('copyTestCaseFailed'));
      return null;
    }
  };

  const handleDeleteSelectedTestCases = async (ids: string[]) => {
    if (!selectedEvaluation || ids.length === 0) return;

    const results = await Promise.allSettled(ids.map((id) => testCasesApi.delete(id)));
    const deletedIds = ids.filter((_, index) => results[index].status === 'fulfilled');

    if (deletedIds.length === 0) {
      showToast('error', t('deleteFailed'));
      return;
    }

    const newTestCases = testCases
      .filter((testCase) => !deletedIds.includes(testCase.id))
      .map((testCase, idx) => ({ ...testCase, orderIndex: idx }));
    setTestCases(newTestCases);
    updateEvaluationCache(selectedEvaluation.id, { testCases: newTestCases });
    setSelectedTestCaseIds(new Set());

    if (deletedIds.length < ids.length) {
      showToast('error', t('deleteFailed'));
    }
  };

  const handleAddCriterion = async (
    criterion: Omit<EvaluationCriterion, 'id' | 'evaluationId' | 'createdAt'>
  ) => {
    if (!selectedEvaluation) return;

    try {
      // 先调用 API 创建评测标准
      const savedCriterion = await criteriaApi.create(selectedEvaluation.id, {
        name: criterion.name,
        description: criterion.description || undefined,
        prompt: criterion.prompt || undefined,
        weight: criterion.weight,
        enabled: criterion.enabled,
      });

      const newCriteria = [...criteria, savedCriterion];
      setCriteria(newCriteria);
      updateEvaluationCache(selectedEvaluation.id, { criteria: newCriteria });
    } catch (e) {
      console.error('Failed to add criterion:', e);
      showToast('error', t('updateFailed'));
    }
  };

  const handleUpdateCriterion = async (criterion: EvaluationCriterion) => {
    if (!selectedEvaluation) return;

    const newCriteria = criteria.map((c) => (c.id === criterion.id ? criterion : c));
    setCriteria(newCriteria);
    updateEvaluationCache(selectedEvaluation.id, { criteria: newCriteria });

    // 立即保存到数据库
    try {
      await criteriaApi.update(criterion.id, {
        name: criterion.name,
        description: criterion.description || undefined,
        prompt: criterion.prompt || undefined,
        weight: criterion.weight,
        enabled: criterion.enabled,
      });
    } catch (e) {
      console.error('Failed to update criterion:', e);
      showToast('error', t('updateFailed'));
    }
  };

  const handleDeleteCriterion = async (id: string) => {
    if (!selectedEvaluation) return;

    // 先调用 API 删除
    try {
      await criteriaApi.delete(id);
    } catch (e) {
      console.error('Failed to delete criterion:', e);
      showToast('error', t('deleteFailed'));
      return;
    }

    const newCriteria = criteria.filter((c) => c.id !== id);
    setCriteria(newCriteria);
    updateEvaluationCache(selectedEvaluation.id, { criteria: newCriteria });
  };

  const handleSelectRun = async (run: EvaluationRun) => {
    if (!selectedEvaluation) return;

    setSelectedRun(run);
    try {
      const resultsData = await runsApi.getResults(run.id);
      setResults(resultsData);
      updateEvaluationCache(selectedEvaluation.id, { results: resultsData, selectedRunId: run.id });
    } catch (e) {
      console.error('Failed to load run results:', e);
    }
    setActiveTab('results');
  };

  const exportColumns = useMemo<CsvColumn[]>(() => [
    { key: 'prompt', label: t('exportPrompt') },
    { key: 'promptVersion', label: t('exportPromptVersion') },
    { key: 'model', label: t('exportModel') },
    { key: 'modelParameters', label: t('exportModelParameters') },
    { key: 'fileProcessing', label: t('exportFileProcessing') },
    { key: 'ocrProvider', label: t('exportOcrProvider') },
    { key: 'testCaseExecutionTime', label: t('exportTestCaseExecutionTime') },
    { key: 'llmLatency', label: t('exportLlmLatency') },
    { key: 'ocrLatency', label: t('exportOcrLatency') },
    { key: 'totalLatency', label: t('exportTotalLatency') },
    { key: 'aiScoreStatus', label: t('exportAiScoreStatus') },
    { key: 'scoreDetails', label: t('exportScoreDetails') },
    { key: 'testCaseName', label: t('exportTestCaseName') },
    { key: 'expectedOutput', label: t('exportExpectedOutput') },
    { key: 'modelOutput', label: t('exportModelOutput') },
    { key: 'attachmentLinks', label: t('exportAttachmentLinks') },
  ], [t]);

  const buildTestCaseMap = () => {
    const testCaseMap = new Map<
      string,
      { name: string; attachments: FileAttachment[]; orderIndex: number; expectedOutput: string | null }
    >();
    testCases.forEach((testCase, index) => {
      testCaseMap.set(testCase.id, {
        name: testCase.name || t('testCaseNum', { num: index + 1 }),
        attachments: testCase.attachments || [],
        orderIndex: testCase.orderIndex ?? index,
        expectedOutput: testCase.expectedOutput ?? null,
      });
    });
    return testCaseMap;
  };

  const resolveRunExportMeta = (run: EvaluationRun) => {
    const runConfig = run.runConfig as RunConfig | null;
    const promptName =
      runConfig?.promptName ?? selectedEvaluation?.prompt?.name ?? selectedEvaluation?.promptId ?? '';
    const promptVersion =
      runConfig?.promptVersion ?? selectedEvaluation?.prompt?.currentVersion ?? '';
    const modelName =
      runConfig?.modelName ??
      selectedEvaluation?.model?.name ??
      selectedEvaluation?.model?.modelId ??
      selectedEvaluation?.modelId ??
      '';
    const modelParameters = formatModelParameters(
      run.modelParameters ?? selectedEvaluation?.config.model_parameters
    );
    const fileProcessingLabel = getFileProcessingLabel(
      t,
      runConfig?.fileProcessing ?? selectedEvaluation?.config.file_processing ?? null
    );
    const ocrProviderLabel = getOcrProviderLabel(
      t,
      runConfig?.ocrProviderResolved ?? runConfig?.ocrProvider ?? selectedEvaluation?.config.ocr_provider ?? null
    );

    return { promptName, promptVersion, modelName, modelParameters, fileProcessingLabel, ocrProviderLabel };
  };

  const buildExecutionExportRows = (
    run: EvaluationRun,
    runResults: TestCaseResult[],
    testCaseMap: Map<string, { name: string; attachments: FileAttachment[]; orderIndex: number; expectedOutput: string | null }>
  ) => {
    const { promptName, promptVersion, modelName, modelParameters, fileProcessingLabel, ocrProviderLabel } = resolveRunExportMeta(run);
    const orderedResults = [...runResults].sort((a, b) => {
      const aOrder = testCaseMap.get(a.testCaseId)?.orderIndex ?? 0;
      const bOrder = testCaseMap.get(b.testCaseId)?.orderIndex ?? 0;
      return aOrder - bOrder;
    });

    return orderedResults.map((result, index) => {
      const testCase = testCaseMap.get(result.testCaseId);
      const testCaseName = testCase?.name || t('testCaseNum', { num: index + 1 });
      const attachments = testCase?.attachments || [];
      const expectedOutput = testCase?.expectedOutput ?? '';
      const attachmentLinks = formatAttachmentLinks(attachments);
      const scores = result.scores || {};
      const feedback = (result.aiFeedback || {}) as Record<string, unknown>;
      const hasScores = Object.keys(scores).length > 0;
      const aiScoreStatus = hasScores ? (result.passed ? t('passed') : t('failed')) : t('notScored');

      return {
        prompt: promptName,
        promptVersion,
        model: modelName,
        modelParameters,
        fileProcessing: fileProcessingLabel,
        ocrProvider: ocrProviderLabel,
        testCaseExecutionTime: formatDateTime(result.createdAt),
        llmLatency: result.latencyMs ?? 0,
        ocrLatency: result.ocrLatencyMs ?? 0,
        totalLatency: (result.latencyMs ?? 0) + (result.ocrLatencyMs ?? 0),
        aiScoreStatus,
        scoreDetails: formatScoreDetails(scores, feedback),
        testCaseName,
        expectedOutput,
        modelOutput: result.modelOutput ?? '',
        attachmentLinks,
      };
    });
  };

  const downloadCsvFile = (filename: string, columns: CsvColumn[], rows: Array<Record<string, unknown>>) => {
    const csv = buildCsv(columns, rows);
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportExecutionRecord = async () => {
    if (!selectedEvaluation || !selectedRun) {
      showToast('error', t('exportNoResults'));
      return;
    }

    setExporting(true);
    try {
      const runResults = await runsApi.getResults(selectedRun.id);
      if (runResults.length === 0) {
        showToast('error', t('exportNoResults'));
        return;
      }

      const testCaseMap = buildTestCaseMap();
      const rows = buildExecutionExportRows(selectedRun, runResults, testCaseMap);
      if (rows.length === 0) {
        showToast('error', t('exportNoResults'));
        return;
      }

      const { modelName } = resolveRunExportMeta(selectedRun);
      const runTimestamp = formatTimestampForFilename(
        selectedRun.startedAt ?? selectedRun.createdAt ?? selectedRun.completedAt
      );
      const safeModelName = sanitizeFilenamePart(modelName, 'model');
      downloadCsvFile(`${safeModelName}_${runTimestamp}.csv`, exportColumns, rows);
    } catch (error) {
      console.error('Failed to export execution record:', error);
      showToast('error', t('exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const handleBatchExportExecutionRecords = async (targetRuns: EvaluationRun[]) => {
    if (!selectedEvaluation) {
      showToast('error', t('exportNoResults'));
      return;
    }
    if (targetRuns.length === 0) {
      showToast('error', t('exportNoResults'));
      return;
    }

    setBatchExporting(true);
    try {
      const testCaseMap = buildTestCaseMap();
      const results = await Promise.allSettled(
        targetRuns.map(async (run) => ({
          run,
          runResults: await runsApi.getResults(run.id),
        }))
      );

      const rows: Array<Record<string, unknown>> = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const runResults = result.value.runResults;
          if (runResults.length === 0) continue;
          rows.push(...buildExecutionExportRows(result.value.run, runResults, testCaseMap));
        } else {
          console.error('Failed to load run results:', result.reason);
        }
      }

      if (rows.length === 0) {
        showToast('error', t('exportNoResults'));
        return;
      }

      const exportTimestamp = formatTimestampForFilename(new Date());
      const safeEvalName = sanitizeFilenamePart(selectedEvaluation.name, 'evaluation');
      downloadCsvFile(`${safeEvalName}_${exportTimestamp}.csv`, exportColumns, rows);
    } catch (error) {
      console.error('Failed to batch export execution records:', error);
      showToast('error', t('exportFailed'));
    } finally {
      setBatchExporting(false);
    }
  };

  const runEvaluation = async () => {
    if (!selectedEvaluation) return;
    if (testCases.length === 0) {
      showToast('error', t('addTestCasesFirst'));
      return;
    }
    if (!selectedEvaluation.modelId) {
      showToast('error', t('selectModelFirst'));
      return;
    }

    const model = models.find((m) => m.id === selectedEvaluation.modelId);
    const provider = providers.find((p) => p.id === model?.providerId);
    const prompt = await ensurePromptDetail(selectedEvaluation.promptId);

    if (!model || !provider) {
      showToast('error', t('modelOrProviderNotFound'));
      return;
    }

    const evalId = selectedEvaluation.id;
    const evalConfig = selectedEvaluation.config;
    const currentTestCases = [...testCases];
    const selectedIdsSnapshot = selectedTestCaseIds.size > 0 ? new Set(selectedTestCaseIds) : null;
    const casesToRun = selectedIdsSnapshot
      ? currentTestCases.filter((tc) => selectedIdsSnapshot.has(tc.id))
      : currentTestCases;
    if (casesToRun.length === 0) {
      showToast('error', t('noTestCasesSelected'));
      return;
    }

    const modelParams = resolveModelParameters(evalConfig, prompt);

    showToast('info', t('evaluationStarted'));
    setActiveTab('history');

    let runData: EvaluationRun;
    try {
      runData = await runsApi.execute(evalId, {
        modelParameters: modelParams ? modelParams as Record<string, unknown> : undefined,
        testCaseIds: casesToRun.map((tc) => tc.id),
      });
    } catch {
      showToast('error', t('createExecutionRecordFailed'));
      return;
    }

    const currentRun: EvaluationRun = runData;
    setRuns((prev) => {
      const newRuns = [currentRun, ...prev];
      const cached = evaluationCache.get(evalId);
      if (cached) {
        evaluationCache.set(evalId, { ...cached, runs: newRuns, results: [], selectedRunId: currentRun.id });
      }
      return newRuns;
    });
    setSelectedRun(currentRun);
    setResults([]);
    updateEvaluationCache(evalId, { results: [], selectedRunId: currentRun.id });

    setSelectedEvaluation((prev) =>
      prev?.id === evalId
        ? { ...prev, status: currentRun.status, results: currentRun.status === 'completed' ? currentRun.results : prev.results }
        : prev
    );
    setEvaluations((prev) => {
      const next = prev.map((e) =>
        e.id === evalId
          ? { ...e, status: currentRun.status, results: currentRun.status === 'completed' ? currentRun.results : e.results }
          : e
      );
      updateListCache({ evaluations: next });
      return next;
    });
  };

  const buildFinalPromptForTestCase = (testCase: TestCase, prompt: PromptSnapshot | null | undefined) => {
    let systemPrompt = getPromptTemplate(prompt);
    let userMessage = '';

    const vars = { ...(testCase.inputVariables || {}) } as Record<string, string>;
    for (const [key, value] of Object.entries(vars)) {
      systemPrompt = systemPrompt.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }

    if (systemPrompt.includes('{{input}}')) {
      systemPrompt = systemPrompt.replace(/{{input}}/g, testCase.inputText || '');
    } else {
      userMessage = testCase.inputText || '';
    }

    return userMessage ? `${systemPrompt}\n\n${userMessage}`.trim() : systemPrompt;
  };

  const computeWeightedPass = (
    scores: Record<string, number>,
    enabledCriteria: EvaluationCriterion[],
    passThreshold: number
  ) => {
    const names = Object.keys(scores);
    if (names.length === 0) return true;
    const weightSum = enabledCriteria.reduce((sum, c) => sum + (c.weight || 0), 0) || 1;
    const weighted = names.reduce((sum, name) => {
      const criterion = enabledCriteria.find((c) => c.name === name);
      return sum + scores[name] * (criterion?.weight || 1);
    }, 0);
    return weighted / weightSum >= passThreshold;
  };

  const recomputeAndPersistRunResults = async (updatedResults: TestCaseResult[]) => {
    if (!selectedEvaluation || !selectedRun) return;

    const enabledCriteria = criteria.filter((c) => c.enabled);
    const totalCasesFromRun = (selectedRun.results as { totalCases?: number })?.totalCases || updatedResults.length;
    const passedCases = updatedResults.filter((r) => r.passed).length;

    const overallScores: Record<string, number> = {};
    if (enabledCriteria.length > 0 && updatedResults.length > 0) {
      for (const criterion of enabledCriteria) {
        const sum = updatedResults.reduce((acc, r) => {
          const value = r.scores?.[criterion.name];
          return acc + (typeof value === 'number' ? value : 0);
        }, 0);
        overallScores[criterion.name] = sum / updatedResults.length;
      }
    }

    const totalTokensInput = updatedResults.reduce((sum, r) => sum + (r.tokensInput || 0), 0);
    const totalTokensOutput = updatedResults.reduce((sum, r) => sum + (r.tokensOutput || 0), 0);
    const llmTimeMs = updatedResults.reduce((sum, r) => sum + (r.latencyMs || 0), 0);
    const ocrTimeMs = updatedResults.reduce((sum, r) => sum + (r.ocrLatencyMs || 0), 0);
    const rate = totalCasesFromRun > 0 ? ((passedCases / totalCasesFromRun) * 100).toFixed(0) : '0';

    const nextRunResults = {
      scores: overallScores,
      totalCases: totalCasesFromRun,
      completedCases: updatedResults.length,
      passedCases,
      llmTimeMs,
      ocrTimeMs,
      summary: t('summaryTemplate', { total: totalCasesFromRun, passed: passedCases, rate }),
    };

    try {
      await runsApi.update(selectedRun.id, {
        results: nextRunResults,
        totalTokensInput,
        totalTokensOutput,
      });
    } catch (e) {
      console.error('Failed to update run summary:', e);
    }

    setRuns((prev) => prev.map((r) =>
      r.id === selectedRun.id
        ? { ...r, results: nextRunResults, totalTokensInput, totalTokensOutput }
        : r
    ));
    setSelectedRun((prev) =>
      prev?.id === selectedRun.id
        ? { ...prev, results: nextRunResults, totalTokensInput, totalTokensOutput }
        : prev
    );

    // Keep evaluation summary aligned with the latest run summary.
    try {
      await evaluationsApi.update(selectedEvaluation.id, { results: nextRunResults });
    } catch (e) {
      console.error('Failed to update evaluation summary:', e);
    }
    setSelectedEvaluation((prev) => prev?.id === selectedEvaluation.id ? { ...prev, results: nextRunResults } : prev);
    setEvaluations((prev) => {
      const next = prev.map((e) =>
        e.id === selectedEvaluation.id ? { ...e, results: nextRunResults } : e
      );
      updateListCache({ evaluations: next });
      return next;
    });
  };

  const handleRetryOutput = async (testCaseId: string) => {
    if (!selectedEvaluation || !selectedRun) return;
    if (!selectedEvaluation.modelId) {
      showToast('error', t('selectModelFirst'));
      return;
    }

    const testCase = testCases.find((tc) => tc.id === testCaseId);
    if (!testCase) {
      showToast('error', t('testCaseNotFound'));
      return;
    }

    const runConfig = selectedRun.runConfig;
    const modelId = runConfig?.modelId || selectedEvaluation.modelId;
    const model = models.find((m) => m.id === modelId);
    if (!model) {
      showToast('error', t('modelOrProviderNotFound'));
      return;
    }

    const enabledCriteria = criteria.filter((c) => c.enabled);
    const requiresAiEvaluation = enabledCriteria.length > 0 && !!selectedEvaluation.judgeModelId;

    setRetryingOutputTestCaseId(testCaseId);
    try {
      const evalConfig = selectedEvaluation.config;
      const prompt = await getPromptSnapshotForRun(runConfig, selectedEvaluation.promptId);
      const runModelParams = selectedRun.modelParameters || undefined;
      const modelParams = runModelParams ?? resolveModelParameters(evalConfig, prompt);

      const finalPrompt = buildFinalPromptForTestCase(testCase, prompt);
      const files: FileAttachment[] = testCase.attachments || [];
      const fileProcessing = (runConfig?.fileProcessing as EvaluationConfig['file_processing']) || evalConfig.file_processing || 'auto';
      const includeFiles = fileProcessing !== 'none' && (fileProcessing !== 'vision' || model.supportsVision);

      let userContent: string | ContentPart[] = finalPrompt;
      if (files.length > 0 && includeFiles) {
        const contentParts: ContentPart[] = [{ type: 'text' as const, text: finalPrompt }];
        for (const file of files) {
          contentParts.push({ type: 'file_ref' as const, file_ref: { fileId: file.fileId } });
        }
        userContent = contentParts;
      }

      const abortController = chatApi.createAbortController();
      retryOutputAbortControllersRef.current.set(testCaseId, abortController);
      const aiResponse = await chatApi.complete({
        modelId: model.id,
        messages: [{ role: 'user', content: userContent }],
        temperature: modelParams?.temperature,
        top_p: modelParams?.top_p,
        max_tokens: modelParams?.max_tokens,
        frequency_penalty: modelParams?.frequency_penalty,
        presence_penalty: modelParams?.presence_penalty,
        saveTrace: false,
        isEvalCase: true,
        fileProcessing,
        ocrProvider: (runConfig?.ocrProviderResolved as EvaluationConfig['ocr_provider']) || (runConfig?.ocrProvider as EvaluationConfig['ocr_provider']) || evalConfig.ocr_provider,
      }, abortController.signal);

      const payload = {
        testCaseId,
        modelOutput: aiResponse.content,
        scores: {},
        aiFeedback: {},
        latencyMs: aiResponse.latencyMs,
        ocrLatencyMs: aiResponse.ocrLatencyMs || 0,
        tokensInput: aiResponse.usage.prompt_tokens,
        tokensOutput: aiResponse.usage.completion_tokens,
        passed: requiresAiEvaluation ? false : true,
        errorMessage: null,
      };

      const saved = await runsApi.addResult(selectedRun.id, payload);

      let nextResults: TestCaseResult[] = [];
      setResults((prev) => {
        nextResults = prev.some((r) => r.testCaseId === saved.testCaseId)
          ? prev.map((r) => (r.testCaseId === saved.testCaseId ? saved : r))
          : [...prev, saved];
        updateEvaluationCache(selectedEvaluation.id, { results: nextResults, selectedRunId: selectedRun.id });
        return nextResults;
      });

      await recomputeAndPersistRunResults(nextResults);
      showToast('success', t('retryOutputSuccess'));
    } catch (e) {
      if (isAbortError(e)) {
        return;
      }
      console.error('Retry output failed:', e);
      showToast('error', t('retryOutputFailed'));
    } finally {
      retryOutputAbortControllersRef.current.delete(testCaseId);
      setRetryingOutputTestCaseId(null);
    }
  };

  const handleAbortRetryOutput = (testCaseId: string) => {
    const controller = retryOutputAbortControllersRef.current.get(testCaseId);
    if (controller) {
      controller.abort();
    }
  };

  const runAiEvaluationForTestCase = async (testCase: TestCase, modelOutput: string, signal?: AbortSignal) => {
    if (!selectedEvaluation?.judgeModelId) {
      throw new Error(t('selectJudgeModelFirst'));
    }

    const enabledCriteria = criteria.filter((c) => c.enabled);
    if (enabledCriteria.length === 0) {
      throw new Error(t('noCriteriaConfigured'));
    }

    const judgeModel = models.find((m) => m.id === selectedEvaluation.judgeModelId);
    if (!judgeModel) {
      throw new Error(t('modelOrProviderNotFound'));
    }

    const scores: Record<string, number> = {};
    const aiFeedback: Record<string, string> = {};

    for (const criterion of enabledCriteria) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      try {
        let evalPrompt = criterion.prompt || '';
        evalPrompt = evalPrompt.replace(/{{input}}/g, testCase.inputText || '');
        evalPrompt = evalPrompt.replace(/{{output}}/g, modelOutput || '');
        if (testCase.expectedOutput) {
          evalPrompt = evalPrompt.replace(/{{#expected}}[\s\S]*?{{\/expected}}/g,
            evalPrompt.match(/{{#expected}}([\s\S]*?){{\/expected}}/)?.[1]?.replace(/{{expected}}/g, testCase.expectedOutput) || ''
          );
          evalPrompt = evalPrompt.replace(/{{expected}}/g, testCase.expectedOutput);
        } else {
          evalPrompt = evalPrompt.replace(/{{#expected}}[\s\S]*?{{\/expected}}/g, '');
        }

        const evalResponse = await chatApi.complete({
          modelId: judgeModel.id,
          messages: [{ role: 'user', content: evalPrompt }],
          saveTrace: false,
          isEvalCase: true,
        }, signal);

        const jsonMatch = evalResponse.content.match(/\{[\s\S]*?"score"[\s\S]*?\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const score = Math.min(1, Math.max(0, (parsed.score || 0) / 10));
          scores[criterion.name] = score;
          aiFeedback[criterion.name] = parsed.reason || '';
        }
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        console.error('AI evaluation error:', error);
        scores[criterion.name] = 0;
        aiFeedback[criterion.name] = t('evaluationFailed');
      }
    }

    const passed = computeWeightedPass(scores, enabledCriteria, selectedEvaluation.config?.pass_threshold || 0.6);
    return { scores, aiFeedback, passed };
  };

  const handleRunAiEvaluation = async (testCaseId: string) => {
    if (!selectedEvaluation || !selectedRun) return;

    const testCase = testCases.find((tc) => tc.id === testCaseId);
    const currentResult = results.find((r) => r.testCaseId === testCaseId);
    if (!testCase || !currentResult) {
      showToast('error', t('testCaseNotFound'));
      return;
    }
    if (!currentResult.modelOutput) {
      showToast('error', t('noOutput'));
      return;
    }

    setRetryingAiEvaluationTestCaseId(testCaseId);
    try {
      const abortController = chatApi.createAbortController();
      retryAiEvaluationAbortControllersRef.current.set(testCaseId, abortController);
      const { scores, aiFeedback, passed } = await runAiEvaluationForTestCase(
        testCase,
        currentResult.modelOutput,
        abortController.signal
      );
      const saved = await runsApi.addResult(selectedRun.id, { testCaseId, scores, aiFeedback, passed });

      let nextResults: TestCaseResult[] = [];
      setResults((prev) => {
        nextResults = prev.some((r) => r.testCaseId === saved.testCaseId)
          ? prev.map((r) => (r.testCaseId === saved.testCaseId ? saved : r))
          : [...prev, saved];
        updateEvaluationCache(selectedEvaluation.id, { results: nextResults, selectedRunId: selectedRun.id });
        return nextResults;
      });

      await recomputeAndPersistRunResults(nextResults);
      showToast('success', t('aiEvaluationComplete'));
    } catch (e) {
      if (isAbortError(e)) {
        return;
      }
      console.error('AI evaluation failed:', e);
      showToast('error', e instanceof Error ? e.message : t('aiEvaluationFailed'));
    } finally {
      retryAiEvaluationAbortControllersRef.current.delete(testCaseId);
      setRetryingAiEvaluationTestCaseId(null);
    }
  };

  const handleAbortAiEvaluation = (testCaseId: string) => {
    const controller = retryAiEvaluationAbortControllersRef.current.get(testCaseId);
    if (controller) {
      controller.abort();
    }
  };

  const handleRetryAllScores = async () => {
    if (!selectedEvaluation || !selectedRun) return;
    if (retryingAllScores) return;

    setRetryingAllScores(true);
    try {
      const updated: TestCaseResult[] = [];
      for (const currentResult of results) {
        const testCase = testCases.find((tc) => tc.id === currentResult.testCaseId);
        if (!testCase || !currentResult.modelOutput) {
          updated.push(currentResult);
          continue;
        }

        const { scores, aiFeedback, passed } = await runAiEvaluationForTestCase(testCase, currentResult.modelOutput);
        const saved = await runsApi.addResult(selectedRun.id, { testCaseId: currentResult.testCaseId, scores, aiFeedback, passed });
        updated.push(saved);
      }

      setResults(updated);
      updateEvaluationCache(selectedEvaluation.id, { results: updated, selectedRunId: selectedRun.id });
      await recomputeAndPersistRunResults(updated);
      showToast('success', t('retryScoresSuccess'));
    } catch (e) {
      console.error('Retry scores failed:', e);
      showToast('error', t('retryScoresFailed'));
    } finally {
      setRetryingAllScores(false);
    }
  };

  const handleAbortRun = async (runId: string) => {
    if (!selectedEvaluation) return;
    const controller = abortControllersRef.current.get(runId);
    const errorMessage = t('evaluationAborted');
    if (controller) {
      controller.aborted = true;
      controller.controller.abort();
      abortControllersRef.current.delete(runId);

      try {
        await runsApi.update(runId, { status: 'failed', errorMessage });
      } catch (e) {
        console.error('Failed to abort run:', e);
      }

      const completedAt = new Date().toISOString();
      setRuns((prev) => prev.map((r) =>
        r.id === runId ? { ...r, status: 'failed' as EvaluationStatus, errorMessage, completedAt } : r
      ));
      setSelectedRun((prev) =>
        prev?.id === runId ? { ...prev, status: 'failed', errorMessage, completedAt } : prev
      );
    } else {
      try {
        const abortedRun = await runsApi.abort(runId);
        setRuns((prev) => prev.map((r) => (r.id === runId ? abortedRun : r)));
        setSelectedRun((prev) => (prev?.id === runId ? abortedRun : prev));
      } catch (e) {
        console.error('Failed to abort run:', e);
      }
    }

    setSelectedEvaluation((prev) => prev?.id === selectedEvaluation.id ? { ...prev, status: 'failed' } : prev);
    setEvaluations((prev) => {
      const next = prev.map((e) =>
        e.id === selectedEvaluation.id ? { ...e, status: 'failed' as EvaluationStatus } : e
      );
      updateListCache({ evaluations: next });
      return next;
    });
    showToast('info', t('evaluationStopped'));
  };

  const handleDeleteRun = async (runId: string) => {
    if (!selectedEvaluation) return;

    try {
      await runsApi.delete(runId);

      const newRuns = runs.filter((r) => r.id !== runId);
      const newResults = results.filter((r) => r.runId !== runId);

      setRuns(newRuns);
      setResults(newResults);

      if (selectedRun?.id === runId) {
        setSelectedRun(newRuns[0] || null);
      }

      // 更新缓存
      updateEvaluationCache(selectedEvaluation.id, {
        runs: newRuns,
        results: newResults,
        selectedRunId: selectedRun?.id === runId ? (newRuns[0]?.id || null) : selectedRun?.id || null,
      });

      showToast('success', t('executionRecordDeleted'));
    } catch {
      showToast('error', t('deleteExecutionRecordFailed'));
    }
  };

  const handleDeleteEvaluation = async () => {
    if (!selectedEvaluation) return;
    try {
      const evalIdToDelete = selectedEvaluation.id;
      await evaluationsApi.delete(evalIdToDelete);

      // 清除缓存
      clearEvaluationCache(evalIdToDelete);

      const remaining = evaluations.filter((e) => e.id !== evalIdToDelete);
      updateListCache({ evaluations: remaining });
      setEvaluations(remaining);
      selectEvaluation(remaining[0] || null);
      showToast('success', t('evaluationDeleted'));
    } catch (e) {
      showToast('error', t('deleteFailed') + ': ' + getErrorMessage(e));
    }
  };

  const handleCopyEvaluation = async () => {
    if (!selectedEvaluation) return;
    setSubmittingNewVersion(true);
    try {
      const newEval = await evaluationsApi.copy(selectedEvaluation.id, `${selectedEvaluation.name} (${t('copy')})`);

      const newEvaluations = [newEval as EvaluationWithRelations, ...evaluations];
      updateListCache({ evaluations: newEvaluations });
      setEvaluations(newEvaluations);
      setListMode('mine');
      selectEvaluation(newEval as EvaluationWithRelations);

      showToast('success', t('evaluationCopied'));
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('copyEvaluationFailed'));
    } finally {
      setSubmittingNewVersion(false);
    }
  };

  const handleCopyEvaluationShareLink = async (evaluationId: string) => {
    try {
      const url = new URL('/evaluation', window.location.origin);
      url.searchParams.set('evaluationId', evaluationId);
      await navigator.clipboard.writeText(url.toString());
      showToast('success', tCommon('linkCopied'));
    } catch {
      showToast('error', tCommon('error'));
    }
  };

  const handleUpdateEvaluation = async (field: string, value: string | null) => {
    if (!selectedEvaluation) return;

    const updated = { ...selectedEvaluation, [field]: value } as EvaluationWithRelations;
    setSelectedEvaluation(updated);
    setEvaluations((prev) => {
      const next = prev.map((e) => (e.id === selectedEvaluation.id ? updated : e));
      updateListCache({ evaluations: next });
      return next;
    });

    // 立即保存到数据库
    try {
      await evaluationsApi.update(selectedEvaluation.id, { [field]: value });
    } catch (e) {
      console.error('Failed to save evaluation:', e);
      showToast('error', t('updateFailed'));
    }
  };

  const handleUpdateConfig = async <K extends keyof EvaluationConfig>(key: K, value: EvaluationConfig[K]) => {
    if (!selectedEvaluation) return;

    const newConfig: EvaluationConfig = { ...selectedEvaluation.config, [key]: value };
    if (value === undefined) {
      delete (newConfig as Record<string, unknown>)[key as string];
    }

    const updated = { ...selectedEvaluation, config: newConfig } as EvaluationWithRelations;
    setSelectedEvaluation(updated);
    setEvaluations((prev) => {
      const next = prev.map((e) => (e.id === selectedEvaluation.id ? updated : e));
      updateListCache({ evaluations: next });
      return next;
    });

    // 立即保存到数据库
    try {
      await evaluationsApi.update(selectedEvaluation.id, { config: newConfig });
    } catch (e) {
      console.error('Failed to save evaluation config:', e);
      showToast('error', t('updateFailed'));
    }
  };

  // 处理模型参数变更
  const handleModelParametersChange = async (newConfig: PromptConfig) => {
    setEvalModelConfig(newConfig);
    const modelParams: ModelParameters = {
      temperature: newConfig.temperature,
      top_p: newConfig.top_p,
      frequency_penalty: newConfig.frequency_penalty,
      presence_penalty: newConfig.presence_penalty,
      max_tokens: newConfig.max_tokens,
    };
    await handleUpdateConfig('model_parameters', modelParams);
    await handleUpdateConfig('inherited_from_prompt', false);
  };

  // 处理关联 Prompt 变更时继承参数
  const handlePromptChange = async (promptId: string | null) => {
    await handleUpdateEvaluation('promptId', promptId);

    if (promptId) {
      const prompt = await ensurePromptDetail(promptId);
      if (prompt?.config) {
        const newConfig = buildPromptConfigWithDefaults(prompt.config);
        setEvalModelConfig(newConfig);
        const modelParams = buildModelParamsFromPrompt(prompt.config);
        await handleUpdateConfig('model_parameters', modelParams);
        await handleUpdateConfig('inherited_from_prompt', true);
      }
    }
  };

  const startEditingName = () => {
    if (selectedEvaluation) {
      setEditingName(selectedEvaluation.name);
      setIsEditingName(true);
    }
  };

  const cancelEditingName = () => {
    setIsEditingName(false);
    setEditingName('');
  };

  const saveEvaluationName = async () => {
    if (!selectedEvaluation || !editingName.trim()) {
      showToast('error', t('nameCannotBeEmpty'));
      return;
    }

    await handleUpdateEvaluation('name', editingName.trim());
    setIsEditingName(false);
    setEditingName('');
  };

  const selectedPrompt = prompts.find((p) => p.id === selectedEvaluation?.promptId);
  const publishModalEvaluation = useMemo(() => {
    if (!publishModal) return null;
    if (selectedEvaluation?.id === publishModal.evaluationId) return selectedEvaluation;
    return evaluations.find((e) => e.id === publishModal.evaluationId) ?? null;
  }, [publishModal, selectedEvaluation, evaluations]);
  const publishModalPromptId = publishModalEvaluation?.promptId ?? null;
  const publishModalLinkedPrompt = useMemo(() => {
    if (!publishModalPromptId) return null;
    return prompts.find((p) => p.id === publishModalPromptId) ?? null;
  }, [publishModalPromptId, prompts]);
  const publishModalShareUrl = useMemo(() => {
    if (!publishModal) return '';
    const url = new URL('/evaluation', window.location.origin);
    url.searchParams.set('evaluationId', publishModal.evaluationId);
    return url.toString();
  }, [publishModal]);
  const publishModalHasAttachments = useMemo(() => {
    if (!publishModalEvaluation) return false;
    const cases =
      publishModalEvaluation.testCases ??
      (selectedEvaluation?.id === publishModalEvaluation.id ? testCases : null);
    return !!cases?.some((tc) => (tc.attachments?.length ?? 0) > 0);
  }, [publishModalEvaluation, selectedEvaluation?.id, testCases]);
  const promptVariables = (selectedPrompt?.variables as PromptVariable[] | undefined)?.map((v) => v.name) || [];
  const selectedRunConfig = selectedRun?.runConfig as RunConfig | null;
  const selectedRunOcrProvider =
    selectedRunConfig?.ocrProviderResolved ??
    selectedRunConfig?.ocrProvider ??
    selectedEvaluation?.config.ocr_provider ??
    null;

  const resultsMetrics = useMemo(() => {
    const totalCount = results.length;
    const passed = results.filter((result) => result.passed).length;
    const failed = totalCount - passed;
    const passRate = totalCount > 0 ? (passed / totalCount) * 100 : 0;
    const tokensInput = results.reduce((sum, result) => sum + result.tokensInput, 0);
    const tokensOutput = results.reduce((sum, result) => sum + result.tokensOutput, 0);
    const llmMs = results.reduce((sum, result) => sum + (result.latencyMs || 0), 0);
    const ocrMs = results.reduce((sum, result) => sum + (result.ocrLatencyMs || 0), 0);
    return {
      totalCount,
      passed,
      failed,
      passRate,
      tokensInput,
      tokensOutput,
      llmMs,
      ocrMs,
      totalMs: llmMs + ocrMs,
    };
  }, [results]);

  const openPublishModal = () => {
    if (!selectedEvaluation || selectedEvaluation.isPublic) return;
    setPublishShareAttachments(!!selectedEvaluation.shareAttachments);
    setPublishModal({ evaluationId: selectedEvaluation.id, step: 'confirm' });
  };

  const closePublishModal = () => {
    if (publishing) return;
    setPublishModal(null);
    setPublishShareAttachments(false);
  };

  const handleConfirmPublishEvaluation = async () => {
    if (!publishModalEvaluation || publishModalEvaluation.isPublic) return;

    const linkedPrompt = publishModalLinkedPrompt;
    const needsPromptPublish = !!linkedPrompt && !linkedPrompt.isPublic;
    const canPublishPrompt =
      !needsPromptPublish || (linkedPrompt?.userId && linkedPrompt.userId === currentUserId);

    if (needsPromptPublish && !canPublishPrompt) {
      showToast('error', t('promptMustBePublicFirst'));
      return;
    }

    setPublishing(true);
    try {
      const shouldShareAttachments = publishModalHasAttachments && publishShareAttachments;

      if (needsPromptPublish && linkedPrompt) {
        await promptsApi.update(linkedPrompt.id, { isPublic: true });
        setPrompts((prev) => prev.map((p) => (p.id === linkedPrompt.id ? { ...p, isPublic: true } : p)));
      }

      await evaluationsApi.update(publishModalEvaluation.id, {
        isPublic: true,
        shareAttachments: shouldShareAttachments,
      });

      setSelectedEvaluation((prev) => (
        prev && prev.id === publishModalEvaluation.id
          ? { ...prev, isPublic: true, shareAttachments: shouldShareAttachments }
          : prev
      ));
      setEvaluations((prev) => {
        const next = prev.map((e) =>
          e.id === publishModalEvaluation.id
            ? { ...e, isPublic: true, shareAttachments: shouldShareAttachments }
            : e
        );
        updateListCache({ evaluations: next });
        return next;
      });

      showToast('success', t('evaluationPublic'));
      setPublishModal((prev) => (
        prev && prev.evaluationId === publishModalEvaluation.id ? { ...prev, step: 'done' } : prev
      ));
    } catch (error) {
      console.error('Failed to publish evaluation:', error);
      showToast('error', t('updateFailed'));
    } finally {
      setPublishing(false);
    }
  };

  const handleSetEvaluationPrivate = async () => {
    if (!selectedEvaluation || !selectedEvaluation.isPublic) return;
    try {
      await evaluationsApi.update(selectedEvaluation.id, { isPublic: false });
      setSelectedEvaluation({ ...selectedEvaluation, isPublic: false, shareAttachments: false });
      setEvaluations((prev) => {
        const next = prev.map((e) =>
          e.id === selectedEvaluation.id ? { ...e, isPublic: false, shareAttachments: false } : e
        );
        updateListCache({ evaluations: next });
        return next;
      });
      showToast('success', t('evaluationPrivate'));
    } catch (error) {
      console.error('Failed to set evaluation private:', error);
      showToast('error', t('updateFailed'));
    }
  };

  return (
    <div className="h-full flex overflow-hidden bg-slate-950 light:bg-slate-50">
      <div className="w-80 bg-slate-900/50 light:bg-white border-r border-slate-700 light:border-slate-200 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-700 light:border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => {
                setListMode('mine');
                if (!currentUserId) return;
                if (!selectedEvaluation || selectedEvaluation.userId !== currentUserId) {
                  const firstMine = evaluations.find((e) => e.userId === currentUserId) || null;
                  selectEvaluation(firstMine);
                }
              }}
              className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                listMode === 'mine'
                  ? 'bg-slate-800 text-slate-100 border-slate-600 light:bg-cyan-50 light:text-cyan-700 light:border-cyan-200'
                  : 'bg-transparent text-slate-400 border-slate-700 hover:bg-slate-800/50 light:text-slate-600 light:border-slate-200 light:hover:bg-slate-100'
              }`}
            >
              {t('myEvaluations')}
            </button>
            <button
              type="button"
              onClick={() => {
                setListMode('public');
                if (!currentUserId) return;
                if (!selectedEvaluation || selectedEvaluation.userId === currentUserId) {
                  const firstPublic = evaluations.find((e) => e.isPublic && e.userId !== currentUserId) || null;
                  selectEvaluation(firstPublic);
                }
              }}
              className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                listMode === 'public'
                  ? 'bg-slate-800 text-slate-100 border-slate-600 light:bg-cyan-50 light:text-cyan-700 light:border-cyan-200'
                  : 'bg-transparent text-slate-400 border-slate-700 hover:bg-slate-800/50 light:text-slate-600 light:border-slate-200 light:hover:bg-slate-100'
              }`}
            >
              {t('publicLibrary')}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 light:text-slate-400" />
              <input
                type="text"
                value={evaluationQuery}
                onChange={(e) => setEvaluationQuery(e.target.value)}
                placeholder={t('searchEvaluations')}
                aria-label={t('searchEvaluations')}
                className="w-full pl-7 pr-2 py-1.5 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-md text-xs text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <select
              value={evaluationStatusFilter}
              onChange={(e) => setEvaluationStatusFilter(e.target.value as EvaluationStatus | 'all')}
              aria-label={t('status')}
              className="shrink-0 px-2 py-1.5 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-md text-xs text-slate-200 light:text-slate-800 focus:outline-none focus:border-cyan-500"
            >
              <option value="all">{tCommon('all')}</option>
              <option value="pending">{t('pending')}</option>
              <option value="running">{t('running')}</option>
              <option value="completed">{t('completed')}</option>
              <option value="failed">{t('failed')}</option>
            </select>
            <Button size="sm" className="shrink-0" onClick={() => setShowNewEval(true)}>
              <Plus className="w-4 h-4" />
              <span>{t('newEvaluation')}</span>
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {listLoading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="p-3 rounded-lg border border-slate-700 light:border-slate-200 animate-pulse">
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 bg-slate-700 light:bg-slate-200 rounded mt-0.5" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-3/4 bg-slate-700 light:bg-slate-200 rounded" />
                      <div className="h-5 w-16 bg-slate-700 light:bg-slate-200 rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
          <>
          {filteredEvaluations.map((evaluation) => {
            const status = statusConfig[evaluation.status];
            return (
              <button
                key={evaluation.id}
                onClick={() => selectEvaluation(evaluation)}
                draggable={canDragEvaluation(evaluation)}
                onDragStart={(event) => {
                  if (!canDragEvaluation(evaluation)) return;
                  event.dataTransfer.effectAllowed = 'move';
                  handleEvaluationDragStart(evaluation);
                }}
                onDragOver={(event) => handleEvaluationDragOver(event, evaluation)}
                onDragEnd={handleEvaluationDragEnd}
                className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors ${
                  selectedEvaluation?.id === evaluation.id
                    ? 'bg-slate-800 light:bg-cyan-50 border border-slate-600 light:border-cyan-200'
                    : 'hover:bg-slate-800/50 light:hover:bg-slate-100'
                } ${canDragEvaluation(evaluation) ? 'cursor-move' : ''} ${draggedEvaluationId === evaluation.id ? 'opacity-50' : ''}`}
              >
                <BarChart3 className="w-5 h-5 text-slate-500 light:text-slate-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">
                    {evaluation.name}
                  </p>
                   <div className="flex items-center gap-2 mt-1">
                     <Badge variant={status.variant}>{t(status.labelKey)}</Badge>
                     {listMode === 'mine' ? (
                       <Badge variant={evaluation.isPublic ? 'success' : 'info'}>
                         {evaluation.isPublic ? t('public') : t('private')}
                       </Badge>
                     ) : (
                       <Badge variant="info">{t('template')}</Badge>
                     )}
                   </div>
                 </div>
               </button>
             );
          })}
          {filteredEvaluations.length === 0 && !listLoading && (
            <div className="text-center py-8 text-slate-500 light:text-slate-400 text-sm">
              {hasEvaluationFilter ? t('noMatchingEvaluations') : t('noEvaluations')}
            </div>
          )}
          </>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedEvaluation ? (
          <>
            {/* Header - fixed */}
            <div className="flex-shrink-0 p-6 pb-0 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  {isEditingName && isSelectedEvaluationOwner ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEvaluationName();
                          if (e.key === 'Escape') cancelEditingName();
                        }}
                        className="max-w-md"
                        autoFocus
                      />
                      <Button size="sm" onClick={saveEvaluationName}>
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={cancelEditingName}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold text-white light:text-slate-900">
                        {selectedEvaluation.name}
                      </h2>
                      {isSelectedEvaluationOwner ? (
                        <>
                          <button
                            onClick={startEditingName}
                            className="p-1 hover:bg-slate-700 light:hover:bg-slate-200 rounded transition-colors"
                          >
                            <Pencil className="w-4 h-4 text-slate-400 light:text-slate-500" />
                          </button>
                          <button
                            onClick={() => {
                              if (!selectedEvaluation.isPublic) {
                                openPublishModal();
                                return;
                              }
                              void handleSetEvaluationPrivate();
                            }}
                            disabled={submittingNewVersion || publishing}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                              selectedEvaluation.isPublic
                                ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                : 'bg-slate-700 text-slate-400 hover:bg-slate-600 light:bg-slate-200 light:text-slate-500 light:hover:bg-slate-300'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                            title={selectedEvaluation.isPublic ? t('clickToPrivate') : t('clickToPublic')}
                          >
                            <Globe className="w-3 h-3" />
                            {selectedEvaluation.isPublic ? t('public') : t('private')}
                          </button>
                        </>
                      ) : (
                        <Badge variant={selectedEvaluation.isPublic ? 'success' : 'info'}>
                          {selectedEvaluation.isPublic ? t('public') : t('private')}
                        </Badge>
                      )}
                    </div>
                  )}
                  <p className="text-sm text-slate-500 light:text-slate-400 mt-1">
                    {t('createdAt')} {formatDateTime(selectedEvaluation.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isSelectedEvaluationOwner ? (
                    <Button onClick={runEvaluation} disabled={submittingNewVersion}>
                      {runningCount > 0 ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                      <span>{t('runEvaluation')}</span>
                      {runningCount > 0 && (
                        <span className="ml-1 px-1.5 py-0.5 text-xs bg-cyan-500/20 text-cyan-400 rounded">
                          {runningCount}
                        </span>
                      )}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => void handleCopyEvaluation()}
                      loading={submittingNewVersion}
                    >
                      <Copy className="w-4 h-4" />
                      <span>{t('useTemplate')}</span>
                    </Button>
                  )}

                  {selectedEvaluation.isPublic && (
                    <Button
                      variant="ghost"
                      onClick={() => void handleCopyEvaluationShareLink(selectedEvaluation.id)}
                      disabled={submittingNewVersion}
                    >
                      <Link className="w-4 h-4" />
                      <span>{tCommon('shareLink')}</span>
                    </Button>
                  )}

                  {isSelectedEvaluationOwner && (
                    <Button
                      variant="secondary"
                      onClick={handleCopyEvaluation}
                      loading={submittingNewVersion}
                    >
                      <Copy className="w-4 h-4" />
                      <span>{tCommon('copy')}</span>
                    </Button>
                  )}
                  {isSelectedEvaluationOwner && (
                    <Button variant="ghost" onClick={handleDeleteEvaluation} disabled={submittingNewVersion}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-5 gap-4">
                <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-2">{t('linkedPrompt')}</p>
                  <PromptCascader
                    value={selectedEvaluation.promptId || null}
                    onChange={(promptId) => void handlePromptChange(promptId)}
                    prompts={prompts}
                    groups={promptGroups}
                    disabled={!isSelectedEvaluationOwner}
                    allowClear
                    clearLabel={t('noLinkedPrompt')}
                  />
                  {selectedPrompt && (
                    <p className="text-xs text-cyan-400 light:text-cyan-600 mt-2">
                      {t('currentVersion')}: v{selectedPrompt.currentVersion}
                    </p>
                  )}
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-slate-500 light:text-slate-600">{t('targetModel')}</p>
                    <button
                      onClick={() => setShowParamsModal(true)}
                      className="p-1 text-slate-400 hover:text-cyan-400 light:text-slate-500 light:hover:text-cyan-600 transition-colors rounded hover:bg-slate-700/50 light:hover:bg-slate-100"
                      title={t('modelParameters')}
                    >
                      <Settings2 className="w-4 h-4" />
                    </button>
                  </div>
                  <ModelSelector
                    models={models}
                    providers={providers}
                    selectedModelId={selectedEvaluation.modelId || ''}
                    onSelect={(modelId) => handleUpdateEvaluation('modelId', modelId || null)}
                    disabled={!isSelectedEvaluationOwner}
                    placeholder={t('selectModel')}
                  />
                  {selectedEvaluation.model && (
                    <p className="text-xs text-slate-500 light:text-slate-600 mt-2">
                      {t('reproducibleModel')}: {selectedEvaluation.model.provider?.type ? `${selectedEvaluation.model.provider.type}/` : ''}{selectedEvaluation.model.modelId}
                    </p>
                  )}
                  {selectedEvaluation.config?.model_parameters && (
                    <p className="text-xs text-slate-500 light:text-slate-600 mt-1">
                      {t('modelParameters')}:&nbsp;
                      {selectedEvaluation.config.model_parameters.temperature !== undefined ? `T:${selectedEvaluation.config.model_parameters.temperature} ` : ''}
                      {selectedEvaluation.config.model_parameters.max_tokens !== undefined ? `Max:${selectedEvaluation.config.model_parameters.max_tokens} ` : ''}
                      {selectedEvaluation.config.model_parameters.top_p !== undefined ? `P:${selectedEvaluation.config.model_parameters.top_p} ` : ''}
                    </p>
                  )}
                  {selectedEvaluation.config.inherited_from_prompt && (
                    <p className="text-xs text-cyan-400 light:text-cyan-600 mt-1">
                      {t('inheritedFromPrompt')}
                    </p>
                  )}
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-2">{t('judgeModel')}</p>
                  <ModelSelector
                    models={models}
                    providers={providers}
                    selectedModelId={selectedEvaluation.judgeModelId || ''}
                    onSelect={(modelId) => handleUpdateEvaluation('judgeModelId', modelId || null)}
                    disabled={!isSelectedEvaluationOwner}
                    placeholder={t('noJudgeModel')}
                  />
                  {selectedEvaluation.judgeModel && (
                    <p className="text-xs text-slate-500 light:text-slate-600 mt-2">
                      {t('reproducibleJudgeModel')}: {selectedEvaluation.judgeModel.provider?.type ? `${selectedEvaluation.judgeModel.provider.type}/` : ''}{selectedEvaluation.judgeModel.modelId}
                    </p>
                  )}
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-2">{t('passThreshold')}</p>
                  <Select
                    value={String((selectedEvaluation.config.pass_threshold || 0.6) * 10)}
                    onChange={(e) => handleUpdateConfig('pass_threshold', Number(e.target.value) / 10)}
                    options={[
                      { value: '10', label: t('threshold10') },
                      { value: '9', label: t('threshold9') },
                      { value: '8', label: t('threshold8') },
                      { value: '7', label: t('threshold7') },
                      { value: '6', label: t('threshold6') },
                      { value: '5', label: t('threshold5') },
                      { value: '4', label: t('threshold4') },
                      { value: '3', label: t('threshold3') },
                      { value: '0', label: t('threshold0') },
                    ]}
                  />
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-2">{t('fileProcessing')}</p>
                  <Select
                    value={selectedEvaluation.config.file_processing || 'auto'}
                    onChange={(e) => handleUpdateConfig('file_processing', e.target.value as EvaluationConfig['file_processing'])}
                    options={[
                      { value: 'auto', label: t('fileProcessingAuto') },
                      ...(currentModelInfo.supportsVision ? [{ value: 'vision', label: t('fileProcessingVision') }] : []),
                      { value: 'ocr', label: t('fileProcessingOcr') },
                      { value: 'none', label: t('fileProcessingNone') },
                    ]}
                  />
                  {(selectedEvaluation.config.file_processing === 'ocr' ||
                    ((selectedEvaluation.config.file_processing || 'auto') === 'auto' && !currentModelInfo.supportsVision)) && (
                    <div className="mt-2">
                      <Select
                        value={selectedEvaluation.config.ocr_provider || ''}
                        onChange={(e) => handleUpdateConfig('ocr_provider', (e.target.value ? (e.target.value as EvaluationConfig['ocr_provider']) : undefined))}
                        options={[
                          { value: '', label: t('ocrProviderFollow') },
                          { value: 'paddle', label: 'PaddleOCR' },
                          { value: 'paddle_vl', label: t('ocrProviderPaddleVl') },
                          { value: 'paddle_vl_1_5', label: t('ocrProviderPaddleVl15') },
                          { value: 'datalab', label: t('ocrProviderDatalab') },
                          { value: 'mineru', label: t('ocrProviderMineru') },
                        ]}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="border-b border-slate-700 light:border-slate-200">
                <nav className="flex gap-4">
                  <button
                    onClick={() => setActiveTab('testcases')}
                    className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                      activeTab === 'testcases'
                        ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
                        : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
                    }`}
                  >
                    <FileText className="w-4 h-4" />
                    {t('testCasesCount', { count: testCases.length })}
                  </button>
                  <button
                    onClick={() => setActiveTab('criteria')}
                    className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                      activeTab === 'criteria'
                        ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
                        : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
                    }`}
                  >
                    <Settings2 className="w-4 h-4" />
                    {t('criteriaCount', { count: criteria.filter((c) => c.enabled).length })}
                  </button>
                  <button
                    onClick={() => setActiveTab('history')}
                    className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                      activeTab === 'history'
                        ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
                        : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
                    }`}
                  >
                    <History className="w-4 h-4" />
                    {t('executionHistory')}
                  </button>
                  <button
                    onClick={() => setActiveTab('results')}
                    className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                      activeTab === 'results'
                        ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
                        : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
                    }`}
                  >
                    <BarChart3 className="w-4 h-4" />
                    {t('results')}
                  </button>
                </nav>
              </div>
            </div>

            {/* Content - scrollable */}
            <div className="flex-1 overflow-y-auto p-6 pt-4 flex flex-col min-h-0">
              {detailsLoading ? (
                <div className="space-y-6">
                  {/* Loading indicator at top */}
                  <div className="flex items-center justify-center gap-2 text-sm text-slate-400 light:text-slate-500 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('loadingDetails')}</span>
                  </div>
                  {/* Skeleton loading */}
                  <div className="animate-pulse space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="h-4 w-32 bg-slate-700 light:bg-slate-200 rounded" />
                      <div className="h-4 w-20 bg-slate-700 light:bg-slate-200 rounded" />
                    </div>
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="p-4 border border-slate-700 light:border-slate-200 rounded-lg space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="h-6 w-6 bg-slate-700 light:bg-slate-200 rounded-full" />
                          <div className="h-4 w-40 bg-slate-700 light:bg-slate-200 rounded" />
                        </div>
                        <div className="h-20 bg-slate-700/50 light:bg-slate-100 rounded" />
                        <div className="flex gap-2">
                          <div className="h-3 w-16 bg-slate-700 light:bg-slate-200 rounded" />
                          <div className="h-3 w-24 bg-slate-700 light:bg-slate-200 rounded" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
              <div className="flex-1 min-h-0 flex flex-col">
                {activeTab === 'testcases' && (
                  <div className="flex-1 min-h-0">
                    <TestCaseList
                      testCases={testCases}
                      variables={promptVariables}
                      onAdd={handleAddTestCase}
                      onUpdate={handleUpdateTestCase}
                      onDelete={handleDeleteTestCase}
                      onCopy={handleCopyTestCase}
                      onDeleteSelected={handleDeleteSelectedTestCases}
                      onRunSelected={runEvaluation}
                      runningTestCaseId={runningTestCaseId}
                      selectedTestCaseIds={selectedTestCaseIds}
                      onToggleSelect={toggleTestCaseSelected}
                      onSetSelectedIds={(ids) => setSelectedTestCaseIds(new Set(ids))}
                      fileUploadCapabilities={fileUploadCapabilities}
                      readOnly={!isSelectedEvaluationOwner}
                      downloadAttachmentBlob={downloadAttachmentBlob}
                    />
                  </div>
                )}

                {activeTab === 'criteria' && (
                  <CriteriaEditor
                    criteria={criteria}
                    onAdd={handleAddCriterion}
                    onUpdate={handleUpdateCriterion}
                    onDelete={handleDeleteCriterion}
                    readOnly={!isSelectedEvaluationOwner}
                  />
                )}

                {activeTab === 'history' && (
                  <RunHistory
                    runs={runs}
                    selectedRunId={selectedRun?.id || null}
                    onSelectRun={handleSelectRun}
                    onDeleteRun={isSelectedEvaluationOwner ? handleDeleteRun : undefined}
                    onAbortRun={isSelectedEvaluationOwner ? handleAbortRun : undefined}
                    onBatchExport={isSelectedEvaluationOwner ? handleBatchExportExecutionRecords : undefined}
                    batchExporting={batchExporting}
                  />
                )}

                {activeTab === 'results' && (
                  results.length > 0 && selectedRun ? (
                    <div className="flex-1 min-h-0 flex flex-col gap-4">
                      <div className="flex flex-wrap lg:flex-nowrap items-center gap-3 p-3 bg-slate-800/30 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-sm text-slate-400 light:text-slate-600">{t('currentViewing')}</span>
                          <Badge variant={statusConfig[selectedRun.status].variant}>
                            {formatDateTime(selectedRun.startedAt)}
                          </Badge>
                          {/* 紧凑的模型参数标签 */}
                          {selectedRun.modelParameters && (
                            <div className="flex items-center gap-1.5 text-xs text-slate-500 light:text-slate-500">
                              <Settings2 className="w-3 h-3" />
                              <span>T:{selectedRun.modelParameters.temperature}</span>
                              <span>•</span>
                              <span>Max:{selectedRun.modelParameters.max_tokens}</span>
                              {selectedRun.modelParameters.top_p !== undefined && (
                                <>
                                  <span>•</span>
                                  <span>P:{selectedRun.modelParameters.top_p}</span>
                                </>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="hidden lg:block w-px h-7 bg-slate-700/60 light:bg-slate-300/80" />

                        <div className="flex-1 flex justify-center">
                          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
                          <div className="flex items-baseline gap-1">
                            <span className="text-base font-semibold text-emerald-400 light:text-emerald-600">
                              {resultsMetrics.passed}
                            </span>
                            <span className="text-xs text-slate-500 light:text-slate-600">{t('passed')}</span>
                          </div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-base font-semibold text-rose-400 light:text-rose-600">
                              {resultsMetrics.failed}
                            </span>
                            <span className="text-xs text-slate-500 light:text-slate-600">{t('failed')}</span>
                          </div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-base font-semibold text-cyan-400 light:text-cyan-600">
                              {resultsMetrics.passRate.toFixed(0)}%
                            </span>
                            <span className="text-xs text-slate-500 light:text-slate-600">{t('passRate')}</span>
                          </div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-base font-semibold text-teal-400 light:text-teal-600">
                              {resultsMetrics.tokensInput.toLocaleString()}
                            </span>
                            <span className="text-xs text-slate-500 light:text-slate-600">{t('inputTokens')}</span>
                          </div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-base font-semibold text-sky-400 light:text-sky-600">
                              {resultsMetrics.tokensOutput.toLocaleString()}
                            </span>
                            <span className="text-xs text-slate-500 light:text-slate-600">{t('outputTokens')}</span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-baseline gap-1">
                              <span className="text-base font-semibold text-amber-400 light:text-amber-600">
                                {formatMsAsSeconds(resultsMetrics.totalMs)}
                              </span>
                              <span className="text-xs text-slate-500 light:text-slate-600">{t('totalTime')}</span>
                            </div>
                            <div className="text-[10px] leading-tight text-slate-500 light:text-slate-600">
                              {t('llmCumulative')}: {formatMsAsSeconds(resultsMetrics.llmMs)} | {t('ocrCumulative')}: {formatMsAsSeconds(resultsMetrics.ocrMs)}
                            </div>
                          </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {isSelectedEvaluationOwner && selectedEvaluation.judgeModelId && criteria.some((c) => c.enabled) && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={handleRetryAllScores}
                              loading={retryingAllScores}
                              disabled={retryingOutputTestCaseId !== null || retryingAiEvaluationTestCaseId !== null}
                            >
                              <Scale className="w-4 h-4" />
                              <span>{t('retryScores')}</span>
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleExportExecutionRecord}
                            loading={exporting}
                          >
                            <Download className="w-4 h-4" />
                            <span>{tCommon('export')}</span>
                          </Button>
                          {runs.length > 1 && (
                            <button
                              onClick={() => setActiveTab('history')}
                              className="text-xs text-cyan-400 light:text-cyan-600 hover:text-cyan-300 light:hover:text-cyan-700 flex items-center gap-1"
                            >
                              <History className="w-3 h-3" />
                              {t('viewOtherRecords')}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-h-0">
                        <EvaluationResultsView
                          testCases={testCases}
                          results={results}
                          criteria={criteria}
                          ocrProvider={selectedRunOcrProvider}
                          downloadAttachmentBlob={downloadAttachmentBlob}
                          canViewOcrResults={isSelectedEvaluationOwner}
                          onRetryOutput={isSelectedEvaluationOwner ? handleRetryOutput : undefined}
                          onRunAiEvaluation={isSelectedEvaluationOwner && selectedEvaluation.judgeModelId && criteria.some((c) => c.enabled) ? handleRunAiEvaluation : undefined}
                          onAbortRetryOutput={isSelectedEvaluationOwner ? handleAbortRetryOutput : undefined}
                          onAbortAiEvaluation={isSelectedEvaluationOwner ? handleAbortAiEvaluation : undefined}
                          retryingOutputTestCaseId={retryingOutputTestCaseId}
                          retryingAiEvaluationTestCaseId={retryingAiEvaluationTestCaseId}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-12 text-slate-500 light:text-slate-600">
                      <div className="text-center">
                        <AlertCircle className="w-12 h-12 mx-auto mb-3 text-slate-600 light:text-slate-400" />
                        <p>{t('noResultsYet')}</p>
                        <p className="text-xs mt-1">{t('addTestCasesAndRun')}</p>
                      </div>
                    </div>
                  )
                )}
              </div>
              )}
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <BarChart3 className="w-16 h-16 mx-auto mb-4 text-slate-700 light:text-slate-400" />
              <p className="text-slate-500 light:text-slate-600">{t('selectEvaluationToView')}</p>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={publishModal !== null} onClose={closePublishModal} title={t('publishEvaluation')} size="md">
        {publishModal && publishModal.step === 'confirm' && (
          <div className="space-y-4">
            {!publishModalEvaluation ? (
              <div className="text-sm text-slate-500 light:text-slate-600">{tCommon('loading')}</div>
            ) : (
              <>
                <div>
                  <p className="text-sm text-slate-200 light:text-slate-800">{t('publishEvaluationIntro')}</p>
                  <p className="mt-2 text-xs text-slate-500 light:text-slate-600">{t('publishEvaluationVisibleTitle')}</p>
                  <ul className="mt-2 space-y-1 text-sm text-slate-300 light:text-slate-700 list-disc pl-5">
                    <li>{t('publishEvaluationVisibleItemMeta')}</li>
                    <li>{t('publishEvaluationVisibleItemCases')}</li>
                    <li>{t('publishEvaluationVisibleItemCriteria')}</li>
                    <li>{t('publishEvaluationVisibleItemConfig')}</li>
                  </ul>
                  <p className="mt-2 text-xs text-slate-500 light:text-slate-600">{t('publishEvaluationAttachmentsHint')}</p>
                </div>

                <div className="p-3 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-slate-50">
                  <label
                    className={`flex items-start gap-2 select-none ${
                      publishModalHasAttachments ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={publishModalHasAttachments ? publishShareAttachments : false}
                      disabled={!publishModalHasAttachments}
                      onChange={(e) => setPublishShareAttachments(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900"
                    />
                    <div className="space-y-1">
                      <p className="text-sm text-slate-200 light:text-slate-800">{t('publishEvaluationShareAttachments')}</p>
                      <p className="text-xs text-slate-500 light:text-slate-600">{t('publishEvaluationShareAttachmentsHint')}</p>
                    </div>
                  </label>
                </div>

                <div className="p-3 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-slate-50">
                  <p className="text-xs text-slate-500 light:text-slate-600">{t('evaluationName')}</p>
                  <p className="text-sm text-slate-200 light:text-slate-900 mt-1">{publishModalEvaluation.name}</p>
                </div>

                {publishModalLinkedPrompt && !publishModalLinkedPrompt.isPublic && (
                  <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-amber-300">{t('publishEvaluationPromptGateTitle')}</p>
                        <p className="text-xs text-slate-300 light:text-slate-700">
                          {t('publishEvaluationPromptGateDesc', { name: publishModalLinkedPrompt.name })}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-700 light:border-slate-200">
                  <Button variant="ghost" onClick={closePublishModal}>
                    {tCommon('cancel')}
                  </Button>
                  <Button onClick={() => void handleConfirmPublishEvaluation()} loading={publishing}>
                    {publishModalLinkedPrompt && !publishModalLinkedPrompt.isPublic
                      ? t('publishEvaluationWithPrompt')
                      : t('publishNow')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {publishModal && publishModal.step === 'done' && (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-200 light:text-slate-800">{t('publishEvaluationDone')}</p>
              <p className="text-xs text-slate-500 light:text-slate-600 mt-1">{t('publishEvaluationDoneHint')}</p>
            </div>
            <Input
              label={tCommon('shareLink')}
              value={publishModalShareUrl}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-700 light:border-slate-200">
              <Button variant="secondary" onClick={() => void handleCopyEvaluationShareLink(publishModal.evaluationId)}>
                <Link className="w-4 h-4" />
                <span>{tCommon('copy')}</span>
              </Button>
              <Button onClick={closePublishModal}>{tCommon('close')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={showNewEval} onClose={() => setShowNewEval(false)} title={t('newEvaluation')}>
        <div className="space-y-4">
          <Input
            label={t('evaluationName')}
            value={newEvalName}
            onChange={(e) => setNewEvalName(e.target.value)}
            placeholder={t('evaluationNamePlaceholder')}
            autoFocus
          />
          <PromptCascader
            label={t('linkedPromptOptional')}
            value={newEvalPrompt || null}
            onChange={(promptId) => setNewEvalPrompt(promptId || '')}
            prompts={prompts}
            groups={promptGroups}
            allowClear
            clearLabel={t('noLinkedPrompt')}
          />
          <div>
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-1.5">
              {t('targetModel')}
            </label>
            <ModelSelector
              models={models}
              providers={providers}
              selectedModelId={newEvalModel}
              onSelect={setNewEvalModel}
              placeholder={t('selectModel')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-1.5">
              {t('judgeModel')}
            </label>
            <ModelSelector
              models={models}
              providers={providers}
              selectedModelId={newEvalJudgeModel}
              onSelect={setNewEvalJudgeModel}
              placeholder={t('noJudgeModel')}
            />
          </div>
          <p className="text-xs text-slate-500 light:text-slate-600">
            {tCommon('judgeModelDescription')}
          </p>
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-700 light:border-slate-200">
            <Button variant="ghost" onClick={() => setShowNewEval(false)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleCreateEvaluation} disabled={!newEvalName.trim()}>
              {tCommon('create')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 模型参数配置 Modal */}
      <Modal isOpen={showParamsModal} onClose={() => setShowParamsModal(false)} title={t('modelParameters')}>
        <div className="space-y-4">
          <ParameterPanel
            config={evalModelConfig}
            onChange={handleModelParametersChange}
            disabled={!isSelectedEvaluationOwner}
            modelId={models.find(m => m.id === selectedEvaluation?.modelId)?.modelId}
            supportsReasoning={models.find(m => m.id === selectedEvaluation?.modelId)?.supportsReasoning}
            defaultOpen={true}
          />
          <div className="flex justify-end pt-4 border-t border-slate-700 light:border-slate-200">
            <Button onClick={() => setShowParamsModal(false)}>
              {tCommon('confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
