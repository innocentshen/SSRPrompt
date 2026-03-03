import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  Wand2,
  Check,
  Copy,
  X,
  Loader2,
  AlertCircle,
  ArrowRight,
  Trophy,
  Star,
  TrendingUp,
  Maximize2,
  Minimize2,
  ChevronDown,
  Database,
  BarChart3,
  FlaskConical,
  Paperclip,
  Plus,
  Trash2,
} from 'lucide-react';
import type { PromptMessage } from '../../types/database';
import { Button, ModelSelector, Badge, Modal, StopIndicator, OutputRenderer } from '../ui';
import { AttachmentModal } from './AttachmentModal';
import type { Model, Provider, FileAttachment, OcrProvider } from '../../types';
import {
  BUILTIN_META_PROMPTS,
  saveOptimizationSettings,
  getOptimizationSettings,
} from '../../lib/optimization-settings';
import {
  getPromptOptimizerPreference,
  savePromptOptimizerPreference,
} from '../../lib/prompt-optimizer-preferences';
import type {
  EvaluationSummary,
  EvaluationListItem,
  EvaluationCriterion,
  EvaluationConfig,
} from '@ssrprompt/shared';
import type { ChatMessage, ContentPart } from '../../api/chat';
import { chatApi } from '../../api/chat';
import { evaluationsApi, type EvaluationWithRelations } from '../../api/evaluations';
import {
  evaluateOutputWithCriteria,
  evaluateOutputWithExpectedSemantic,
} from '../../lib/evaluation-scoring';

export type SuggestionType =
  | 'clarity'
  | 'structure'
  | 'specificity'
  | 'examples'
  | 'constraints';
export type SuggestionSeverity = 'low' | 'medium' | 'high';

export interface OptimizationSuggestion {
  id: string;
  type: SuggestionType;
  title: string;
  description: string;
  originalText?: string;
  suggestedText?: string;
  messageIndex?: number;
  severity?: SuggestionSeverity;
  applied?: boolean;
}

export interface AnalysisResult {
  score: number;
  summary: string;
  strengths: string[];
  suggestions: OptimizationSuggestion[];
}

export interface AutoOptimizeFailureCase {
  caseName: string;
  input?: string;
  expectedOutput?: string;
  modelOutput?: string;
  score?: number;
  reason?: string;
}

export interface AutoOptimizeContext {
  round: number;
  maxRounds: number;
  source: 'evaluation' | 'manual' | 'mixed';
  trainCasesCount: number;
  validationCasesCount: number;
  manualCasesCount: number;
  failedCases: AutoOptimizeFailureCase[];
}

export interface PromptSnapshot {
  messages: PromptMessage[];
  content?: string;
}

export interface ApplySuggestionResult {
  applied: boolean;
}

interface PromptOptimizerProps {
  cacheKey?: string;
  messages: PromptMessage[];
  content?: string;
  models: Model[];
  providers: Provider[];
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  onApplySuggestion: (suggestion: OptimizationSuggestion) => ApplySuggestionResult;
  onOptimize: (
    context?: AutoOptimizeContext,
    options?: { signal?: AbortSignal }
  ) => Promise<OptimizationSuggestion[]>;
  getPromptSnapshot?: () => PromptSnapshot;
  onOpenSettings?: () => void;
  isOptimizing?: boolean;
  analysisResult?: AnalysisResult | null;
  evaluationList?: EvaluationListItem[];
  evaluationSummary?: EvaluationSummary | null;
  selectedEvaluationId?: string;
  onEvaluationSelect?: (evaluationId: string) => void;
}

type OptimizerView = 'analysis' | 'preview' | 'verification';
type VerificationRunScope = 'custom' | 'all' | 'failed' | 'regression';
type FileProcessingMode = NonNullable<EvaluationConfig['file_processing']>;
type EffectiveAttachmentMode = 'vision' | 'ocr' | 'none';

type VerificationAttachmentHandling = {
  configuredMode: FileProcessingMode;
  activeMode: FileProcessingMode;
  effectiveMode: EffectiveAttachmentMode;
  modelSupportsVision: boolean;
  ocrProvider?: OcrProvider;
  attachmentCount: number;
};

type VerificationCase = {
  id: string;
  source: 'evaluation' | 'manual';
  testCaseId?: string;
  name: string;
  input: string;
  inputVariables?: Record<string, string>;
  attachments?: FileAttachment[];
  expectedOutput?: string;
  selected: boolean;
  historicalPassRate?: number;
  beforeScore?: number;
  beforePassed?: boolean;
  isFailed?: boolean;
  passThreshold?: number;
};

type VerificationResult = {
  caseId: string;
  caseName: string;
  output: string;
  attachments?: FileAttachment[];
  expectedOutput?: string;
  beforeScore?: number;
  afterScore?: number;
  criterionScores?: Record<string, number>;
  delta?: number;
  beforePassed?: boolean;
  afterPassed?: boolean;
  judgeFeedback?: Record<string, string>;
  status: 'pending' | 'running' | 'completed' | 'error';
  errorMessage?: string;
};

const SUGGESTION_TYPE_CONFIG = {
  clarity: {
    labelKey: 'clarity',
    color: 'text-blue-400 light:text-blue-600',
    bgColor: 'bg-blue-500/10 light:bg-blue-100',
  },
  structure: {
    labelKey: 'structure',
    color: 'text-purple-400 light:text-purple-600',
    bgColor: 'bg-purple-500/10 light:bg-purple-100',
  },
  specificity: {
    labelKey: 'specificity',
    color: 'text-green-400 light:text-green-600',
    bgColor: 'bg-green-500/10 light:bg-green-100',
  },
  examples: {
    labelKey: 'examples',
    color: 'text-amber-400 light:text-amber-600',
    bgColor: 'bg-amber-500/10 light:bg-amber-100',
  },
  constraints: {
    labelKey: 'constraints',
    color: 'text-red-400 light:text-red-600',
    bgColor: 'bg-red-500/10 light:bg-red-100',
  },
};

const SEVERITY_CONFIG = {
  high: {
    labelKey: 'priorityHigh',
    color: 'text-red-400 light:text-red-500',
    bgColor: 'bg-red-500/10',
  },
  medium: {
    labelKey: 'priorityMedium',
    color: 'text-amber-400 light:text-amber-500',
    bgColor: 'bg-amber-500/10',
  },
  low: {
    labelKey: 'priorityLow',
    color: 'text-green-400 light:text-green-500',
    bgColor: 'bg-green-500/10',
  },
};

const AUTO_PIPELINE_DEFAULT_ROUNDS = 3;
const AUTO_PIPELINE_MIN_ROUNDS = 1;
const AUTO_PIPELINE_MAX_ROUNDS_LIMIT = 10;
const AUTO_PIPELINE_TOP_FAILURE_LIMIT = 10;
const AUTO_PIPELINE_VALIDATION_HOLDOUT = 2;
const MANUAL_SEMANTIC_PASS_THRESHOLD = 0.8;
const MANUAL_PASS_THRESHOLD_MIN_PERCENT = 1;
const MANUAL_PASS_THRESHOLD_MAX_PERCENT = 100;
const MANUAL_PASS_THRESHOLD_DEFAULT_PERCENT = 80;
const DEFAULT_VERIFICATION_CASE_CONCURRENCY = 1;
const FILE_PROCESSING_MODES: FileProcessingMode[] = ['auto', 'vision', 'ocr', 'none'];
const OCR_PROVIDERS: OcrProvider[] = ['paddle', 'paddle_vl', 'paddle_vl_1_5', 'datalab', 'mineru'];

type PromptOptimizerCacheState = {
  view: OptimizerView;
  suggestions: OptimizationSuggestion[];
  error: string | null;
  hasAnalyzed: boolean;
  selectedTemplate: string;
  verificationInitialized: boolean;
  verificationCases: VerificationCase[];
  manualCaseInput: string;
  manualCaseExpected: string;
  manualCasePassThreshold: number;
  verificationResults: VerificationResult[];
  verificationMode: 'unknown' | 'judge' | 'fallback';
  verificationFileProcessingOverride: FileProcessingMode | null;
  verificationOcrProviderOverride: OcrProvider | null;
  appliedSuggestionIds: Record<string, true>;
  dismissedSuggestionIds: Record<string, true>;
  autoPipelineRound: number;
  autoPipelineMaxRounds: number;
  autoPipelineStatus: string;
  expandedResultCaseId: string | null;
  wasInterrupted?: boolean;
};

const promptOptimizerCacheByKey = new Map<string, PromptOptimizerCacheState>();

function getScoreColor(score: number): string {
  if (score >= 90) return 'text-green-400 light:text-green-500';
  if (score >= 70) return 'text-amber-400 light:text-amber-500';
  return 'text-red-400 light:text-red-500';
}

function clampAutoPipelineRounds(value: number): number {
  if (!Number.isFinite(value)) return AUTO_PIPELINE_DEFAULT_ROUNDS;
  const rounded = Math.round(value);
  return Math.min(AUTO_PIPELINE_MAX_ROUNDS_LIMIT, Math.max(AUTO_PIPELINE_MIN_ROUNDS, rounded));
}

function clampManualPassThresholdPercent(value: number): number {
  if (!Number.isFinite(value)) return MANUAL_PASS_THRESHOLD_DEFAULT_PERCENT;
  const rounded = Math.round(value);
  return Math.min(
    MANUAL_PASS_THRESHOLD_MAX_PERCENT,
    Math.max(MANUAL_PASS_THRESHOLD_MIN_PERCENT, rounded)
  );
}

function toUnitPassThreshold(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return MANUAL_SEMANTIC_PASS_THRESHOLD;
  if (value > 1) {
    return Math.min(1, Math.max(0, value / 100));
  }
  return Math.min(1, Math.max(0, value));
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function delayWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }

  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.floor(parsed));
}

function resolveVerificationCaseConcurrency(
  config: Record<string, unknown> | undefined,
  totalCases: number
): number {
  if (totalCases <= 1) return 1;

  const configuredConcurrency = normalizePositiveInteger(config?.case_concurrency);
  const resolvedConcurrency = configuredConcurrency ?? DEFAULT_VERIFICATION_CASE_CONCURRENCY;

  return Math.min(totalCases, resolvedConcurrency);
}

function normalizeAttachments(value: unknown): FileAttachment[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const attachment = item as Partial<FileAttachment>;
      if (typeof attachment.fileId !== 'string' || !attachment.fileId.trim()) return null;
      if (typeof attachment.name !== 'string' || !attachment.name.trim()) return null;
      if (typeof attachment.type !== 'string' || !attachment.type.trim()) return null;
      const normalized: FileAttachment = {
        fileId: attachment.fileId,
        name: attachment.name,
        type: attachment.type,
      };
      if (typeof attachment.size === 'number') {
        normalized.size = attachment.size;
      }
      return normalized;
    })
    .filter((item): item is FileAttachment => Boolean(item));
}

function resolveEvaluationFileProcessing(config: Record<string, unknown> | undefined): FileProcessingMode {
  const rawMode = config?.file_processing;
  if (typeof rawMode !== 'string') return 'auto';
  return FILE_PROCESSING_MODES.includes(rawMode as FileProcessingMode)
    ? (rawMode as FileProcessingMode)
    : 'auto';
}

function resolveEvaluationOcrProvider(config: Record<string, unknown> | undefined): OcrProvider | undefined {
  const rawProvider = config?.ocr_provider;
  if (typeof rawProvider !== 'string') return undefined;
  return OCR_PROVIDERS.includes(rawProvider as OcrProvider) ? (rawProvider as OcrProvider) : undefined;
}

function resolveEffectiveAttachmentMode(
  mode: FileProcessingMode,
  supportsVision: boolean
): EffectiveAttachmentMode {
  if (mode === 'none') return 'none';
  if (mode === 'ocr') return 'ocr';
  if (mode === 'vision') return supportsVision ? 'vision' : 'none';
  return supportsVision ? 'vision' : 'ocr';
}

function getFileProcessingLabelKey(
  mode: FileProcessingMode | EffectiveAttachmentMode
): 'fileProcessingAuto' | 'fileProcessingVision' | 'fileProcessingOcr' | 'fileProcessingNone' {
  if (mode === 'vision') return 'fileProcessingVision';
  if (mode === 'ocr') return 'fileProcessingOcr';
  if (mode === 'none') return 'fileProcessingNone';
  return 'fileProcessingAuto';
}

function isFileProcessingMode(value: string): value is FileProcessingMode {
  return FILE_PROCESSING_MODES.includes(value as FileProcessingMode);
}

function isOcrProvider(value: string): value is OcrProvider {
  return OCR_PROVIDERS.includes(value as OcrProvider);
}

function appendAttachmentsToMessages(messages: ChatMessage[], attachments: FileAttachment[]): ChatMessage[] {
  const normalizedAttachments = normalizeAttachments(attachments);
  if (normalizedAttachments.length === 0) return messages;

  const attachmentParts: ContentPart[] = normalizedAttachments.map((file) => ({
    type: 'file_ref',
    file_ref: { fileId: file.fileId },
  }));

  const targetIndex = [...messages].reverse().findIndex((message) => message.role === 'user');
  const userIndex = targetIndex === -1 ? -1 : messages.length - 1 - targetIndex;

  if (userIndex === -1) {
    return [
      ...messages,
      {
        role: 'user',
        content: attachmentParts,
      },
    ];
  }

  const nextMessages = [...messages];
  const userMessage = nextMessages[userIndex];
  const existingContent = userMessage.content;

  const contentParts: ContentPart[] =
    typeof existingContent === 'string'
      ? existingContent.trim()
        ? [{ type: 'text', text: existingContent }, ...attachmentParts]
        : [...attachmentParts]
      : [...existingContent, ...attachmentParts];

  nextMessages[userIndex] = {
    ...userMessage,
    content: contentParts,
  };

  return nextMessages;
}

function normalizePercentScore(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  if (value <= 1) return Math.round(value * 100);
  if (value <= 10) return Math.round(value * 10);
  return Math.round(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyVariables(text: string, vars: Record<string, string>): string {
  let next = text;
  for (const [key, value] of Object.entries(vars)) {
    next = next.replace(new RegExp(`{{\\s*${escapeRegExp(key)}\\s*}}`, 'g'), value);
  }
  return next;
}

function scoreWithExpectedOutputHeuristic(modelOutput: string, expectedOutput?: string): number | undefined {
  if (!expectedOutput || !expectedOutput.trim()) return undefined;
  const output = modelOutput.toLowerCase().trim();
  const expected = expectedOutput.toLowerCase().trim();
  if (!output || !expected) return undefined;
  if (output === expected) return 100;
  if (output.includes(expected) || expected.includes(output)) return 85;

  const expectedChars = Array.from(expected.replace(/\s+/g, ''));
  const outputChars = new Set(Array.from(output.replace(/\s+/g, '')));
  if (expectedChars.length === 0) return undefined;
  const overlap = expectedChars.filter((ch) => outputChars.has(ch)).length;
  return Math.round((overlap / expectedChars.length) * 100);
}

function dedupeVerificationCases(cases: VerificationCase[]): VerificationCase[] {
  const seen = new Set<string>();
  const deduped: VerificationCase[] = [];
  for (const item of cases) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

function compactReason(feedback?: Record<string, string>): string | undefined {
  if (!feedback) return undefined;
  const entries = Object.values(feedback).filter((value) => typeof value === 'string' && value.trim().length > 0);
  if (entries.length === 0) return undefined;
  const merged = entries.join(' | ');
  return merged.length > 500 ? `${merged.slice(0, 500)}...` : merged;
}

function buildCaseMessages(
  messages: PromptMessage[],
  rawContent: string | undefined,
  input: string,
  inputVariables: Record<string, string>
): ChatMessage[] {
  if (messages.length > 0) {
    let hasInputPlaceholder = false;
    const transformed = messages
      .map((message) => {
        let text = applyVariables(message.content, inputVariables);
        if (text.includes('{{input}}')) hasInputPlaceholder = true;
        text = text.replace(/{{input}}/g, input);
        return {
          role: message.role,
          content: text,
        };
      })
      .filter((message) => message.content.trim().length > 0);

    if (!hasInputPlaceholder && input.trim().length > 0) {
      transformed.push({
        role: 'user',
        content: input,
      });
    }

    if (transformed.length > 0) {
      return transformed as ChatMessage[];
    }
  }

  let merged = applyVariables(rawContent || '', inputVariables);
  if (merged.includes('{{input}}')) {
    merged = merged.replace(/{{input}}/g, input);
  } else if (input.trim().length > 0) {
    merged = [merged, input].filter(Boolean).join('\n\n');
  }

  return [
    {
      role: 'user',
      content: (merged || input).trim(),
    },
  ];
}

function formatPromptMessages(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role.toUpperCase();
      const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      return `[${role}]\n${content}`;
    })
    .join('\n\n');
}

export function PromptOptimizer({
  cacheKey,
  messages,
  content,
  models,
  providers,
  selectedModelId,
  onModelChange,
  onApplySuggestion,
  onOptimize,
  getPromptSnapshot,
  onOpenSettings: _onOpenSettings,
  isOptimizing = false,
  analysisResult,
  evaluationList,
  evaluationSummary,
  selectedEvaluationId,
  onEvaluationSelect,
}: PromptOptimizerProps) {
  const { t } = useTranslation('prompts');
  const { t: tCommon } = useTranslation('common');
  const { t: tEvaluation } = useTranslation('evaluation');
  const cachedState = cacheKey ? promptOptimizerCacheByKey.get(cacheKey) : undefined;

  const [view, setView] = useState<OptimizerView>(cachedState?.view || 'analysis');
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>(cachedState?.suggestions || []);
  const [error, setError] = useState<string | null>(cachedState?.error || null);
  const [hasAnalyzed, setHasAnalyzed] = useState(Boolean(cachedState?.hasAnalyzed));
  const [selectedTemplate, setSelectedTemplate] = useState<string>(() => {
    if (cachedState?.selectedTemplate) return cachedState.selectedTemplate;
    const promptPreference = cacheKey ? getPromptOptimizerPreference(cacheKey) : {};
    if (promptPreference.templateId) return promptPreference.templateId;
    const settings = getOptimizationSettings();
    return settings.selectedTemplate || 'general';
  });

  const [verificationInitialized, setVerificationInitialized] = useState(Boolean(cachedState?.verificationInitialized));
  const [verificationCases, setVerificationCases] = useState<VerificationCase[]>(cachedState?.verificationCases || []);
  const [manualCaseInput, setManualCaseInput] = useState(cachedState?.manualCaseInput || '');
  const [manualCaseExpected, setManualCaseExpected] = useState(cachedState?.manualCaseExpected || '');
  const [manualCasePassThreshold, setManualCasePassThreshold] = useState(
    clampManualPassThresholdPercent(
      cachedState?.manualCasePassThreshold ?? MANUAL_PASS_THRESHOLD_DEFAULT_PERCENT
    )
  );
  const [verificationResults, setVerificationResults] = useState<VerificationResult[]>(cachedState?.verificationResults || []);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationMode, setVerificationMode] = useState<'unknown' | 'judge' | 'fallback'>(cachedState?.verificationMode || 'unknown');
  const [verificationFileProcessingOverride, setVerificationFileProcessingOverride] =
    useState<FileProcessingMode | null>(cachedState?.verificationFileProcessingOverride ?? null);
  const [verificationOcrProviderOverride, setVerificationOcrProviderOverride] =
    useState<OcrProvider | null>(cachedState?.verificationOcrProviderOverride ?? null);
  const [appliedSuggestionIds, setAppliedSuggestionIds] = useState<Record<string, true>>(cachedState?.appliedSuggestionIds || {});
  const [dismissedSuggestionIds, setDismissedSuggestionIds] = useState<Record<string, true>>(cachedState?.dismissedSuggestionIds || {});
  const [isAutoPipelineRunning, setIsAutoPipelineRunning] = useState(false);
  const [autoPipelineRound, setAutoPipelineRound] = useState(cachedState?.autoPipelineRound || 0);
  const [autoPipelineMaxRounds, setAutoPipelineMaxRounds] = useState(
    clampAutoPipelineRounds(cachedState?.autoPipelineMaxRounds ?? AUTO_PIPELINE_DEFAULT_ROUNDS)
  );
  const [autoPipelineStatus, setAutoPipelineStatus] = useState(cachedState?.autoPipelineStatus || '');
  const [expandedResultCaseId, setExpandedResultCaseId] = useState<string | null>(cachedState?.expandedResultCaseId || null);
  const [isPromptPreviewCollapsed, setIsPromptPreviewCollapsed] = useState(false);
  const [isPromptPreviewFullscreen, setIsPromptPreviewFullscreen] = useState(false);
  const [isPromptPreviewCopied, setIsPromptPreviewCopied] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachment | null>(null);
  const [verificationRunScope, setVerificationRunScope] = useState<VerificationRunScope>('custom');
  const [referenceFileProcessing, setReferenceFileProcessing] = useState<FileProcessingMode>('auto');
  const [referenceOcrProvider, setReferenceOcrProvider] = useState<OcrProvider | undefined>(undefined);
  const [evaluationCaseAttachmentsById, setEvaluationCaseAttachmentsById] =
    useState<Record<string, FileAttachment[]>>({});
  const [isCaseManagerOpen, setIsCaseManagerOpen] = useState(false);
  const [caseManagerDraftCases, setCaseManagerDraftCases] = useState<VerificationCase[]>([]);
  const [caseManagerManualInput, setCaseManagerManualInput] = useState('');
  const [caseManagerManualExpected, setCaseManagerManualExpected] = useState('');
  const [caseManagerManualPassThreshold, setCaseManagerManualPassThreshold] = useState(
    MANUAL_PASS_THRESHOLD_DEFAULT_PERCENT
  );
  const [caseManagerFilterKeyword, setCaseManagerFilterKeyword] = useState('');
  const hasAutoSelectedResultRef = useRef(false);
  const analysisAbortControllerRef = useRef<AbortController | null>(null);
  const verificationAbortControllerRef = useRef<AbortController | null>(null);
  const autoPipelineAbortControllerRef = useRef<AbortController | null>(null);
  const lastEvaluationIdRef = useRef<string>('');
  const promptPreviewScrollRef = useRef<HTMLDivElement | null>(null);
  const promptPreviewFullscreenScrollRef = useRef<HTMLDivElement | null>(null);

  const hasContent =
    messages.some((message) => message.content.trim().length > 0) ||
    ((content || '').trim().length > 0);
  const suggestionSource = analysisResult?.suggestions || suggestions;
  const displaySuggestions = useMemo(() => {
    return suggestionSource
      .filter((item) => !dismissedSuggestionIds[item.id])
      .map((item) => ({
        ...item,
        applied: item.applied || Boolean(appliedSuggestionIds[item.id]),
      }));
  }, [appliedSuggestionIds, dismissedSuggestionIds, suggestionSource]);
  const hasUsableAnalysisResult = Boolean(
    analysisResult &&
    (
      (analysisResult.summary || '').trim().length > 0 ||
      (analysisResult.strengths || []).length > 0 ||
      (analysisResult.suggestions || []).length > 0
    )
  );
  const effectiveSelectedEvaluationId = selectedEvaluationId || evaluationSummary?.evaluationId || '';
  const selectedCaseCount = verificationCases.filter((item) => item.selected).length;
  const caseManagerSelectedCount = caseManagerDraftCases.filter((item) => item.selected).length;
  const evaluationVerificationCases = useMemo(
    () => caseManagerDraftCases.filter((item) => item.source === 'evaluation'),
    [caseManagerDraftCases]
  );
  const manualVerificationCases = useMemo(
    () => caseManagerDraftCases.filter((item) => item.source === 'manual'),
    [caseManagerDraftCases]
  );
  const filteredEvaluationVerificationCases = useMemo(() => {
    const keyword = caseManagerFilterKeyword.trim().toLowerCase();
    if (!keyword) return evaluationVerificationCases;
    return evaluationVerificationCases.filter((item) => {
      const haystack = `${item.name} ${item.input} ${item.expectedOutput || ''}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [caseManagerFilterKeyword, evaluationVerificationCases]);
  const isStandaloneAnalyzing = isOptimizing && !isAutoPipelineRunning;
  const caseManagerBusy = isVerifying || isAutoPipelineRunning || isOptimizing;
  const runScopeCases = useMemo(() => {
    const runnableCases = verificationCases.filter((item) =>
      item.source === 'evaluation' ? true : item.input.trim().length > 0
    );

    if (verificationRunScope === 'all') {
      return runnableCases;
    }

    if (verificationRunScope === 'failed') {
      return runnableCases.filter((item) =>
        item.source === 'evaluation' ? Boolean(item.isFailed) : item.beforePassed === false
      );
    }

    if (verificationRunScope === 'regression') {
      const regressionIds = new Set(
        verificationResults
          .filter((result) => result.beforePassed === true && result.afterPassed === false)
          .map((result) => result.caseId)
      );
      return runnableCases.filter((item) => regressionIds.has(item.id));
    }

    return runnableCases.filter((item) => item.selected);
  }, [verificationCases, verificationResults, verificationRunScope]);

  const activeVerificationFileProcessing = verificationFileProcessingOverride ?? referenceFileProcessing;
  const activeVerificationOcrProvider = verificationOcrProviderOverride ?? referenceOcrProvider;
  const verificationModelSupportsVision = useMemo(() => {
    if (!selectedModelId) return true;
    const selectedModel = models.find((item) => item.id === selectedModelId);
    return selectedModel?.supportsVision ?? true;
  }, [models, selectedModelId]);
  const currentVerificationAttachmentHandling = useMemo<VerificationAttachmentHandling>(() => {
    const attachmentCount = runScopeCases.reduce((count, item) => {
      const resolvedAttachments =
        item.source === 'evaluation' && item.testCaseId
          ? (evaluationCaseAttachmentsById[item.testCaseId] ?? normalizeAttachments(item.attachments))
          : normalizeAttachments(item.attachments);
      return count + resolvedAttachments.length;
    }, 0);

    return {
      configuredMode: referenceFileProcessing,
      activeMode: activeVerificationFileProcessing,
      effectiveMode: resolveEffectiveAttachmentMode(
        activeVerificationFileProcessing,
        verificationModelSupportsVision
      ),
      modelSupportsVision: verificationModelSupportsVision,
      ocrProvider: activeVerificationOcrProvider,
      attachmentCount,
    };
  }, [
    activeVerificationFileProcessing,
    activeVerificationOcrProvider,
    evaluationCaseAttachmentsById,
    referenceFileProcessing,
    runScopeCases,
    verificationModelSupportsVision,
  ]);

  useEffect(() => {
    if (
      lastEvaluationIdRef.current &&
      lastEvaluationIdRef.current !== effectiveSelectedEvaluationId
    ) {
      setVerificationFileProcessingOverride(null);
      setVerificationOcrProviderOverride(null);
    }
    lastEvaluationIdRef.current = effectiveSelectedEvaluationId;
  }, [effectiveSelectedEvaluationId]);

  useEffect(() => {
    let disposed = false;

    const applyReferenceDefaults = () => {
      if (disposed) return;
      setReferenceFileProcessing('auto');
      setReferenceOcrProvider(undefined);
      setEvaluationCaseAttachmentsById({});
    };

    if (!effectiveSelectedEvaluationId) {
      applyReferenceDefaults();
      return () => {
        disposed = true;
      };
    }

    const loadEvaluationDetail = async () => {
      try {
        const detail = await evaluationsApi.getById(effectiveSelectedEvaluationId);
        if (disposed) return;

        const evaluationConfig = (detail.config || {}) as Record<string, unknown>;
        setReferenceFileProcessing(resolveEvaluationFileProcessing(evaluationConfig));
        setReferenceOcrProvider(resolveEvaluationOcrProvider(evaluationConfig));

        const attachmentsById: Record<string, FileAttachment[]> = {};
        for (const testCase of detail.testCases || []) {
          attachmentsById[testCase.id] = normalizeAttachments(testCase.attachments);
        }
        setEvaluationCaseAttachmentsById(attachmentsById);

        setVerificationCases((prev) =>
          prev.map((item) => {
            if (item.source !== 'evaluation' || !item.testCaseId) return item;
            const nextAttachments = attachmentsById[item.testCaseId];
            if (!nextAttachments) return item;
            return {
              ...item,
              attachments: nextAttachments,
            };
          })
        );
      } catch {
        applyReferenceDefaults();
      }
    };

    void loadEvaluationDetail();

    return () => {
      disposed = true;
    };
  }, [effectiveSelectedEvaluationId]);

  useEffect(() => {
    if (!cachedState?.wasInterrupted) return;
    setAutoPipelineStatus(t('autoPipelineInterrupted'));
    setIsAutoPipelineRunning(false);
    setIsVerifying(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      analysisAbortControllerRef.current?.abort();
      verificationAbortControllerRef.current?.abort();
      autoPipelineAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!cacheKey) return;
    promptOptimizerCacheByKey.set(cacheKey, {
      view,
      suggestions,
      error,
      hasAnalyzed,
      selectedTemplate,
      verificationInitialized,
      verificationCases,
      manualCaseInput,
      manualCaseExpected,
      manualCasePassThreshold,
      verificationResults,
      verificationMode,
      verificationFileProcessingOverride,
      verificationOcrProviderOverride,
      appliedSuggestionIds,
      dismissedSuggestionIds,
      autoPipelineRound,
      autoPipelineMaxRounds,
      autoPipelineStatus,
      expandedResultCaseId,
      wasInterrupted: isAutoPipelineRunning || isVerifying,
    });
  }, [
    appliedSuggestionIds,
    autoPipelineRound,
    autoPipelineMaxRounds,
    autoPipelineStatus,
    cacheKey,
    dismissedSuggestionIds,
    error,
    expandedResultCaseId,
    hasAnalyzed,
    isAutoPipelineRunning,
    isVerifying,
    manualCaseExpected,
    manualCaseInput,
    manualCasePassThreshold,
    selectedTemplate,
    suggestions,
    verificationCases,
    verificationInitialized,
    verificationFileProcessingOverride,
    verificationOcrProviderOverride,
    verificationMode,
    verificationResults,
    view,
  ]);

  const verificationSummary = useMemo(() => {
    const completed = verificationResults.filter((result) => result.status === 'completed');
    const comparablePass = completed.filter(
      (result) =>
        typeof result.beforePassed === 'boolean' && typeof result.afterPassed === 'boolean'
    );
    const comparableScore = completed.filter(
      (result) =>
        typeof result.beforeScore === 'number' && typeof result.afterScore === 'number'
    );

    const beforePassRate =
      comparablePass.length > 0
        ? comparablePass.filter((result) => result.beforePassed).length / comparablePass.length
        : null;
    const afterPassRate =
      comparablePass.length > 0
        ? comparablePass.filter((result) => result.afterPassed).length / comparablePass.length
        : null;
    const passRateDelta =
      beforePassRate !== null && afterPassRate !== null ? afterPassRate - beforePassRate : null;
    const averageScoreDelta =
      comparableScore.length > 0
        ? comparableScore.reduce(
            (sum, result) => sum + ((result.afterScore || 0) - (result.beforeScore || 0)),
            0
          ) / comparableScore.length
        : null;
    const regressions = comparablePass.filter(
      (result) => result.beforePassed && !result.afterPassed
    ).length;
    const improved = comparablePass.filter(
      (result) => !result.beforePassed && result.afterPassed
    ).length;

    return {
      completedCount: completed.length,
      beforePassRate,
      afterPassRate,
      passRateDelta,
      averageScoreDelta,
      regressions,
      improved,
    };
  }, [verificationResults]);

  useEffect(() => {
    if (verificationResults.length === 0) {
      hasAutoSelectedResultRef.current = false;
      if (expandedResultCaseId !== null) {
        setExpandedResultCaseId(null);
      }
      return;
    }

    if (expandedResultCaseId) {
      hasAutoSelectedResultRef.current = true;
      const stillExists = verificationResults.some(
        (item) => item.caseId === expandedResultCaseId
      );
      if (stillExists) return;

      const preferred =
        verificationResults.find((item) => item.status === 'completed') || verificationResults[0];
      if (preferred && preferred.caseId !== expandedResultCaseId) {
        setExpandedResultCaseId(preferred.caseId);
      }
      return;
    }

    // Auto-expand only once per non-empty result set.
    if (hasAutoSelectedResultRef.current) return;

    const preferred =
      verificationResults.find((item) => item.status === 'completed') || verificationResults[0];
    if (preferred && preferred.caseId !== expandedResultCaseId) {
      setExpandedResultCaseId(preferred.caseId);
      hasAutoSelectedResultRef.current = true;
    }
  }, [expandedResultCaseId, verificationResults]);

  const promptPreview = useMemo(() => {
    if (messages.length > 0) {
      const normalized = messages
        .filter((message) => message.content.trim().length > 0)
        .map((message) => ({
          role: message.role,
          content: message.content,
        })) as ChatMessage[];
      return formatPromptMessages(normalized);
    }
    return (content || '').trim();
  }, [content, messages]);

  useEffect(() => {
    if (view !== 'preview' || isPromptPreviewCollapsed) return;
    promptPreviewScrollRef.current?.scrollTo({ top: 0 });
  }, [view, promptPreview, isPromptPreviewCollapsed]);

  useEffect(() => {
    if (!isPromptPreviewFullscreen) return;
    promptPreviewFullscreenScrollRef.current?.scrollTo({ top: 0 });
  }, [isPromptPreviewFullscreen, promptPreview]);

  const getScoreLabel = (score: number): string => {
    if (score >= 90) return t('scoreExcellent');
    if (score >= 70) return t('scoreGood');
    if (score >= 50) return t('scoreFair');
    return t('scoreNeedsWork');
  };

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplate(templateId);
    const template = BUILTIN_META_PROMPTS.find((item) => item.id === templateId);
    if (cacheKey) {
      savePromptOptimizerPreference(cacheKey, { templateId });
    }

    if (template) {
      const settings = getOptimizationSettings();
      saveOptimizationSettings({
        ...settings,
        analysisPrompt: template.prompt,
        selectedTemplate: templateId,
      });
    }
  };

  const runOptimizeOnce = async (
    switchToAnalysis = true,
    context?: AutoOptimizeContext,
    options?: { signal?: AbortSignal }
  ): Promise<OptimizationSuggestion[]> => {
    setError(null);
    if (switchToAnalysis) {
      setView('analysis');
      setVerificationResults([]);
    }

    try {
      if (options?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const newSuggestions = await onOptimize(context, { signal: options?.signal });
      setSuggestions(newSuggestions);
      setHasAnalyzed(true);
      setAppliedSuggestionIds({});
      setDismissedSuggestionIds({});
      return newSuggestions;
    } catch (optimizeError) {
      if (isAbortError(optimizeError) || options?.signal?.aborted) {
        setError(t('runStopped'));
        throw optimizeError;
      }
      setError(optimizeError instanceof Error ? optimizeError.message : t('analysisFailed'));
      return [];
    }
  };

  const handleOptimize = async () => {
    if (isOptimizing || isAutoPipelineRunning || isVerifying) {
      return;
    }

    const controller = chatApi.createAbortController();
    analysisAbortControllerRef.current?.abort();
    analysisAbortControllerRef.current = controller;

    try {
      await runOptimizeOnce(true, undefined, { signal: controller.signal });
    } catch (optimizeError) {
      if (!isAbortError(optimizeError)) {
        setError(optimizeError instanceof Error ? optimizeError.message : t('analysisFailed'));
      }
    } finally {
      if (analysisAbortControllerRef.current === controller) {
        analysisAbortControllerRef.current = null;
      }
    }
  };

  const handleAbortAnalyze = () => {
    analysisAbortControllerRef.current?.abort();
  };

  const handleAbortVerification = () => {
    verificationAbortControllerRef.current?.abort();
  };

  const handleAbortAutoPipeline = () => {
    autoPipelineAbortControllerRef.current?.abort();
  };

  const handleApply = (suggestion: OptimizationSuggestion): ApplySuggestionResult => {
    const result = onApplySuggestion(suggestion);
    if (!result.applied) {
      return result;
    }
    setAppliedSuggestionIds((prev) => ({ ...prev, [suggestion.id]: true }));
    return result;
  };

  const handleDismiss = (suggestionId: string) => {
    setDismissedSuggestionIds((prev) => ({ ...prev, [suggestionId]: true }));
  };

  const resolvePromptSnapshot = (): PromptSnapshot => {
    if (getPromptSnapshot) {
      const snapshot = getPromptSnapshot();
      if (snapshot && Array.isArray(snapshot.messages)) {
        return snapshot;
      }
    }
    return {
      messages,
      content,
    };
  };

  const handleAutoPipelineMaxRoundsChange = (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setAutoPipelineMaxRounds(clampAutoPipelineRounds(parsed));
  };

  const handleManualPassThresholdInput = (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setCaseManagerManualPassThreshold(clampManualPassThresholdPercent(parsed));
  };

  const handleManualCaseThresholdChange = (caseId: string, value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const nextThreshold = clampManualPassThresholdPercent(parsed) / 100;
    setCaseManagerDraftCases((prev) =>
      prev.map((row) =>
        row.id === caseId && row.source === 'manual' ? { ...row, passThreshold: nextThreshold } : row
      )
    );
  };

  const handleCopyPromptPreview = async () => {
    const text = promptPreview || '';
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setIsPromptPreviewCopied(true);
      setTimeout(() => setIsPromptPreviewCopied(false), 1200);
    } catch {
      setIsPromptPreviewCopied(false);
    }
  };

  const togglePromptPreviewFullscreen = () => {
    if (!isPromptPreviewFullscreen) {
      setIsPromptPreviewCollapsed(false);
    }
    setIsPromptPreviewFullscreen((prev) => !prev);
  };

  const handleVerificationFileProcessingChange = (rawValue: string) => {
    const nextOverride = rawValue && isFileProcessingMode(rawValue) ? rawValue : null;
    setVerificationFileProcessingOverride(nextOverride);
  };

  const handleVerificationOcrProviderChange = (rawValue: string) => {
    const nextOverride = rawValue && isOcrProvider(rawValue) ? rawValue : null;
    setVerificationOcrProviderOverride(nextOverride);
  };

  const getOcrProviderLabel = (provider: OcrProvider): string => {
    switch (provider) {
      case 'paddle':
        return 'PaddleOCR';
      case 'paddle_vl':
        return tEvaluation('ocrProviderPaddleVl');
      case 'paddle_vl_1_5':
        return tEvaluation('ocrProviderPaddleVl15');
      case 'datalab':
        return tEvaluation('ocrProviderDatalab');
      case 'mineru':
        return tEvaluation('ocrProviderMineru');
      default:
        return provider;
    }
  };

  const buildEvaluationCases = (): VerificationCase[] => {
    const nextCases: VerificationCase[] = [];
    if (evaluationSummary?.testCaseStats && evaluationSummary.testCaseStats.length > 0) {
      for (const stat of evaluationSummary.testCaseStats) {
        const isUntested = stat.totalCount === 0;
        const isFailed = isUntested || !stat.latestPassed || (stat.totalCount > 0 && stat.passCount < stat.totalCount);
        const passRate =
          stat.totalCount > 0 ? stat.passCount / stat.totalCount : stat.latestPassed ? 1 : 0;
        nextCases.push({
          id: `eval_${stat.testCaseId}`,
          source: 'evaluation',
          testCaseId: stat.testCaseId,
          name: stat.testCaseName,
          input: stat.inputText || '',
          inputVariables: stat.inputVariables || {},
          expectedOutput: stat.expectedOutput || undefined,
          selected: isFailed,
          historicalPassRate: passRate,
          beforeScore: isUntested ? undefined : normalizePercentScore(stat.latestScore),
          beforePassed: isUntested ? undefined : stat.latestPassed,
          isFailed,
        });
      }
    } else if (evaluationSummary?.topFailures && evaluationSummary.topFailures.length > 0) {
      for (const failure of evaluationSummary.topFailures) {
        const firstScore = Object.values(failure.latestScores || {})[0];
        nextCases.push({
          id: `eval_fail_${failure.testCaseId}`,
          source: 'evaluation',
          testCaseId: failure.testCaseId,
          name: failure.testCaseName,
          input: '',
          expectedOutput: failure.expectedOutput || undefined,
          selected: true,
          historicalPassRate:
            failure.totalCount > 0 ? 1 - failure.failCount / failure.totalCount : 0,
          beforeScore: normalizePercentScore(firstScore),
          beforePassed: false,
          isFailed: true,
        });
      }
    }
    return nextCases;
  };

  const buildAutoTopFailureCases = (): VerificationCase[] => {
    if (!evaluationSummary) return [];

    if (evaluationSummary.topFailures.length > 0) {
      return evaluationSummary.topFailures
        .slice(0, AUTO_PIPELINE_TOP_FAILURE_LIMIT)
        .map((failure) => {
          const latestScores = Object.values(failure.latestScores || {});
          const numericScores = latestScores.filter((score): score is number => typeof score === 'number');
          const avgScore =
            numericScores.length > 0
              ? numericScores.reduce((sum, score) => sum + score, 0) / numericScores.length
              : undefined;
          return {
            id: `eval_auto_${failure.testCaseId}`,
            source: 'evaluation' as const,
            testCaseId: failure.testCaseId,
            name: failure.testCaseName,
            input: '',
            expectedOutput: failure.expectedOutput || undefined,
            selected: true,
            historicalPassRate:
              failure.totalCount > 0 ? 1 - failure.failCount / failure.totalCount : 0,
            beforeScore: normalizePercentScore(avgScore),
            beforePassed: false,
            isFailed: true,
          };
        });
    }

    const stats = evaluationSummary.testCaseStats || [];
    if (stats.length === 0) return [];

    return stats
      .map((stat) => {
        const failCount = Math.max(0, stat.totalCount - stat.passCount);
        const failRate =
          stat.totalCount > 0
            ? failCount / stat.totalCount
            : stat.latestPassed
              ? 0
              : 1;
        return {
          stat,
          failCount,
          failRate,
        };
      })
      .filter((item) => item.failCount > 0 || !item.stat.latestPassed)
      .sort((a, b) => b.failRate - a.failRate || b.failCount - a.failCount)
      .slice(0, AUTO_PIPELINE_TOP_FAILURE_LIMIT)
      .map(({ stat }) => ({
        id: `eval_auto_${stat.testCaseId}`,
        source: 'evaluation' as const,
        testCaseId: stat.testCaseId,
        name: stat.testCaseName,
        input: stat.inputText || '',
        inputVariables: stat.inputVariables || {},
        expectedOutput: stat.expectedOutput || undefined,
        selected: true,
        historicalPassRate:
          stat.totalCount > 0 ? stat.passCount / stat.totalCount : stat.latestPassed ? 1 : 0,
        beforeScore: normalizePercentScore(stat.latestScore),
        beforePassed: stat.latestPassed,
        isFailed: true,
      }));
  };

  const splitTrainAndValidationCases = (cases: VerificationCase[]) => {
    if (cases.length < 6) {
      return {
        train: cases,
        validation: [] as VerificationCase[],
      };
    }

    const holdout = Math.min(AUTO_PIPELINE_VALIDATION_HOLDOUT, Math.max(cases.length - 1, 1));
    return {
      train: cases.slice(0, cases.length - holdout),
      validation: cases.slice(cases.length - holdout),
    };
  };

  const initVerificationCases = (options?: { switchView?: boolean }): VerificationCase[] => {
    const evaluationCases = buildEvaluationCases();
    const manualCases = verificationCases.filter((item) => item.source === 'manual');
    const mergedCases = [...evaluationCases, ...manualCases];
    setVerificationCases(mergedCases);
    setVerificationResults([]);
    setVerificationInitialized(true);
    setVerificationMode('unknown');
    if (options?.switchView ?? true) {
      setView('verification');
    }
    return mergedCases;
  };

  useEffect(() => {
    if (!verificationInitialized) return;
    setVerificationCases((prev) => {
      const manualCases = prev.filter((item) => item.source === 'manual');
      const prevEvaluationById = new Map(
        prev
          .filter((item) => item.source === 'evaluation')
          .map((item) => [item.id, item] as const)
      );
      const refreshedEvaluationCases = buildEvaluationCases().map((item) => {
        const prevItem = prevEvaluationById.get(item.id);
        return prevItem
          ? { ...item, selected: prevItem.selected, attachments: prevItem.attachments }
          : item;
      });
      return [...refreshedEvaluationCases, ...manualCases];
    });
    setVerificationResults([]);
    setVerificationMode('unknown');
  }, [
    verificationInitialized,
    effectiveSelectedEvaluationId,
    evaluationSummary,
  ]);

  const openCaseManager = () => {
    setCaseManagerDraftCases(verificationCases.map((item) => ({ ...item })));
    setCaseManagerManualInput(manualCaseInput);
    setCaseManagerManualExpected(manualCaseExpected);
    setCaseManagerManualPassThreshold(manualCasePassThreshold);
    setCaseManagerFilterKeyword('');
    setIsCaseManagerOpen(true);
  };

  const handleCancelCaseManager = () => {
    setIsCaseManagerOpen(false);
    setCaseManagerDraftCases([]);
  };

  const handleSubmitCaseManager = () => {
    setVerificationCases(caseManagerDraftCases);
    setManualCaseInput(caseManagerManualInput);
    setManualCaseExpected(caseManagerManualExpected);
    setManualCasePassThreshold(clampManualPassThresholdPercent(caseManagerManualPassThreshold));
    setIsCaseManagerOpen(false);
    setCaseManagerDraftCases([]);
  };

  const addManualCase = () => {
    if (!caseManagerManualInput.trim()) return;
    const manualCount = caseManagerDraftCases.filter((item) => item.source === 'manual').length + 1;
    const nextCase: VerificationCase = {
      id: `manual_${Date.now()}`,
      source: 'manual',
      name: `${t('manualCasePrefix')} ${manualCount}`,
      input: caseManagerManualInput.trim(),
      expectedOutput: caseManagerManualExpected.trim() || undefined,
      passThreshold: clampManualPassThresholdPercent(caseManagerManualPassThreshold) / 100,
      selected: true,
    };
    setCaseManagerDraftCases((prev) => [...prev, nextCase]);
    setCaseManagerManualInput('');
    setCaseManagerManualExpected('');
  };

  const toggleCaseSelection = (caseId: string) => {
    setCaseManagerDraftCases((prev) =>
      prev.map((item) =>
        item.id === caseId
          ? {
              ...item,
              selected: !item.selected,
            }
          : item
      )
    );
  };

  const selectAllCases = () => {
    setCaseManagerDraftCases((prev) =>
      prev.map((item) => ({
        ...item,
        selected: item.source === 'evaluation' ? true : item.input.trim().length > 0,
      }))
    );
  };

  const selectFailedCases = () => {
    const regressionIds = new Set(
      verificationResults
        .filter((result) => result.beforePassed === true && result.afterPassed === false)
        .map((result) => result.caseId)
    );

    setCaseManagerDraftCases((prev) =>
      prev.map((item) => {
        const shouldSelect =
          item.source === 'evaluation'
            ? Boolean(item.isFailed) || regressionIds.has(item.id)
            : item.beforePassed === false || regressionIds.has(item.id);
        return { ...item, selected: shouldSelect };
      })
    );
  };

  const clearCaseSelection = () => {
    setCaseManagerDraftCases((prev) => prev.map((item) => ({ ...item, selected: false })));
  };

  const removeManualCase = (caseId: string) => {
    setCaseManagerDraftCases((prev) =>
      prev.filter((item) => !(item.source === 'manual' && item.id === caseId))
    );
  };

  const runVerification = async (
    casesOverride?: VerificationCase[],
    options?: { signal?: AbortSignal }
  ): Promise<VerificationResult[] | null> => {
    const selectedCases = (casesOverride || verificationCases).filter((item) => item.selected);
    if (selectedCases.length === 0 || isVerifying) return null;
    const signal = options?.signal;
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const promptSnapshot = resolvePromptSnapshot();

    setIsVerifying(true);
    let runningResults: VerificationResult[] =
      selectedCases.map((item) => ({
        caseId: item.id,
        caseName: item.name,
        output: '',
        attachments: normalizeAttachments(item.attachments),
        expectedOutput: item.expectedOutput,
        beforeScore: item.beforeScore,
        beforePassed: item.beforePassed,
        status: 'pending',
      }));
    setVerificationResults(runningResults);
    const updateRunningResult = (caseId: string, patch: Partial<VerificationResult>) => {
      runningResults = runningResults.map((result) =>
        result.caseId === caseId ? { ...result, ...patch } : result
      );
      setVerificationResults([...runningResults]);
    };

    let evaluationDetail: EvaluationWithRelations | null = null;
    if (effectiveSelectedEvaluationId) {
      try {
        evaluationDetail = await evaluationsApi.getById(effectiveSelectedEvaluationId);
      } catch {
        evaluationDetail = null;
      }
    }

    const enabledCriteria: EvaluationCriterion[] = (evaluationDetail?.criteria || []).filter(
      (criterion) => criterion.enabled && (criterion.prompt || '').trim().length > 0
    );
    const judgeModelId = evaluationDetail?.judgeModelId || '';
    const passThreshold = evaluationDetail?.config?.pass_threshold ?? 0.6;
    const useJudgeEvaluation = Boolean(judgeModelId && enabledCriteria.length > 0);
    const testCaseById = new Map((evaluationDetail?.testCases || []).map((item) => [item.id, item]));
    const evaluationConfig = (evaluationDetail?.config || {}) as Record<string, unknown>;
    const evaluationFileProcessing =
      verificationFileProcessingOverride ?? resolveEvaluationFileProcessing(evaluationConfig);
    const evaluationOcrProvider =
      verificationOcrProviderOverride ?? resolveEvaluationOcrProvider(evaluationConfig);
    const verificationCaseConcurrency = resolveVerificationCaseConcurrency(
      evaluationConfig,
      selectedCases.length
    );
    // Verification prioritizes the current analysis model; evaluation model is fallback only.
    const verificationModelId = selectedModelId || evaluationDetail?.modelId || '';

    if (!verificationModelId) {
      setError(t('selectAnalyzeModelFirst'));
      setIsVerifying(false);
      return null;
    }
    const semanticJudgeModelId = verificationModelId;

    const verificationModel = models.find((item) => item.id === verificationModelId);
    const includeAttachmentRefs =
      resolveEffectiveAttachmentMode(evaluationFileProcessing, verificationModel?.supportsVision ?? true) !==
      'none';

    if (testCaseById.size > 0) {
      setVerificationCases((prev) =>
        prev.map((item) => {
          if (item.source !== 'evaluation' || !item.testCaseId) return item;
          const resolvedCase = testCaseById.get(item.testCaseId);
          if (!resolvedCase) return item;
          return {
            ...item,
            attachments: normalizeAttachments(resolvedCase.attachments),
          };
        })
      );
    }

    setVerificationMode(useJudgeEvaluation ? 'judge' : 'fallback');

    const verifyCase = async (testCase: VerificationCase) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      updateRunningResult(testCase.id, { status: 'running' });
      try {
        const evaluationTestCase = testCase.testCaseId ? testCaseById.get(testCase.testCaseId) : undefined;
        const caseInput = evaluationTestCase?.inputText ?? testCase.input;
        const caseVariables = (evaluationTestCase?.inputVariables as Record<string, string>) || testCase.inputVariables || {};
        const expectedOutput = evaluationTestCase?.expectedOutput ?? testCase.expectedOutput;
        const attachments = normalizeAttachments(evaluationTestCase?.attachments ?? testCase.attachments);
        updateRunningResult(testCase.id, {
          attachments,
          expectedOutput: expectedOutput || undefined,
        });
        const testMessages = buildCaseMessages(
          promptSnapshot.messages,
          promptSnapshot.content,
          caseInput,
          caseVariables
        );
        const modelMessages =
          includeAttachmentRefs && attachments.length > 0
            ? appendAttachmentsToMessages(testMessages, attachments)
            : testMessages;

        const response = await chatApi.complete({
          modelId: verificationModelId,
          messages: modelMessages,
          saveTrace: false,
          isEvalCase: true,
          fileProcessing: evaluationFileProcessing,
          ocrProvider: evaluationOcrProvider,
        }, signal);

        let afterScore: number | undefined;
        let afterPassed: boolean | undefined;
        let judgeFeedback: Record<string, string> | undefined;
        let criterionScores: Record<string, number> | undefined;
        const manualPassThreshold = toUnitPassThreshold(testCase.passThreshold);
        const currentPassThreshold =
          testCase.source === 'manual' ? manualPassThreshold : passThreshold;

        if (useJudgeEvaluation) {
          const evaluationResult = await evaluateOutputWithCriteria({
            judgeModelId,
            criteria: enabledCriteria,
            passThreshold,
            testInput: caseInput,
            expectedOutput,
            modelOutput: response.content,
            fallbackReason: t('evaluationFailed'),
            signal,
          });
          afterScore = Math.round(evaluationResult.weightedScore * 100);
          if (testCase.source === 'manual') {
            afterPassed = afterScore >= currentPassThreshold * 100;
          } else {
            afterPassed = evaluationResult.passed;
          }
          judgeFeedback = evaluationResult.feedback;
          criterionScores = evaluationResult.scores;
        } else {
          const normalizedExpected = (expectedOutput || '').trim();
          if (normalizedExpected) {
            const semanticResult = await evaluateOutputWithExpectedSemantic({
              judgeModelId: semanticJudgeModelId,
              passThreshold,
              testInput: caseInput,
              expectedOutput: normalizedExpected,
              modelOutput: response.content,
              fallbackReason: t('evaluationFailed'),
              signal,
            });

            afterScore = Math.round(semanticResult.score * 100);
            afterPassed = semanticResult.score >= currentPassThreshold;
            criterionScores = {
              semantic_match: semanticResult.score,
            };
            judgeFeedback = {
              semantic_match: semanticResult.reason,
            };

            if (afterScore === 0 && semanticResult.reason === t('evaluationFailed')) {
              const heuristicScore = scoreWithExpectedOutputHeuristic(response.content, normalizedExpected);
              if (typeof heuristicScore === 'number') {
                afterScore = heuristicScore;
                afterPassed = heuristicScore >= currentPassThreshold * 100;
                criterionScores = {
                  semantic_match: heuristicScore / 100,
                };
                judgeFeedback = {
                  semantic_match: t('autoEvaluationFallback'),
                };
              }
            }
          }
        }

        const beforeScore = testCase.beforeScore;
        const delta =
          typeof beforeScore === 'number' && typeof afterScore === 'number'
            ? afterScore - beforeScore
            : undefined;

        updateRunningResult(testCase.id, {
          output: response.content,
          attachments,
          expectedOutput: expectedOutput || undefined,
          afterScore,
          afterPassed,
          delta,
          judgeFeedback,
          criterionScores,
          status: 'completed',
        });
      } catch (verifyError) {
        if (isAbortError(verifyError) || signal?.aborted) {
          throw verifyError;
        }
        updateRunningResult(testCase.id, {
          status: 'error',
          attachments: normalizeAttachments(testCase.attachments),
          errorMessage: verifyError instanceof Error ? verifyError.message : t('executionFailed'),
        });
      }
    };

    try {
      let nextCaseIndex = 0;
      const workerCount = Math.min(selectedCases.length, verificationCaseConcurrency);
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (true) {
            if (signal?.aborted) {
              throw new DOMException('Aborted', 'AbortError');
            }
            const caseIndex = nextCaseIndex;
            nextCaseIndex += 1;
            if (caseIndex >= selectedCases.length) {
              break;
            }
            await verifyCase(selectedCases[caseIndex]);
          }
        })
      );
      return runningResults;
    } catch (verifyError) {
      if (isAbortError(verifyError) || signal?.aborted) {
        runningResults = runningResults.map((result) =>
          result.status === 'completed' || result.status === 'error'
            ? result
            : {
                ...result,
                status: 'error',
                errorMessage: t('runStopped'),
              }
        );
        setVerificationResults([...runningResults]);
        setError(t('runStopped'));
        throw new DOMException('Aborted', 'AbortError');
      }
      throw verifyError;
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRunVerification = async (
    casesOverride?: VerificationCase[],
    options?: { signal?: AbortSignal }
  ): Promise<VerificationResult[] | null> => {
    const externalSignal = options?.signal;
    const internalController = externalSignal ? null : chatApi.createAbortController();

    if (internalController) {
      verificationAbortControllerRef.current?.abort();
      verificationAbortControllerRef.current = internalController;
    }

    try {
      return await runVerification(casesOverride, {
        signal: externalSignal || internalController?.signal,
      });
    } catch (verifyError) {
      if (isAbortError(verifyError) || externalSignal?.aborted) {
        return null;
      }
      setError(verifyError instanceof Error ? verifyError.message : t('executionFailed'));
      return null;
    } finally {
      if (internalController && verificationAbortControllerRef.current === internalController) {
        verificationAbortControllerRef.current = null;
      }
    }
  };

  const handleRunVerificationByScope = () => {
    if (isVerifying) {
      handleAbortVerification();
      return;
    }

    const scopedCases = runScopeCases.map((item) => ({ ...item, selected: true }));
    if (scopedCases.length === 0) {
      setError(t('noEvaluationForVerify'));
      return;
    }

    void handleRunVerification(scopedCases);
  };

  const runAutoOptimizationPipeline = async () => {
    if (isAutoPipelineRunning || isVerifying || isOptimizing) return;

    const pipelineController = chatApi.createAbortController();
    autoPipelineAbortControllerRef.current?.abort();
    autoPipelineAbortControllerRef.current = pipelineController;
    const pipelineSignal = pipelineController.signal;

    setIsAutoPipelineRunning(true);
    setAutoPipelineRound(0);
    setAutoPipelineStatus(t('autoOptimizing'));
    setView('analysis');

    try {
      if (pipelineSignal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      let pipelineCases = verificationCases;
      if (!verificationInitialized) {
        pipelineCases = initVerificationCases({ switchView: false });
      }

      const manualCases = pipelineCases
        .filter((item) => item.source === 'manual' && item.selected && item.input.trim().length > 0)
        .map((item) => ({ ...item, selected: true }));
      const manualCasesWithExpected = manualCases.filter((item) => (item.expectedOutput || '').trim().length > 0);

      const hasEvaluation = Boolean(effectiveSelectedEvaluationId && evaluationSummary);
      const topFailureCases = hasEvaluation ? buildAutoTopFailureCases() : [];

      if (!hasEvaluation && manualCases.length === 0) {
        setAutoPipelineStatus(t('noEvaluationForVerify'));
        setView('verification');
        return;
      }

      if (!hasEvaluation && manualCasesWithExpected.length === 0) {
        setAutoPipelineStatus(t('autoPipelineNeedExpected'));
        setView('verification');
        return;
      }

      if (hasEvaluation && topFailureCases.length === 0 && manualCases.length === 0) {
        setAutoPipelineStatus(t('autoPipelineNoVerification'));
        setView('verification');
        return;
      }

      const split = splitTrainAndValidationCases(topFailureCases);
      let trainCases = split.train;
      const validationCases = split.validation;
      const maxRounds = clampAutoPipelineRounds(autoPipelineMaxRounds);
      const source: AutoOptimizeContext['source'] =
        hasEvaluation && manualCases.length > 0 ? 'mixed' : hasEvaluation ? 'evaluation' : 'manual';

      let optimizeContext: AutoOptimizeContext | undefined = undefined;
      const seedCases = dedupeVerificationCases([
        ...trainCases,
        ...validationCases,
        ...manualCases,
      ]).slice(0, AUTO_PIPELINE_TOP_FAILURE_LIMIT);

      if (seedCases.length > 0) {
        optimizeContext = {
          round: 1,
          maxRounds,
          source,
          trainCasesCount: trainCases.length,
          validationCasesCount: validationCases.length,
          manualCasesCount: manualCases.length,
          failedCases: seedCases.map((item) => ({
            caseName: item.name,
            input: item.input,
            expectedOutput: item.expectedOutput,
          })),
        };
      }

      for (let round = 1; round <= maxRounds; round++) {
        if (pipelineSignal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        setAutoPipelineRound(round);
        setAutoPipelineStatus(t('autoRoundLabel', { round }));

        const suggestionsInRound = await runOptimizeOnce(true, optimizeContext, {
          signal: pipelineSignal,
        });
        const candidates = suggestionsInRound.filter(
          (item) =>
            item.originalText &&
            item.suggestedText
        );
        const actionable = candidates.filter(
          (item) => item.severity === 'high' || item.severity === 'medium'
        );
        const fallbackActionable = candidates.filter((item) => item.severity === 'low');
        const toApply = actionable.length > 0
          ? actionable.slice(0, 4)
          : fallbackActionable.slice(0, 2);

        if (toApply.length === 0) {
          setAutoPipelineStatus(t('autoPipelineNoActionable'));
          break;
        }

        let appliedCount = 0;
        for (const item of toApply) {
          const result = handleApply(item);
          if (result.applied) {
            appliedCount += 1;
          }
        }
        if (appliedCount === 0) {
          setAutoPipelineStatus(t('autoPipelineNoApplied'));
          break;
        }

        setAutoPipelineStatus(t('autoPipelineApplied', { count: appliedCount }));
        await delayWithSignal(80, pipelineSignal);

        const roundCases = dedupeVerificationCases([
          ...trainCases.map((item) => ({ ...item, selected: true })),
          ...validationCases.map((item) => ({ ...item, selected: true })),
          ...manualCases.map((item) => ({ ...item, selected: true })),
        ]);
        setVerificationCases(roundCases);
        setView('verification');
        const verification = await handleRunVerification(roundCases, { signal: pipelineSignal });
        if (pipelineSignal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        if (!verification || verification.length === 0) {
          setAutoPipelineStatus(t('autoPipelineNoVerification'));
          break;
        }

        const completed = verification.filter((item) => item.status === 'completed');
        const comparablePass = completed.filter((item) => typeof item.afterPassed === 'boolean');
        const failedComparable = comparablePass.filter((item) => !item.afterPassed);
        const regressions = completed.filter((item) => item.beforePassed && !item.afterPassed).length;
        const improved = completed.filter((item) => !item.beforePassed && item.afterPassed).length;
        const comparable = completed.filter(
          (item) => typeof item.delta === 'number'
        );
        const avgDelta =
          comparable.length > 0
            ? comparable.reduce((sum, item) => sum + (item.delta || 0), 0) / comparable.length
            : 0;

        setAutoPipelineStatus(
          t('autoPipelineRoundSummary', {
            improved,
            regressions,
            delta: avgDelta.toFixed(1),
          })
        );

        if (comparablePass.length > 0 && failedComparable.length === 0) {
          setAutoPipelineStatus(t('autoPipelineDone'));
          break;
        }

        if (round >= maxRounds) {
          break;
        }

        if (hasEvaluation) {
          const roundCaseMap = new Map(roundCases.map((item) => [item.id, item]));
          const nextTrainCases = failedComparable
            .map((result) => roundCaseMap.get(result.caseId))
            .filter((item): item is VerificationCase => Boolean(item && item.source === 'evaluation'))
            .slice(0, AUTO_PIPELINE_TOP_FAILURE_LIMIT)
            .map((item) => ({
              ...item,
              selected: true,
            }));

          if (nextTrainCases.length > 0) {
            trainCases = nextTrainCases;
          }
        }

        const roundCaseMap = new Map(roundCases.map((item) => [item.id, item]));
        const failedCasesForNextRound = failedComparable
          .map((result) => {
            const caseInfo = roundCaseMap.get(result.caseId);
            return {
              caseName: result.caseName,
              input: caseInfo?.input,
              expectedOutput: result.expectedOutput || caseInfo?.expectedOutput,
              modelOutput: result.output,
              score: result.afterScore,
              reason: compactReason(result.judgeFeedback),
            };
          })
          .slice(0, AUTO_PIPELINE_TOP_FAILURE_LIMIT);

        optimizeContext = {
          round: round + 1,
          maxRounds,
          source,
          trainCasesCount: trainCases.length,
          validationCasesCount: validationCases.length,
          manualCasesCount: manualCases.length,
          failedCases: failedCasesForNextRound,
        };
      }

      setAutoPipelineStatus(t('autoPipelineDone'));
    } catch (pipelineError) {
      if (isAbortError(pipelineError) || pipelineSignal.aborted) {
        setAutoPipelineStatus(t('runStopped'));
      } else {
        setAutoPipelineStatus(
          pipelineError instanceof Error ? pipelineError.message : t('executionFailed')
        );
      }
    } finally {
      if (autoPipelineAbortControllerRef.current === pipelineController) {
        autoPipelineAbortControllerRef.current = null;
      }
      setIsAutoPipelineRunning(false);
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="grid gap-3 xl:grid-cols-3 mb-4">
        <div className="p-3 bg-slate-800/50 light:bg-slate-100 rounded-lg border border-slate-700 light:border-slate-200">
          <label className="block text-xs text-slate-400 light:text-slate-600 mb-2">
            {t('analyzeModel')}
          </label>
          <ModelSelector
            models={models}
            providers={providers}
            selectedModelId={selectedModelId}
            onSelect={onModelChange}
            placeholder={t('configureProviderFirst')}
          />
          <p className="text-xs text-slate-500 mt-1.5">{t('selectAnalyzeModel')}</p>
        </div>

        <div className="p-3 bg-slate-800/50 light:bg-slate-100 rounded-lg border border-slate-700 light:border-slate-200">
          <label className="block text-xs text-slate-400 light:text-slate-600 mb-2">
            {t('metaPromptTemplate')}
          </label>
          <div className="relative">
            <select
              value={selectedTemplate}
              onChange={(event) => handleTemplateChange(event.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-700/50 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            >
              {BUILTIN_META_PROMPTS.map((template) => (
                <option key={template.id} value={template.id}>
                  {t(template.labelKey, { defaultValue: template.id })}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
          <p className="text-xs text-slate-500 mt-1.5">{t('metaPromptTemplateDesc')}</p>
        </div>

        <div className="p-3 bg-slate-800/50 light:bg-slate-100 rounded-lg border border-slate-700 light:border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-cyan-400 light:text-cyan-600" />
            <label className="block text-xs text-slate-400 light:text-slate-600">
              {t('optimizationReference')}
            </label>
          </div>
          {evaluationList === undefined ? (
            <p className="text-xs text-slate-500">{t('loadingOptimizationReference')}</p>
          ) : evaluationList.length > 0 ? (
            <>
              <div className="relative">
                <select
                  value={effectiveSelectedEvaluationId}
                  onChange={(event) => onEvaluationSelect?.(event.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-700/50 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                >
                  <option value="">{t('noEvaluationSelected')}</option>
                  {evaluationList.map((evaluation) => (
                    <option key={evaluation.id} value={evaluation.id}>
                      {evaluation.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
              {evaluationSummary && (
                <div className="mt-2 p-2 bg-slate-700/30 light:bg-slate-50 rounded-lg text-xs">
                  {(() => {
                    const isPendingEvaluation = evaluationSummary.totalRuns === 0;
                    return (
                      <>
                  <div className="flex flex-wrap items-center gap-3 text-slate-300 light:text-slate-700">
                    <span>{t('basedOn')}: {evaluationSummary.modelName}</span>
                    <span>{t('judgeModel')}: {evaluationSummary.judgeModelName}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-3">
                    <span
                      className={`font-medium ${
                        isPendingEvaluation
                          ? 'text-slate-400 light:text-slate-600'
                          : evaluationSummary.avgPassRate >= 0.8
                          ? 'text-green-400'
                          : evaluationSummary.avgPassRate >= 0.5
                            ? 'text-amber-400'
                            : 'text-red-400'
                      }`}
                    >
                      {t('passRate')}:{' '}
                      {isPendingEvaluation
                        ? t('pending')
                        : `${(evaluationSummary.avgPassRate * 100).toFixed(1)}%`}
                    </span>
                    {!isPendingEvaluation && evaluationSummary.topFailures.length > 0 && (
                      <span className="text-red-400">
                        <BarChart3 className="w-3 h-3 inline mr-1" />
                        {t('highFreqFailures')}: {evaluationSummary.topFailures.length}
                      </span>
                    )}
                  </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-slate-500">
              <p>{t('noEvaluationLinked')}</p>
              <p className="mt-1">{t('staticAnalysisOnly')}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="inline-flex p-1 bg-slate-800/40 light:bg-slate-100 rounded-lg border border-slate-700 light:border-slate-200">
          <button
            type="button"
            onClick={() => setView('analysis')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              view === 'analysis'
                ? 'bg-cyan-500 text-white'
                : 'text-slate-400 light:text-slate-600 hover:text-slate-200 light:hover:text-slate-800'
            }`}
          >
            {t('analysisPanel')}
          </button>
          <button
            type="button"
            onClick={() => setView('preview')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              view === 'preview'
                ? 'bg-cyan-500 text-white'
                : 'text-slate-400 light:text-slate-600 hover:text-slate-200 light:hover:text-slate-800'
            }`}
          >
            {t('promptPreviewPanel')}
          </button>
          <button
            type="button"
            onClick={() => setView('verification')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              view === 'verification'
                ? 'bg-cyan-500 text-white'
                : 'text-slate-400 light:text-slate-600 hover:text-slate-200 light:hover:text-slate-800'
            }`}
          >
            {t('verificationPanel')}
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-slate-500 mr-1">
            {view === 'analysis'
              ? t('suggestionsCount', { count: displaySuggestions.length })
              : view === 'verification'
                ? t('selectedCasesCount', { count: selectedCaseCount })
                : t('promptPreviewForVerification')}
          </span>
          <Button
            variant={isStandaloneAnalyzing ? 'danger' : 'primary'}
            size="sm"
            onClick={isStandaloneAnalyzing ? handleAbortAnalyze : handleOptimize}
            className={
              isStandaloneAnalyzing
                ? undefined
                : 'from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 shadow-cyan-500/30'
            }
            disabled={
              !isStandaloneAnalyzing &&
              (isOptimizing || isAutoPipelineRunning || isVerifying || !hasContent || !selectedModelId)
            }
          >
            {isStandaloneAnalyzing ? (
              <StopIndicator label={t('stop')} />
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                {t('analyzePrompt')}
              </>
            )}
          </Button>
          <Button
            variant={isAutoPipelineRunning ? 'danger' : 'primary'}
            size="sm"
            onClick={isAutoPipelineRunning ? handleAbortAutoPipeline : runAutoOptimizationPipeline}
            className={
              isAutoPipelineRunning
                ? undefined
                : 'from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 shadow-emerald-500/30'
            }
            disabled={
              !isAutoPipelineRunning &&
              (isOptimizing || isVerifying || !hasContent || !selectedModelId)
            }
          >
            {isAutoPipelineRunning ? (
              <StopIndicator label={t('stop')} />
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                {t('autoOptimizeLoop')}
              </>
            )}
          </Button>
          <div className="flex items-center gap-2 px-2 py-1 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-800/40 light:bg-slate-100">
            <span className="text-xs text-slate-400 light:text-slate-600">
              {t('autoMaxRoundsLabel')}
            </span>
            <input
              type="number"
              min={AUTO_PIPELINE_MIN_ROUNDS}
              max={AUTO_PIPELINE_MAX_ROUNDS_LIMIT}
              step={1}
              value={autoPipelineMaxRounds}
              onChange={(event) => handleAutoPipelineMaxRoundsChange(event.target.value)}
              disabled={isAutoPipelineRunning}
              className="w-16 px-2 py-1 text-xs bg-slate-700/60 light:bg-white border border-slate-600 light:border-slate-300 rounded text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            />
          </div>
        </div>
      </div>

      {(isAutoPipelineRunning || autoPipelineStatus) && (
        <div className="mb-3 p-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 text-xs text-cyan-300 light:text-cyan-700">
          <div className="flex items-center gap-2">
            {isAutoPipelineRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            <span>
              {t('autoPipelineStatusLabel')}
              {autoPipelineRound > 0 ? ` (${t('autoRoundLabel', { round: autoPipelineRound })})` : ''}:
              {' '}
              {autoPipelineStatus}
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0">
        {view === 'analysis' ? (
          <div className="h-full overflow-y-auto pr-1">
            {!hasContent ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <Sparkles className="w-12 h-12 text-slate-600 light:text-slate-400 mb-4" />
                <h4 className="text-lg font-medium text-slate-300 light:text-slate-700 mb-2">
                  {t('addContentToOptimize')}
                </h4>
                <p className="text-sm text-slate-500 max-w-md">{t('writePromptFirstDesc')}</p>
              </div>
            ) : !hasAnalyzed && !analysisResult ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <Wand2 className="w-12 h-12 text-slate-600 light:text-slate-400 mb-4" />
                <h4 className="text-lg font-medium text-slate-300 light:text-slate-700 mb-2">
                  {t('readyToAnalyze')}
                </h4>
                <p className="text-sm text-slate-500 max-w-md mb-4">{t('clickAnalyzeDesc')}</p>
                <div className="grid grid-cols-2 gap-3 text-left max-w-md">
                  {Object.entries(SUGGESTION_TYPE_CONFIG).map(([type, config]) => (
                    <div
                      key={type}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg ${config.bgColor}`}
                    >
                      <span className={`text-sm ${config.color}`}>{t(config.labelKey)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <AlertCircle className="w-12 h-12 text-red-400 light:text-red-500 mb-4" />
                <h4 className="text-lg font-medium text-slate-300 light:text-slate-700 mb-2">
                  {t('analysisFailed')}
                </h4>
                <p className="text-sm text-red-400 light:text-red-500 mb-4">{error}</p>
                <Button variant="secondary" size="sm" onClick={handleOptimize}>
                  {t('retry')}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {analysisResult && (
                  <div className="bg-slate-800/50 light:bg-slate-100 rounded-lg p-4 border border-slate-700 light:border-slate-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Trophy className="w-5 h-5 text-amber-400" />
                        <span className="text-sm font-medium text-slate-300 light:text-slate-700">
                          {t('scoreResult')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-3xl font-bold ${getScoreColor(analysisResult.score)}`}>
                          {analysisResult.score}
                        </span>
                        <span className="text-slate-500">/100</span>
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full ${
                            analysisResult.score >= 90
                              ? 'text-green-400 bg-green-500/10'
                              : analysisResult.score >= 70
                                ? 'text-amber-400 bg-amber-500/10'
                                : 'text-red-400 bg-red-500/10'
                          }`}
                        >
                          {getScoreLabel(analysisResult.score)}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-400 light:text-slate-600">{analysisResult.summary}</p>
                  </div>
                )}

                {analysisResult && analysisResult.strengths.length > 0 && (
                  <div className="bg-green-500/5 light:bg-green-50 rounded-lg p-4 border border-green-500/20 light:border-green-200">
                    <div className="flex items-center gap-2 mb-3">
                      <Star className="w-5 h-5 text-green-400 light:text-green-600" />
                      <span className="text-sm font-medium text-green-400 light:text-green-700">
                        {t('strengths')}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {analysisResult.strengths.map((strength, index) => (
                        <li key={index} className="flex items-start gap-2 text-sm text-slate-300 light:text-slate-700">
                          <Check className="w-4 h-4 text-green-400 light:text-green-600 mt-0.5 flex-shrink-0" />
                          <span>{strength}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {displaySuggestions.length === 0 ? (
                  !hasUsableAnalysisResult && hasAnalyzed ? (
                    <div className="flex flex-col items-center justify-center text-center py-8">
                      <AlertCircle className="w-12 h-12 text-amber-400 light:text-amber-500 mb-4" />
                      <h4 className="text-lg font-medium text-slate-300 light:text-slate-700 mb-2">
                        {t('analysisNoOutputTitle')}
                      </h4>
                      <p className="text-sm text-slate-500 max-w-md mb-4">{t('analysisNoOutputDesc')}</p>
                      <Button variant="secondary" size="sm" onClick={handleOptimize}>
                        {t('retry')}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center py-8">
                      <Check className="w-12 h-12 text-green-400 light:text-green-500 mb-4" />
                      <h4 className="text-lg font-medium text-slate-300 light:text-slate-700 mb-2">
                        {t('excellentPerformance')}
                      </h4>
                      <p className="text-sm text-slate-500 max-w-md">{t('noSuggestionsDesc')}</p>
                    </div>
                  )
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-cyan-400 light:text-cyan-600" />
                      <span className="text-sm font-medium text-slate-300 light:text-slate-700">
                        {t('optimizationSuggestions')} ({displaySuggestions.length})
                      </span>
                    </div>

                    {displaySuggestions.map((suggestion) => {
                      const typeConfig = SUGGESTION_TYPE_CONFIG[suggestion.type];
                      const severityConfig = SEVERITY_CONFIG[suggestion.severity || 'medium'];
                      return (
                        <div
                          key={suggestion.id}
                          className={`p-4 rounded-lg border ${
                            suggestion.applied
                              ? 'border-green-500/30 bg-green-500/5'
                              : 'border-slate-700 light:border-slate-200 bg-slate-800/30 light:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2 gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`px-2 py-0.5 text-xs rounded-full ${typeConfig.bgColor} ${typeConfig.color}`}>
                                {t(typeConfig.labelKey)}
                              </span>
                              <span className={`px-2 py-0.5 text-xs rounded-full ${severityConfig.bgColor} ${severityConfig.color}`}>
                                {t('priority')}: {t(severityConfig.labelKey)}
                              </span>
                              <h4 className="text-sm font-medium text-slate-200 light:text-slate-800">
                                {suggestion.title}
                              </h4>
                            </div>

                            {suggestion.applied ? (
                              <span className="flex items-center gap-1 text-xs text-green-400 light:text-green-600">
                                <Check className="w-3 h-3" />
                                {t('applied')}
                              </span>
                            ) : (
                              <div className="flex gap-1">
                                {suggestion.originalText && suggestion.suggestedText && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleApply(suggestion)}
                                    className="text-xs text-green-400 hover:text-green-300"
                                  >
                                    <Check className="w-3 h-3" />
                                    {t('apply')}
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDismiss(suggestion.id)}
                                  className="text-xs text-slate-400 hover:text-slate-300"
                                >
                                  <X className="w-3 h-3" />
                                  {t('dismissSuggestion')}
                                </Button>
                              </div>
                            )}
                          </div>

                          <p className="text-sm text-slate-400 light:text-slate-600 mb-3">
                            {suggestion.description}
                          </p>

                          {suggestion.originalText && suggestion.suggestedText && (
                            <div className="space-y-2">
                              <div className="p-2 rounded bg-red-500/10 border border-red-500/20">
                                <div className="text-xs text-red-400 light:text-red-500 mb-1">
                                  {t('originalText')}
                                </div>
                                <div className="text-sm text-slate-300 light:text-slate-700 line-through opacity-60">
                                  {suggestion.originalText}
                                </div>
                              </div>
                              <div className="flex justify-center">
                                <ArrowRight className="w-4 h-4 text-slate-500" />
                              </div>
                              <div className="p-2 rounded bg-green-500/10 border border-green-500/20">
                                <div className="text-xs text-green-400 light:text-green-500 mb-1">
                                  {t('suggestedText')}
                                </div>
                                <div className="text-sm text-slate-300 light:text-slate-700">
                                  {suggestion.suggestedText}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {analysisResult && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => initVerificationCases()}
                    className="w-full"
                  >
                    <FlaskConical className="w-4 h-4" />
                    {t('openVerificationWorkbench')}
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : view === 'preview' ? (
          <div className="h-full overflow-y-auto pr-1">
            <div className="p-4 bg-slate-800/50 light:bg-slate-100 rounded-lg border border-slate-700 light:border-slate-200">
              <div className="relative rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white overflow-hidden">
                <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setIsPromptPreviewCollapsed((prev) => !prev)}
                    className="p-1 rounded hover:bg-slate-800/60 light:hover:bg-slate-100 text-slate-400 light:text-slate-600"
                    title={isPromptPreviewCollapsed ? t('expandPreview') : t('collapsePreview')}
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isPromptPreviewCollapsed ? '-rotate-90' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyPromptPreview()}
                    className="p-1 rounded hover:bg-slate-800/60 light:hover:bg-slate-100 text-slate-400 light:text-slate-600"
                    title={isPromptPreviewCopied ? t('previewCopied') : t('copyPreview')}
                    disabled={!promptPreview.trim()}
                  >
                    {isPromptPreviewCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={togglePromptPreviewFullscreen}
                    className="p-1 rounded hover:bg-slate-800/60 light:hover:bg-slate-100 text-slate-400 light:text-slate-600"
                    title={t('fullscreenPreview')}
                    disabled={!promptPreview.trim()}
                  >
                    {isPromptPreviewFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {!isPromptPreviewCollapsed ? (
                  <div ref={promptPreviewScrollRef} className="max-h-[72vh] overflow-y-auto pt-6 pb-3 px-3">
                    <OutputRenderer
                      content={promptPreview || t('emptyPromptPreview')}
                      preferences={{ format: 'auto' }}
                      className="text-sm leading-6"
                    />
                  </div>
                ) : (
                  <div className="pt-2 pb-2 px-2 pr-24 text-xs text-slate-500">
                    {t('previewCollapsedHint')}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : !verificationInitialized ? (
          <div className="h-full flex items-center justify-center">
            <div className="max-w-lg text-center">
              <FlaskConical className="w-12 h-12 mx-auto text-cyan-400 mb-3" />
              <h4 className="text-lg font-medium text-slate-300 light:text-slate-700 mb-2">
                {t('verificationPanel')}
              </h4>
              <p className="text-sm text-slate-500 mb-4">{t('verificationPanelDesc')}</p>
              <Button variant="secondary" size="sm" onClick={() => initVerificationCases()}>
                {t('loadVerificationCases')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="h-full grid gap-3 grid-rows-[auto_1fr]">
            <div className="p-3 bg-slate-800/50 light:bg-slate-100 rounded-lg border border-slate-700 light:border-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xs text-slate-400 light:text-slate-600">{t('runScopeLabel')}</div>
                {[
                  { key: 'all' as VerificationRunScope, label: t('selectAllCases') },
                  { key: 'failed' as VerificationRunScope, label: t('selectFailedCases') },
                  { key: 'regression' as VerificationRunScope, label: t('regressionCount') },
                  { key: 'custom' as VerificationRunScope, label: t('customScope') },
                ].map((scope) => (
                  <button
                    key={scope.key}
                    type="button"
                    onClick={() => setVerificationRunScope(scope.key)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      verificationRunScope === scope.key
                        ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200 light:border-cyan-500 light:bg-cyan-50 light:text-cyan-700'
                        : 'border-slate-700 light:border-slate-300 text-slate-400 light:text-slate-600 hover:text-slate-200 light:hover:text-slate-800'
                    }`}
                  >
                    {scope.label}
                  </button>
                ))}
                <Button
                  variant={isVerifying ? 'danger' : 'primary'}
                  size="sm"
                  onClick={handleRunVerificationByScope}
                  disabled={
                    !isVerifying &&
                    (runScopeCases.length === 0 || isAutoPipelineRunning || isOptimizing)
                  }
                >
                  {isVerifying ? (
                    <StopIndicator label={t('stop')} />
                  ) : (
                    <>
                      <FlaskConical className="w-4 h-4" />
                      {t('runAndEvaluateCount', { count: runScopeCases.length })}
                    </>
                  )}
                </Button>

                <span className="ml-auto text-xs text-slate-500">
                  {t('selectedCasesCount', { count: runScopeCases.length })}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={openCaseManager}
                >
                  {t('caseManager')}
                </Button>
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto p-4 bg-slate-800/50 light:bg-slate-100 rounded-lg border border-slate-700 light:border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-cyan-400 light:text-cyan-600" />
                  <span className="text-sm font-medium text-slate-200 light:text-slate-800">
                    {t('verificationResults')}
                  </span>
                </div>
                <Badge variant={verificationMode === 'judge' ? 'success' : 'warning'}>
                  {verificationMode === 'judge'
                    ? t('autoEvaluationJudge')
                    : verificationMode === 'fallback'
                      ? t('autoEvaluationFallback')
                      : t('autoEvaluationPending')}
                </Badge>
              </div>
              <div className="mb-3 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white px-2.5 py-2 text-[11px] text-slate-500 light:text-slate-600 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-slate-400 light:text-slate-700 shrink-0">
                  <Paperclip className="w-3.5 h-3.5" />
                  {tEvaluation('fileProcessing')}:
                </span>
                <select
                  value={verificationFileProcessingOverride ?? ''}
                  onChange={(event) => handleVerificationFileProcessingChange(event.target.value)}
                  disabled={isVerifying || isAutoPipelineRunning}
                  className="h-7 min-w-[140px] rounded border border-slate-700 light:border-slate-300 bg-slate-900/60 light:bg-white px-2 text-[11px] text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:opacity-60"
                >
                  <option value="">
                    {`${t('default')} (${tEvaluation(getFileProcessingLabelKey(currentVerificationAttachmentHandling.configuredMode))})`}
                  </option>
                  {FILE_PROCESSING_MODES.map((mode) => (
                    <option key={`verification_file_processing_${mode}`} value={mode}>
                      {tEvaluation(getFileProcessingLabelKey(mode))}
                    </option>
                  ))}
                </select>
                <span className="text-slate-400 light:text-slate-700">
                  {'->'} {tEvaluation(getFileProcessingLabelKey(currentVerificationAttachmentHandling.effectiveMode))}
                </span>
                {currentVerificationAttachmentHandling.effectiveMode === 'ocr' && (
                  <>
                    <span className="text-slate-400 light:text-slate-700">OCR:</span>
                    <select
                      value={verificationOcrProviderOverride ?? ''}
                      onChange={(event) => handleVerificationOcrProviderChange(event.target.value)}
                      disabled={isVerifying || isAutoPipelineRunning}
                      className="h-7 min-w-[150px] rounded border border-slate-700 light:border-slate-300 bg-slate-900/60 light:bg-white px-2 text-[11px] text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:opacity-60"
                    >
                      <option value="">
                        {`${t('default')} (${currentVerificationAttachmentHandling.ocrProvider ? getOcrProviderLabel(currentVerificationAttachmentHandling.ocrProvider) : tEvaluation('ocrProviderFollow')})`}
                      </option>
                      {OCR_PROVIDERS.map((provider) => (
                        <option key={`verification_ocr_provider_${provider}`} value={provider}>
                          {getOcrProviderLabel(provider)}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <span className="ml-auto">
                  {t('attachments')}: {currentVerificationAttachmentHandling.attachmentCount}
                </span>
              </div>

              {verificationResults.length > 0 ? (
                <>
                  <div className="grid gap-2 grid-cols-2 lg:grid-cols-4 mb-3">
                    <div className="p-2 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white">
                      <div className="text-xs text-slate-500">{t('beforePassRate')}</div>
                      <div className="text-base font-medium text-slate-200 light:text-slate-800">
                        {verificationSummary.beforePassRate === null
                          ? '-'
                          : `${(verificationSummary.beforePassRate * 100).toFixed(1)}%`}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white">
                      <div className="text-xs text-slate-500">{t('afterPassRate')}</div>
                      <div className="text-base font-medium text-slate-200 light:text-slate-800">
                        {verificationSummary.afterPassRate === null
                          ? '-'
                          : `${(verificationSummary.afterPassRate * 100).toFixed(1)}%`}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white">
                      <div className="text-xs text-slate-500">{t('avgScoreDelta')}</div>
                      <div
                        className={`text-base font-medium ${
                          (verificationSummary.averageScoreDelta || 0) >= 0
                            ? 'text-green-400'
                            : 'text-red-400'
                        }`}
                      >
                        {verificationSummary.averageScoreDelta === null
                          ? '-'
                          : `${verificationSummary.averageScoreDelta >= 0 ? '+' : ''}${verificationSummary.averageScoreDelta.toFixed(1)}`}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white">
                      <div className="text-xs text-slate-500">{t('regressionCount')}</div>
                      <div className="text-base font-medium text-slate-200 light:text-slate-800">
                        {verificationSummary.regressions}
                      </div>
                    </div>
                  </div>

                  {verificationSummary.passRateDelta !== null && (
                    <div
                      className={`mb-3 p-2 rounded-lg border text-xs ${
                        verificationSummary.passRateDelta >= 0
                          ? 'border-green-500/20 bg-green-500/10 text-green-400'
                          : 'border-red-500/20 bg-red-500/10 text-red-400'
                      }`}
                    >
                      {t('passRateChangeLabel')}:{' '}
                      {verificationSummary.passRateDelta >= 0 ? '+' : ''}
                      {(verificationSummary.passRateDelta * 100).toFixed(1)}%,
                      {' '}
                      {t('improvedCount')}: {verificationSummary.improved},
                      {' '}
                      {t('regressionCount')}: {verificationSummary.regressions}
                    </div>
                  )}

                  <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/20 light:bg-white overflow-hidden">
                    <div className="max-h-[52vh] overflow-auto">
                      <table className="w-full text-xs table-fixed">
                        <thead className="sticky top-0 z-10 bg-slate-900/95 light:bg-slate-50/95 backdrop-blur border-b border-slate-700 light:border-slate-200">
                          <tr className="text-slate-400 light:text-slate-600">
                            <th className="w-8 py-2 px-1 text-center" />
                            <th className="w-[240px] text-left py-2 pr-2">{t('caseName')}</th>
                            <th className="w-16 text-center py-2 px-1">{t('before')}</th>
                            <th className="w-16 text-center py-2 px-1">{t('after')}</th>
                            <th className="w-16 text-center py-2 px-1">{t('delta')}</th>
                            <th className="w-24 text-left py-2 pl-2">{t('status')}</th>
                            <th className="text-left py-2 pl-2 pr-2">{t('judgeFeedbackDetails')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {verificationResults.map((result) => {
                            const isExpanded = expandedResultCaseId === result.caseId;
                            const criterionEntries = Object.entries(result.criterionScores || {});
                            const feedbackEntries = Object.entries(result.judgeFeedback || {});
                            const caseAttachments = result.attachments || [];
                            const feedbackSummary = feedbackEntries
                              .map(([name, feedback]) => {
                                const label = name === 'semantic_match' ? t('expectedOutput') : name;
                                const text = String(feedback || '').replace(/\s+/g, ' ').trim();
                                if (!text) return '';
                                return `${label}: ${text}`;
                              })
                              .filter(Boolean)
                              .join(' | ');
                            const feedbackPreview = feedbackSummary || result.errorMessage || '-';
                            const statusText =
                              result.status === 'completed'
                                ? result.afterPassed
                                  ? t('success')
                                  : t('error')
                                : result.status === 'running'
                                  ? t('verifying')
                                  : result.status === 'error'
                                    ? t('error')
                                    : t('pending');

                            return (
                              <Fragment key={result.caseId}>
                                <tr
                                  className={`border-b border-slate-700/50 light:border-slate-100 cursor-pointer hover:bg-slate-800/40 light:hover:bg-slate-50 ${
                                    isExpanded ? 'bg-slate-800/30 light:bg-slate-50/70' : ''
                                  }`}
                                  onClick={() =>
                                    setExpandedResultCaseId((prev) =>
                                      prev === result.caseId ? null : result.caseId
                                    )
                                  }
                                >
                                  <td className="py-2 px-1 text-center">
                                    <ChevronDown
                                      className={`w-3.5 h-3.5 inline text-slate-500 transition-transform ${
                                        isExpanded ? 'rotate-180' : ''
                                      }`}
                                    />
                                  </td>
                                  <td className="py-2 pr-2 text-slate-300 light:text-slate-700">
                                    <div className="truncate" title={result.caseName}>
                                      {result.caseName}
                                    </div>
                                  </td>
                                  <td className="py-2 px-1 text-center">
                                    {typeof result.beforeScore === 'number' ? (
                                      <span className={result.beforeScore >= 80 ? 'text-green-400' : 'text-red-400'}>
                                        {result.beforeScore}
                                      </span>
                                    ) : (
                                      <span className="text-slate-500">-</span>
                                    )}
                                  </td>
                                  <td className="py-2 px-1 text-center">
                                    {result.status === 'completed' && typeof result.afterScore === 'number' ? (
                                      <span className={result.afterScore >= 80 ? 'text-green-400' : 'text-amber-400'}>
                                        {result.afterScore}
                                      </span>
                                    ) : result.status === 'running' ? (
                                      <Loader2 className="w-3 h-3 animate-spin inline text-cyan-400" />
                                    ) : result.status === 'error' ? (
                                      <span className="text-red-400">-</span>
                                    ) : (
                                      <span className="text-slate-500">-</span>
                                    )}
                                  </td>
                                  <td className="py-2 px-1 text-center">
                                    {typeof result.delta === 'number' ? (
                                      <span className={result.delta >= 0 ? 'text-green-400' : 'text-red-400'}>
                                        {result.delta >= 0 ? '+' : ''}
                                        {result.delta.toFixed(0)}
                                      </span>
                                    ) : (
                                      <span className="text-slate-500">-</span>
                                    )}
                                  </td>
                                  <td className="py-2 pl-2">
                                    <div className="inline-flex items-center gap-1">
                                      {result.status === 'completed' && result.afterPassed === true ? (
                                        <Check className="w-3 h-3 text-green-400" />
                                      ) : result.status === 'completed' && result.afterPassed === false ? (
                                        <X className="w-3 h-3 text-red-400" />
                                      ) : result.status === 'running' ? (
                                        <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                                      ) : result.status === 'error' ? (
                                        <AlertCircle className="w-3 h-3 text-red-400" />
                                      ) : (
                                        <span className="w-3 h-3 inline-block rounded-full bg-slate-500/40" />
                                      )}
                                      <span className="text-slate-400 light:text-slate-600">{statusText}</span>
                                    </div>
                                  </td>
                                  <td className="py-2 pl-2 pr-2">
                                    <div
                                      className="block w-full text-[11px] leading-4 text-slate-500 light:text-slate-600 truncate"
                                      title={feedbackPreview === '-' ? undefined : feedbackPreview}
                                    >
                                      {feedbackPreview}
                                    </div>
                                  </td>
                                </tr>

                                {isExpanded && (
                                  <tr className="border-b border-slate-700/50 light:border-slate-100 bg-slate-900/35 light:bg-slate-50/80">
                                    <td colSpan={7} className="px-3 py-3">
                                      <div className="grid gap-3 lg:grid-cols-2 mb-3">
                                        <div className="rounded border border-slate-700 light:border-slate-200 bg-slate-900/20 light:bg-white p-2">
                                          <div className="text-slate-400 light:text-slate-600 mb-1">{t('expectedOutput')}</div>
                                          <div className="text-slate-300 light:text-slate-700 whitespace-pre-wrap break-words max-h-36 overflow-y-auto">
                                            {result.expectedOutput || '-'}
                                          </div>
                                        </div>
                                        <div className="rounded border border-slate-700 light:border-slate-200 bg-slate-900/20 light:bg-white p-2">
                                          <div className="text-slate-400 light:text-slate-600 mb-1">{t('modelOutputPreview')}</div>
                                          <div className="text-slate-300 light:text-slate-700 whitespace-pre-wrap break-words max-h-36 overflow-y-auto">
                                            {result.output ||
                                              (result.status === 'running'
                                                ? t('verifying')
                                                : result.errorMessage || '-')}
                                      </div>
                                    </div>
                                  </div>

                                      {caseAttachments.length > 0 && (
                                        <div className="mb-3">
                                          <div className="text-slate-400 light:text-slate-600 mb-1">{t('attachments')}</div>
                                          <div className="grid gap-1 sm:grid-cols-2">
                                            {caseAttachments.map((attachment) => (
                                              <button
                                                type="button"
                                                key={`${result.caseId}_${attachment.fileId}`}
                                                onClick={() => setPreviewAttachment(attachment)}
                                                className="rounded border border-slate-700/80 light:border-slate-200 bg-slate-900/20 light:bg-white px-2 py-1.5 flex items-center justify-between gap-2"
                                              >
                                                <span
                                                  className="text-slate-300 light:text-slate-700 truncate"
                                                  title={attachment.name}
                                                >
                                                  {attachment.name}
                                                </span>
                                                <span className="text-[11px] text-slate-500 shrink-0">
                                                  {attachment.type}
                                                </span>
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      {criterionEntries.length > 0 && (
                                        <div className="mb-3">
                                          <div className="text-slate-400 light:text-slate-600 mb-1">{t('criterionScores')}</div>
                                          <div className="grid gap-1 sm:grid-cols-2">
                                            {criterionEntries.map(([name, score]) => (
                                              <div
                                                key={`${result.caseId}_${name}_score`}
                                                className="rounded border border-slate-700/80 light:border-slate-200 bg-slate-900/20 light:bg-white px-2 py-1.5 flex items-center justify-between"
                                              >
                                                <span className="text-slate-300 light:text-slate-700">
                                                  {name === 'semantic_match' ? t('expectedOutput') : name}
                                                </span>
                                                <span className="text-cyan-300 light:text-cyan-700">
                                                  {Math.round(score * 100)}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      {feedbackEntries.length > 0 && (
                                        <div>
                                          <div className="text-slate-400 light:text-slate-600 mb-1">{t('judgeFeedbackDetails')}</div>
                                          <div className="space-y-2">
                                            {feedbackEntries.map(([name, feedback]) => (
                                              <div
                                                key={`${result.caseId}_${name}_feedback`}
                                                className="rounded border border-slate-700/80 light:border-slate-200 bg-slate-900/20 light:bg-white px-2 py-1.5"
                                              >
                                                <div className="text-slate-400 light:text-slate-600">
                                                  {name === 'semantic_match' ? t('expectedOutput') : name}
                                                </div>
                                                <div className="mt-0.5 text-slate-300 light:text-slate-700 whitespace-pre-wrap break-words">
                                                  {feedback}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="min-h-[44vh] flex items-center justify-center">
                  <div className="w-full max-w-xl p-5 rounded-xl border border-dashed border-slate-700/70 light:border-slate-300 bg-slate-900/20 light:bg-white text-center">
                    <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-cyan-500/12 text-cyan-300 light:text-cyan-600 flex items-center justify-center">
                      <BarChart3 className="w-5 h-5" />
                    </div>
                    <h4 className="text-sm font-medium text-slate-200 light:text-slate-800">
                      {t('autoEvaluationPending')}
                    </h4>
                    <p className="mt-1 text-xs text-slate-500 light:text-slate-600">
                      {runScopeCases.length === 0 ? t('noEvaluationForVerify') : t('verificationPanelDesc')}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                      <Button
                        variant={isVerifying ? 'danger' : 'primary'}
                        size="sm"
                        onClick={handleRunVerificationByScope}
                        disabled={
                          !isVerifying &&
                          (runScopeCases.length === 0 || isAutoPipelineRunning || isOptimizing)
                        }
                      >
                        {isVerifying ? (
                          <StopIndicator label={t('stop')} />
                        ) : (
                          <>
                            <FlaskConical className="w-4 h-4" />
                            {t('runAndEvaluateCount', { count: runScopeCases.length })}
                          </>
                        )}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={openCaseManager}
                      >
                        {t('caseManager')}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={isCaseManagerOpen}
        onClose={handleCancelCaseManager}
        title={t('caseManager')}
        size="2xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={selectAllCases}
              disabled={caseManagerBusy || caseManagerDraftCases.length === 0}
            >
              {t('selectAllCases')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={selectFailedCases}
              disabled={caseManagerBusy || caseManagerDraftCases.length === 0}
            >
              {t('selectFailedCases')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearCaseSelection}
              disabled={caseManagerBusy || caseManagerSelectedCount === 0}
            >
              {t('clearCaseSelection')}
            </Button>
            <span className="ml-auto text-xs text-slate-500 light:text-slate-600">
              {t('selectedCasesCount', { count: caseManagerSelectedCount })}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/20 light:bg-white px-2 py-2">
            <span className="text-xs text-slate-500 light:text-slate-600">{tCommon('search')}</span>
            <input
              type="text"
              value={caseManagerFilterKeyword}
              onChange={(event) => setCaseManagerFilterKeyword(event.target.value)}
              disabled={caseManagerBusy}
              placeholder={`${tCommon('search')}...`}
              className="min-w-[220px] flex-1 px-2 py-1 text-xs bg-slate-900/60 light:bg-white border border-slate-700 light:border-slate-300 rounded text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-800/40 light:bg-slate-50 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-300 light:text-slate-700">
                  {t('fromEvaluation')}
                </span>
                <span className="text-xs text-slate-500">{evaluationVerificationCases.length}</span>
              </div>
              <div className="max-h-[56vh] overflow-y-auto pr-1 space-y-1.5">
                {filteredEvaluationVerificationCases.length === 0 ? (
                  <div className="text-xs text-slate-500">{t('noEvaluationForVerify')}</div>
                ) : (
                  filteredEvaluationVerificationCases.map((item) => (
                    <label
                      key={item.id}
                      className="flex items-start gap-2 rounded border border-slate-700/80 light:border-slate-200 px-2 py-1.5 cursor-pointer hover:bg-slate-700/30 light:hover:bg-white"
                    >
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={() => toggleCaseSelection(item.id)}
                        disabled={caseManagerBusy}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500/50"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-slate-200 light:text-slate-800 truncate" title={item.name}>
                          {item.name}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {item.isFailed ? t('selectFailedCases') : t('passRate')}
                          {typeof item.historicalPassRate === 'number'
                            ? ` ${(item.historicalPassRate * 100).toFixed(0)}%`
                            : ''}
                          {item.attachments && item.attachments.length > 0
                            ? ` | ${t('attachments')} ${item.attachments.length}`
                            : ''}
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {typeof item.beforeScore === 'number' ? `${t('before')}: ${item.beforeScore}` : '-'}
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-800/40 light:bg-slate-50 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-300 light:text-slate-700">
                  {t('manualCases')}
                </span>
                <span className="text-xs text-slate-500">{manualVerificationCases.length}</span>
              </div>

              <div className="space-y-2 mb-3">
                <textarea
                  value={caseManagerManualInput}
                  onChange={(event) => setCaseManagerManualInput(event.target.value)}
                  placeholder={t('inputPlaceholder')}
                  rows={3}
                  disabled={caseManagerBusy}
                  className="w-full px-2 py-1.5 text-xs bg-slate-900/60 light:bg-white border border-slate-700 light:border-slate-300 rounded text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                />
                <textarea
                  value={caseManagerManualExpected}
                  onChange={(event) => setCaseManagerManualExpected(event.target.value)}
                  placeholder={t('expectedOutput')}
                  rows={2}
                  disabled={caseManagerBusy}
                  className="w-full px-2 py-1.5 text-xs bg-slate-900/60 light:bg-white border border-slate-700 light:border-slate-300 rounded text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-400 light:text-slate-600 shrink-0">
                    {t('manualPassThreshold')}
                  </label>
                  <input
                    type="number"
                    min={MANUAL_PASS_THRESHOLD_MIN_PERCENT}
                    max={MANUAL_PASS_THRESHOLD_MAX_PERCENT}
                    step={1}
                    value={caseManagerManualPassThreshold}
                    onChange={(event) => handleManualPassThresholdInput(event.target.value)}
                    disabled={caseManagerBusy}
                    className="w-20 px-2 py-1 text-xs bg-slate-900/60 light:bg-white border border-slate-700 light:border-slate-300 rounded text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                  />
                  <span className="text-xs text-slate-500">%</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={addManualCase}
                    disabled={caseManagerBusy || !caseManagerManualInput.trim()}
                    className="ml-auto"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('addCase')}
                  </Button>
                </div>
              </div>

              <div className="max-h-[34vh] overflow-y-auto pr-1 space-y-1.5">
                {manualVerificationCases.length === 0 ? (
                  <div className="text-xs text-slate-500">-</div>
                ) : (
                  manualVerificationCases.map((item) => (
                    <div
                      key={item.id}
                      className="rounded border border-slate-700/80 light:border-slate-200 px-2 py-2 bg-slate-900/20 light:bg-white"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => toggleCaseSelection(item.id)}
                          disabled={caseManagerBusy}
                          className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500/50"
                        />
                        <div className="min-w-0 flex-1 text-xs text-slate-200 light:text-slate-800 truncate" title={item.name}>
                          {item.name}
                        </div>
                        <input
                          type="number"
                          min={MANUAL_PASS_THRESHOLD_MIN_PERCENT}
                          max={MANUAL_PASS_THRESHOLD_MAX_PERCENT}
                          step={1}
                          value={Math.round(toUnitPassThreshold(item.passThreshold) * 100)}
                          onChange={(event) =>
                            handleManualCaseThresholdChange(item.id, event.target.value)
                          }
                          disabled={caseManagerBusy}
                          className="w-16 px-1.5 py-0.5 text-[11px] bg-slate-800/60 light:bg-white border border-slate-700 light:border-slate-300 rounded text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                        />
                        <span className="text-[11px] text-slate-500">%</span>
                        <button
                          type="button"
                          onClick={() => removeManualCase(item.id)}
                          disabled={caseManagerBusy}
                          className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-700/40 disabled:opacity-50"
                          title={t('deleteRecord')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 light:text-slate-600 whitespace-pre-wrap break-words max-h-20 overflow-y-auto">
                        {item.input}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={handleCancelCaseManager}>
              {tCommon('cancel')}
            </Button>
            <Button variant="primary" size="sm" onClick={handleSubmitCaseManager} disabled={caseManagerBusy}>
              {tCommon('submit')}
            </Button>
          </div>
        </div>
      </Modal>

      {isPromptPreviewFullscreen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 p-4">
          <div className="h-full rounded-xl border border-slate-700 bg-slate-900 relative overflow-hidden">
            <div className="absolute top-3 left-3 text-xs text-slate-300 z-10">
              {t('promptPreviewForVerification')}
            </div>
            <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1">
              <button
                type="button"
                onClick={() => void handleCopyPromptPreview()}
                className="p-1.5 rounded hover:bg-slate-700 text-slate-300"
                title={isPromptPreviewCopied ? t('previewCopied') : t('copyPreview')}
              >
                {isPromptPreviewCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={togglePromptPreviewFullscreen}
                className="p-1.5 rounded hover:bg-slate-700 text-slate-300"
                title={t('exitFullscreenPreview')}
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            </div>
            <div ref={promptPreviewFullscreenScrollRef} className="h-full overflow-auto pt-10 px-3 pb-3">
              <OutputRenderer
                content={promptPreview || t('emptyPromptPreview')}
                preferences={{ format: 'auto' }}
                className="text-base leading-7"
              />
            </div>
          </div>
        </div>
      )}

      <AttachmentModal
        attachment={previewAttachment}
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}


