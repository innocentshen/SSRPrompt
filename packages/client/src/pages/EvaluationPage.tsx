import { useState, useEffect, useCallback, useRef, useMemo, type DragEvent, type CSSProperties } from 'react';
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
  Upload,
  Pencil,
  Check,
  X,
  Globe,
  Lock,
  Link,
  Search,
  RotateCcw,
} from 'lucide-react';
import { Button, Input, Modal, Badge, Select, Checkbox, useToast, ModelSelector, MarkdownRenderer, Collapsible, StopIndicator } from '../components/ui';
import { PromptCascader } from '../components/Common/PromptCascader';
import { TestCaseList, CriteriaEditor, EvaluationResultsView, RunHistory, resetRunHistoryDateRangeCache } from '../components/Evaluation';
import { ParameterPanel } from '../components/Prompt/ParameterPanel';
import { evaluationsApi, runsApi, testCasesApi, criteriaApi, promptsApi, promptGroupsApi, providersApi, modelsApi, filesApi, evaluationImportsApi, evaluationAnalysisReportsApi, shareApi, type EvaluationWithRelations } from '../api';
import { chatApi, type ContentPart } from '../api/chat';
import type { FileAttachment } from '../lib/ai-service';
import { getFileUploadCapabilities } from '../lib/model-capabilities';
import { cacheEvents } from '../lib/cache-events';
import { formatDateTime } from '../lib/date-utils';
import { getErrorMessage } from '../lib/error-messages';
import { buildExpiresAtByPreset, generateSharePassword, getShareExpirePreset, type ShareExpirePreset } from '../lib/share-link-settings';
import { buildOcrProviderOptions, useEnabledOcrProviders } from '../hooks/useEnabledOcrProviders';
import { calculateAiCost, formatUsdCost, formatUsdCostFormula } from '../lib/cost';
import {
  analyzeMultipleRuns,
  analyzeSingleRun,
  buildAnalysisInputMessage,
  buildDefaultAnalysisPrompt,
  buildEvaluationAnalysisMarkdown,
  sanitizeAnalysisMarkdown,
  type EvaluationAnalysisData,
  type ModelProfile,
  type PromptProfile,
  type OcrProviderProfile,
  type JudgeModelProfile,
  type RecommendedSetup,
} from '../lib/evaluation-analysis';
import { DEFAULT_PROMPT_CONFIG } from '../types';
import { useAuthStore } from '../store/useAuthStore';
import { useAnalysisTaskStore } from '../store/useAnalysisTaskStore';
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
  ShareLink,
  EvaluationAnalysisReport,
  EvaluationAnalysisScope,
} from '../types';

const statusConfig: Record<EvaluationStatus, { labelKey: string; variant: 'info' | 'warning' | 'success' | 'error' }> = {
  pending: { labelKey: 'pending', variant: 'info' },
  running: { labelKey: 'running', variant: 'warning' },
  completed: { labelKey: 'completed', variant: 'success' },
  failed: { labelKey: 'failed', variant: 'error' },
};

const importStageLabelKeyMap: Record<string, string> = {
  pending: 'importStagePending',
  starting: 'importStageStarting',
  parsing_zip: 'importStageParsingZip',
  parsing_excel: 'importStageParsingExcel',
  resetting_evaluation: 'importStageResettingEvaluation',
  importing_criteria: 'importStageImportingCriteria',
  importing_test_cases: 'importStageImportingTestCases',
  completed: 'importStageCompleted',
  failed: 'importStageFailed',
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

function readImportProgressNumber(progress: Record<string, unknown> | null | undefined, key: string): number {
  const value = progress ? progress[key] : undefined;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function readImportProgressString(progress: Record<string, unknown> | null | undefined, key: string): string {
  const value = progress ? progress[key] : undefined;
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

function formatImportJobError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const record = err as { message?: unknown };
    if (typeof record.message === 'string') return record.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizeJudgeScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 0) return 0;
    if (value > 0 && value < 1) return clampScore(value);
    if (value <= 10) return clampScore(value / 10);
    if (value <= 100) return clampScore(value / 100);
    return 1;
  }

  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return null;
  if (parsed === 0) return 0;
  if (parsed > 0 && parsed < 1) return clampScore(parsed);
  if (parsed <= 10) return clampScore(parsed / 10);
  if (parsed <= 100) return clampScore(parsed / 100);
  return 1;
}

function extractStructuredTextScore(content: string): number | null {
  const text = content.trim();
  if (!text) return null;

  if (/^[+-]?\d+(?:\.\d+)?(?:\s*(?:\/|／)\s*(?:10|100))?\s*(?:%|分)?$/i.test(text)) {
    return normalizeJudgeScore(text);
  }

  const patterns = [
    /["']?\bscore\b["']?\s*(?::|：|is)\s*([+-]?\d+(?:\.\d+)?(?:\s*(?:\/|／)\s*(?:10|100))?\s*%?)/i,
    /(?:评分|分数|得分)\s*(?::|：|为)?\s*([+-]?\d+(?:\.\d+)?(?:\s*(?:\/|／)\s*(?:10|100))?\s*%?)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const score = normalizeJudgeScore(match[1]);
    if (score !== null) return score;
  }

  return null;
}

function extractStructuredTextReason(content: string): string | null {
  const text = content.trim();
  if (!text) return null;

  const quotedReason = text.match(/["']?(?:reason|feedback|comment|理由|说明)["']?\s*(?::|：|is|为)\s*(["'])([\s\S]*?)\1/i);
  if (quotedReason?.[2]) {
    const value = quotedReason[2].trim();
    if (value) return value;
  }

  const plainReason = text.match(/["']?(?:reason|feedback|comment|理由|说明)["']?\s*(?::|：|is|为)\s*([^\n\r}]+)/i);
  if (plainReason?.[1]) {
    const value = plainReason[1].replace(/,\s*$/, '').trim();
    if (value) return value;
  }

  return null;
}

function stringifyJudgeReason(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function collectJsonCandidates(content: string): string[] {
  const trimmed = content.trim();
  const candidates: string[] = [];
  const seen = new Set<string>();

  const pushCandidate = (value: string) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  if (trimmed) {
    pushCandidate(trimmed);
  }

  const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of trimmed.matchAll(fencedRegex)) {
    const block = match[1];
    if (block) pushCandidate(block);
  }

  const scoreObjectRegex = /\{[\s\S]*?["']?(?:score|璇勫垎|鍒嗘暟)["']?[\s\S]*?\}/g;
  for (const match of trimmed.matchAll(scoreObjectRegex)) {
    if (match[0]) pushCandidate(match[0]);
  }

  return candidates;
}

function parseJudgeEvaluationResponse(
  content: string,
  fallbackReason: string
): { score: number; reason: string } {
  const normalizedContent = (content || '').trim();
  const candidates = collectJsonCandidates(normalizedContent);
  const scoreKeys = ['score', '璇勫垎', '鍒嗘暟'];
  const reasonKeys = ['reason', '鐞嗙敱', '璇存槑', 'feedback', 'comment'];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

      let score: number | null = null;
      for (const key of ['score', '璇勫垎', '鍒嗘暟', ...scoreKeys]) {
        score = normalizeJudgeScore(parsed[key]);
        if (score !== null) break;
      }
      if (score === null) continue;

      let reason = '';
      for (const key of ['reason', '鐞嗙敱', '璇存槑', 'feedback', 'comment', ...reasonKeys]) {
        reason = stringifyJudgeReason(parsed[key]);
        if (reason) break;
      }
      if (!reason) reason = normalizedContent || fallbackReason;
      return { score, reason };
    } catch {
      continue;
    }
  }

  const textReason = extractStructuredTextReason(normalizedContent);
  const textScore = extractStructuredTextScore(normalizedContent);
  if (textScore !== null) {
    return { score: textScore, reason: textReason || normalizedContent || fallbackReason };
  }

  return {
    score: 0,
    reason: textReason || normalizedContent || fallbackReason,
  };
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

function normalizeTopP(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  if (value < 0 || value > 1) return undefined;
  return value;
}

function resolveTopP(value: number | null | undefined): number {
  return normalizeTopP(value) ?? DEFAULT_PROMPT_CONFIG.top_p;
}

type AnalysisCompareTabKey = 'models' | 'prompts' | 'ocrProviders' | 'judgeModels';

type AnalysisComparisonViewItem = {
  key: string;
  label: string;
  secondaryLabel: string | null;
  runCount: number;
  passRate: number;
  avgScoreNormalized: number | null;
  avgTotalTimeMs: number | null;
};

function clampPercent(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `${value.toFixed(1)}%`;
}

function parseEvaluationAnalysisData(raw: Record<string, unknown> | null | undefined): EvaluationAnalysisData | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<EvaluationAnalysisData>;
  if (candidate.scope !== 'single' && candidate.scope !== 'multi') return null;
  if (!candidate.configurationComparison || !candidate.judgeEvaluationSummary || !candidate.recommendedSetup) return null;
  return candidate as EvaluationAnalysisData;
}

function getCompareTabLabel(
  tab: AnalysisCompareTabKey,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  switch (tab) {
    case 'models':
      return t('targetModel');
    case 'prompts':
      return t('linkedPrompt');
    case 'ocrProviders':
      return t('exportOcrProvider');
    case 'judgeModels':
      return t('judgeModel');
    default:
      return tab;
  }
}

function getComparisonItems(
  data: EvaluationAnalysisData,
  tab: AnalysisCompareTabKey,
  t: (key: string, options?: Record<string, unknown>) => string
): AnalysisComparisonViewItem[] {
  if (tab === 'models') {
    return data.configurationComparison.models.map((profile: ModelProfile) => ({
      key: profile.key,
      label: profile.modelName?.trim() || profile.modelId?.trim() || t('selectModel'),
      secondaryLabel: profile.modelName?.trim() && profile.modelId?.trim() ? profile.modelId : null,
      runCount: profile.runCount,
      passRate: profile.passRate,
      avgScoreNormalized: profile.avgScoreNormalized,
      avgTotalTimeMs: profile.avgTotalTimeMs,
    }));
  }

  if (tab === 'prompts') {
    return data.configurationComparison.prompts.map((profile: PromptProfile) => {
      const base = profile.promptName?.trim() || profile.promptId?.trim() || t('noLinkedPrompt');
      const version = typeof profile.promptVersion === 'number' ? `v${profile.promptVersion}` : null;
      return {
        key: profile.key,
        label: base,
        secondaryLabel: version,
        runCount: profile.runCount,
        passRate: profile.passRate,
        avgScoreNormalized: profile.avgScoreNormalized,
        avgTotalTimeMs: profile.avgTotalTimeMs,
      };
    });
  }

  if (tab === 'ocrProviders') {
    return data.configurationComparison.ocrProviders.map((profile: OcrProviderProfile) => ({
      key: profile.key,
      label: getOcrProviderLabel(t, profile.ocrProvider),
      secondaryLabel: profile.ocrProvider || null,
      runCount: profile.runCount,
      passRate: profile.passRate,
      avgScoreNormalized: profile.avgScoreNormalized,
      avgTotalTimeMs: profile.avgTotalTimeMs,
    }));
  }

  return data.configurationComparison.judgeModels.map((profile: JudgeModelProfile) => ({
    key: profile.key,
    label: profile.judgeModelName?.trim() || profile.judgeModelId?.trim() || t('noJudgeModel'),
    secondaryLabel: profile.judgeModelName?.trim() && profile.judgeModelId?.trim() ? profile.judgeModelId : null,
    runCount: profile.runCount,
    passRate: profile.passRate,
    avgScoreNormalized: profile.avgScoreNormalized,
    avgTotalTimeMs: profile.avgTotalTimeMs,
  }));
}

function hasMixedComparison(data: EvaluationAnalysisData, tab: AnalysisCompareTabKey): boolean {
  switch (tab) {
    case 'models':
      return data.configurationComparison.hasMixedModels;
    case 'prompts':
      return data.configurationComparison.hasMixedPrompts;
    case 'ocrProviders':
      return data.configurationComparison.hasMixedOcrProviders;
    case 'judgeModels':
      return data.configurationComparison.hasMixedJudgeModels;
    default:
      return false;
  }
}

function getRecommendedValue(
  tab: AnalysisCompareTabKey,
  recommended: RecommendedSetup | null,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (!recommended) return '-';

  if (tab === 'models') {
    return recommended.model?.modelName || recommended.model?.modelId || '-';
  }

  if (tab === 'prompts') {
    const base = recommended.prompt?.promptName || recommended.prompt?.promptId || '-';
    const version =
      recommended.prompt && typeof recommended.prompt.promptVersion === 'number'
        ? ` v${recommended.prompt.promptVersion}`
        : '';
    return `${base}${version}`.trim();
  }

  if (tab === 'ocrProviders') {
    return getOcrProviderLabel(t, recommended.ocrProvider?.ocrProvider ?? null);
  }

  return recommended.judgeModel?.judgeModelName || recommended.judgeModel?.judgeModelId || '-';
}

function getRiskVariant(riskLevel: RecommendedSetup['strategy']['riskLevel']): 'success' | 'warning' | 'error' {
  if (riskLevel === 'low') return 'success';
  if (riskLevel === 'high') return 'error';
  return 'warning';
}

function getRiskLabel(
  riskLevel: RecommendedSetup['strategy']['riskLevel'],
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (riskLevel === 'low') return t('analysisRiskLow');
  if (riskLevel === 'high') return t('analysisRiskHigh');
  return t('analysisRiskMedium');
}

type TabType = 'testcases' | 'criteria' | 'history' | 'results' | 'analysis';

interface AnalysisPromptContext {
  promptId: string | null;
  promptName: string | null;
  promptVersion: number | null;
  template: string;
  messages: Array<{ role: string; content: string }>;
  config: Record<string, unknown> | null;
}

interface DeepAnalysisCaseDetail {
  testCaseId: string;
  testCaseName: string;
  executed: boolean;
  inputText: string | null;
  inputVariables: Record<string, string>;
  expectedOutput: string | null;
  notes: string | null;
  passed: boolean;
  errorMessage: string | null;
  modelOutput: string | null;
  scores: Record<string, number>;
  aiFeedback: Record<string, string>;
  latencyMs: number;
  ocrLatencyMs: number;
  tokensInput: number;
  tokensOutput: number;
  tokensTotal: number;
}

interface DeepAnalysisRunDetail {
  runId: string;
  runTitle: string | null;
  status: EvaluationStatus;
  startedAt: string;
  completedAt: string | null;
  modelName: string | null;
  judgeModelName: string | null;
  promptName: string | null;
  promptVersion: number | null;
  promptContext: AnalysisPromptContext | null;
  cases: DeepAnalysisCaseDetail[];
}

interface DeepAnalysisContext {
  mode: 'full_case_feedback';
  generatedAt: string;
  evaluation: {
    evaluationId: string;
    evaluationName: string;
  };
  promptContext: AnalysisPromptContext | null;
  runPromptContexts: AnalysisPromptContext[];
  criteria: Array<{
    id: string;
    name: string;
    description: string | null;
    prompt: string | null;
    weight: number;
    enabled: boolean;
  }>;
  runs: DeepAnalysisRunDetail[];
}

interface AnalysisDraftContext {
  scope: EvaluationAnalysisScope;
  runIds: string[];
  runLabel: string;
  analysisData: EvaluationAnalysisData;
  deepAnalysisContext: DeepAnalysisContext | null;
}

// 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ょ紓宥咃躬瀵鎮㈤崗灏栨嫽闁诲酣娼ф竟濠偽ｉ鍓х＜闁绘劦鍓欓崝銈嗙節閳ь剟鏌嗗鍛枀闂佸綊妫块悞锕傚磻鐎ｎ喗鐓曟い鎰剁悼缁犳﹢鏌ｉ悢鏉戝缂佽鲸鎸婚幏鍛村传閸曟埊绻濋弻娑樜旀担绯曟灆閻庢鍠栭…鐑藉箖閵忋倕绀傞悘蹇旂墬鐎氫粙姊虹拠鍙夋崳闁轰焦鎮傞垾锕傚醇閻斿墎绠氭繛瀵稿Т椤戝棝鍩涢幋鐘电＜閻庯綆鍋掗崕銉╂煕鎼达紕效闁哄本绋掔换婵嬪礃椤忓棛鏉介柣搴㈩問閸犳牠鈥﹀畡閭﹀殨闁圭虎鍠楅崑鍕煣韫囨凹鍤冮柛鐔烽叄濮婄粯鎷呴搹鐟扮闂佸憡妫戠粻鎾崇暦濠婂喚娼╅柤鎼佹涧娴犙囨⒑閸濆嫬鏆欓柣妤€锕崺娑㈠箣閿旂晫鍘卞┑鐘绘涧濡顢旈幘顔界厱閹肩补鍓濋幑锝囩磼鏉堛劌娴柟铏矒濡啫鈽夊Ο缁樺殘闂佽瀛╅鏍窗閺嶎厸鈧箓鎮滈挊澶嬬€梺鍦濠㈡ê顔忓┑瀣厱閻忕偛澧介埊鏇熴亜閵夈儳澧﹂柡灞剧洴閸╃偤骞嗚婢规洖鈹戦敍鍕杭闁稿﹥鐗滈弫顕€骞掗弬鍝勪壕婵鍘у顔锯偓瑙勬礃閸ㄥ綊鍩€椤掑﹦绉甸柛鐘愁殜閹繝寮撮姀锛勫帗闂佸疇妗ㄧ粈渚€寮抽悢鍏肩厵闁告劕寮堕崵鍥煛瀹€瀣М妞ゃ垺锕㈤幃娆撴濞戞帒寰嶉梻鍌欑閹碱偆鎮锕€绀夐柟瀛樼箥閸ゆ洘銇勯幒鎴濐仼闁搞劌鍊归妵鍕籍閸ヨ埖缍堥柣搴＄仛閻楁粎妲愰幘瀛樺闁告繂瀚竟鏇㈡⒑缁嬪灝顒㈠┑鐐诧工閻ｇ兘濡疯閸嬫捇鏁愭惔鈩冪亪婵℃鎳樺娲川婵犲啫顦╅梺鎼炲妽婢瑰棛鍒掔拠娴嬫闁靛骏绱曢崢鎾绘煛婢跺苯浠﹀鐟版钘濋柨鏇楀亾闁宠鍨块、娆撴嚃閳轰胶鍘芥繝娈垮枛閿曘儱顪冩禒瀣祦闁哄稁鍘介崐閿嬬箾閺夋埈鍎忓ù婊堢畺閺屸€愁吋鎼粹€崇闂佺顑戠换婵嬪蓟瀹ュ浼犻柛鏇ㄥ墮濞咃綁姊洪挊澶婃殶闁哥姵鐗犲濠氬Ω閵夈垺鏂€闂佺硶鍓濋敃鈺佄涢敓鐘斥拺缂佸瀵ч幑锝夋煕閻樺磭澧电€殿喖顭锋俊鎼佸Ψ閵忊剝鏉搁梻浣虹《閸撴繈鏁嬪┑鐐叉嫅缁插€熺亙闂佺粯锕㈠褎绂掑鍕╀簻闁瑰瓨绻嶅Σ鍛娿亜椤愩垻绠婚柟顔界矊铻ｉ悹鍥ф▕濞碱垶姊绘担绛嬫綈妞ゆ梹鐗犲畷鎶筋敊閸㈠缍侀、娆撳礈瑜忛敍婵囩箾鏉堝墽鍒板鐟帮工鍗辨繛宸簼閻撴瑩鏌ц箛锝呬簼鐎规洖鐭傞弻鐔碱敋閳ь剛绮婚弽顓炵畺婵犲﹤鐗婇崵宥夋煏婢跺牆鍔欑紒銊ф暬濮婃椽鎮烽弶鎸庡€梺璇″灠閻倸鐣烽弶娆炬僵閻犻缚娅ｉ悡鎴︽⒑缁洖澧茬紒瀣浮閸╂盯骞嬮敂鐣屽幈濠电偞鍨堕敃顐㈩潖濡ゅ啰纾奸柛顐ｆ磻閹查箖鏌＄仦鍓ф创濠碘剝鎮傞崺锟犲焵椤掑嫬绠熼柛鎾椻偓閸嬫挾鎲撮崟顒傦紱闂佸憡顨嗘繛濠囨偘椤曗偓楠炴帡骞婇搹顐ｂ拹闁瑰嘲鎳樺畷锝嗗緞婵犲簼绱叉繝鐢靛Х閺佹悂宕戦悩璇茬妞ゅ繐妫楃欢銈吤归悩宸剰缂佺姷鍠栭弻銊╂偄閸濆嫅銏ゆ煟閵堝骸娅嶉柡宀嬬秮楠炲洭顢欓悡搴☆瀱闂備胶绮幐楣冨窗閹邦厾鈹嶅┑鐘叉搐鍥撮梺鍛婃处閸樺吋淇婇悾宀€纾藉ù锝嗗絻娴滈箖鏌ｆ惔顖滅У闁稿甯掗埢鎾寸鐎ｎ偆鍘介梺褰掑亰閸ㄥジ宕电€ｎ喗鐓涢柍褜鍓氱换婵嗩潩椤撶姴骞嶆俊鐐€栭悧妤冪矙閹烘澶愬醇濠靛啯鏂€闂佹枼鏅涢崯顖炲磹閹邦兘鏀介柨娑樺閻掓寧銇勯敂鑺ュ唉闁哄矉绻濆畷閬嶅即閻愯尙銈繝娈垮枛閿曪妇鍒掗鐐茬闁告侗鍨抽惌娆愮箾閸℃瑥浜炬い銉﹀灴濮婄粯鎷呮笟顖滃姼濡炪倖鍨电€氼喖鈻庨姀鐙€娼╂い鎺戝€瑰▓楣冩⒑閸濆嫭鍌ㄩ柛銊ョ秺閹锋垿鎮㈤崗鑲╁帾婵犮垼娉涢悧鍡涘礉閵堝鐓曟慨妞诲亾濞存粏娉涢～蹇撁洪鍕炊闂佸憡娲﹂崑鍛枔椤撱垺鈷戠紓浣癸供濞堟棃鏌ㄩ弴銊ら偗妤犵偛鍟撮弫鎾绘偐閹绘帒绁梻渚€娼ф蹇曟閺囥垹鍌ㄩ柟闂寸劍閳锋垿鏌熼懖鈺佷粶闁告梹锕㈤弻娑欐償閵堝鎽垫繛锝呮搐閿曨亪骞栬ぐ鎺戞嵍妞ゆ挾濯寸槐鏌ユ⒒娓氣偓濞佳団€﹂崼銉ョ？闂侇剙绉寸粻鏍煙鏉堥箖妾柣鎾崇箻閺屾盯濡烽幋婵嗘灓濞寸厧鍟灃闁绘﹢娼ф禒婊勭箾瀹割喖寮柕鍡曠窔瀵噣宕煎┑鍡氣偓鍨攽閻愬弶顥為柛銊ф暬閻涱噣宕卞☉娆屾嫽闂佺鏈悷褔藝閿曞倹鐓欑痪鏉垮船娴滀即鏌熼姘拱鐎垫澘瀚禒锕傚箚瑜嶇花銉︾節閻㈤潧鈻堟繛浣冲吘娑樷槈閵忕姵杈堥梺鎸庢礀閸婂綊鎮″▎鎾寸厽闁瑰浼濋鍫熷€块柣鎰靛墰缁犻箖鎮樿箛鏃傚婵炲懎妫濋弻鏇㈠炊瑜嶉顓燁殽閻愭惌鐒介柟鐟板閹嫰骞掔€ｎ亜濮﹂梺鍝勬湰缁嬫垿锝炲鍫濆耿婵°倐鍋撴い顐簽缁辨挻鎷呴搹鐟扮缂備浇顕ч悧鎾荤嵁閸愨晝顩烽悗锝庡亽濡啫鈹戦悙鏉戠仸妞ゃ劌鐗撻獮鎴﹀即閻旇櫣鐦堢紒鍓у钃辨い顐躬閺屾稓鈧綆浜滈顓㈡煛鐏炴枻韬柡浣瑰姍瀹曘劑顢涘☉娆樺晭闂佽崵鍠愮划搴㈡櫠濡ゅ啯鏆滄俊銈呭暊閸嬫捇鎮介棃娴躲垺銇勯鐐村仴闁硅櫕绮岄銉ノ旀繝浣虹泿闂佸磭绮幑鍥ㄤ繆閹间礁鐓涢柛灞绢殕鐎氬吋绻濆▓鍨灓闁硅櫕鎸哥叅闁靛牆顦伴崐鍫曟煃鏉炴壆璐伴柣鏂挎閺岋綁鎮㈠畡鎵泿闂傚鍓﹂崜娑㈠焵椤掍緡鍟忛柛锝庡櫍瀹曟垶绻濋崒婊勬闂佺粯姊婚埛鍫ュ极瀹ュ棛绠鹃柟瀵镐紳婵傜绀岄柡宥庡幗閳锋帒霉閿濆洨鎽傞柛銈呭暣閺屾稑螣閸忓吋鐝梺杞扮贰閸ｏ綁鐛幒妤€绠婚柤纰卞墰閻ｉ箖姊绘担绋款棌闁绘挸鐗撳畷鎶筋敊绾拌京鍔锋繛瀵稿帶閻°劑鎮￠弴銏＄厪濠㈣埖锚閺嬫稑顭胯閸ㄥ爼寮诲澶嬬叆閻庯綆浜為悷銊╂⒒閸パ屾█闁哄被鍔岄埞鎴﹀幢濡警妲遍梻浣规偠閸婃劙宕戦幘缈犵箚闁绘劦浜滈埀顒佺墪鐓ゆ俊顖滃帶閸ㄦ繈骞栨潏鍓хɑ妞ゎ偅娲熼弻鐔兼倻濡崵鍘搁梺绋款儐閹瑰洭寮幇顓熷劅闁炽儴灏欓惄搴ㄦ⒒娴ｇ瓔鍤欏Δ鐘茬箲娣囧﹪宕堕埡鍌ゆ綗闂佸湱鍎ら幐缁樻叏濠婂牊鐓欐繛鍫濈仢閺嬨倝鏌ｉ幘瀛樺磳闁诡喗顨呴埢鎾诲垂椤旂晫褰梻渚€娼荤紞鍥╁緤娴犲鍋╅柣鎴ｆ缁犳娊鏌熼幖顓炲箺闁稿秹娼ч—鍐Χ閸℃鐟ㄩ梺绋匡功閸忔ê鐣?fileId 闂傚倸鍊搁崐鎼佸磹閹间礁纾圭€瑰嫭鍣磋ぐ鎺戠倞妞ゆ帒顦伴弲顏堟偡濠婂啰绠婚柛鈹惧亾濡炪倖甯婇懗鍫曞煝閹剧粯鐓涢柛娑卞灠閳诲牓鏌曢崱鏇狀槮闁宠閰ｉ獮姗€宕橀幓鎺撴殢濠碉紕鍋戦崐鏍箰妤ｅ啫纾婚柣鏂垮悑閸嬫﹢鏌曟径鍫濆姉闁衡偓娴犲绠抽柟鎯版绾惧綊鏌熼悧鍫熺凡缁炬儳顭烽弻鐔煎礈瑜忕敮娑㈡煕鐎ｎ亜鈧潡寮婚弴銏犻唶婵犻潧娴傚Λ銈囩磽娴ｅ弶顎嗛柛瀣尭閳规垿鎮╅崹顐ｆ瘎婵犳鍠楅幐鍐茬暦閹邦喚纾兼俊顖滅帛閻濈兘姊洪崫鍕偍闁搞劍妞介幃鈥斥槈閵忊€斥偓鐢告煥濠靛棗鈧懓鈻嶉崶鈺冪＜闁归偊鍘介ˉ鍫ユ煛瀹€瀣？濞寸媴绠撻幃娆擃敆閸屻倖效闂佽姘﹂～澶娒哄鍫濆偍鐟滄棃宕洪悙鍝勭闁挎洍鍋撶紒鐘崇⊕閵囧嫰骞樼粵鍦闂佹悶鍎崝澶愬箯濞差亝鈷戦柛娑橈功缁犳捇鎮楀鐓庡箺闁告帒锕ョ缓浠嬪川婵犲嫬骞堥梻浣筋潐閸庢娊顢氶鐏绘椽骞橀鐣屽幈闂佸疇顫夐崕铏閻愵兛绻嗛柣鎰典簻閳ь剚鐗曢蹇旂節濮橆剛锛涢梺鐟板⒔缁垶鎮￠弴鐔剁箚妞ゆ牗绻傞崥褰掓煟椤撶喎绗ч柍褜鍓濋～澶娒哄鈧畷褰掑锤濡ゅ啫绁﹀┑鈽嗗灥閸嬫劗澹曢崗闂寸箚妞ゆ牗绮岀敮鑸殿殽閻愯尙澧︽慨濠勭帛閹峰懘宕ㄦ繝鍐ㄥ壍婵犵數鍋涢惇浼村垂閽樺鏆︽繝闈涚墐閸嬫捇鏁愭惔鈥斥拤婵犳鍠楁繛濠囧蓟閿濆鏅查柛娑卞灣娴煎洨绱掗悙顒€鍔ら柕鍫㈩焾椤曪綁宕奸弴鐐哄敹濠电偞鍨堕敋妞ゎ剙鐗撳娲川婵犲嫮鐣奸梺绋跨昂閸婃繈鐛崼銉ノ╅柨鏂垮⒔閻﹀牓姊洪崨濠佺繁闁革綆鍠楃粋鎺楀煛閸愵亞锛濇繛鎾磋壘濞层倝寮搁悢鍏肩厽闁绘梹绻傚ú銈囩不閺屻儲鐓曢柡鍥ュ妼閻忕娀骞嗛悢鍏煎仭婵犲﹤瀚惌鎺斺偓瑙勬处閸撶喎鐣峰鍕闁惧繒娅㈢槐鎶芥⒒娴ｄ警鐒鹃柡鍫墴閹柉顦归挊婵嬫煥閺傛娼熷ù婊勭矒閺屻劑寮捄銊よ檸閻庤鎸稿Λ娆撱€冮妷鈺傚€烽柡澶嬪灥椤帡鎮楃憴鍕闁挎洏鍨介獮濠囨偐濞茬粯鏅㈡繛杈剧秬椤曟牠宕惔鈾€鏀介柨娑樺娴滃ジ鏌涙繝鍐⒈闁轰緡鍣ｉ獮鎺懳旈埀顒傚瑜版帗鐓熼柕蹇嬪焺閻掑墽鐥幆褜鐓奸柡宀€鍠栧畷婊嗩槾閻㈩垱鐩弻娑氣偓锝冨妼婵倿鏌″畝瀣М濠殿喒鍋撻梺闈涚箳婵娊宕犻弽顓熲拺闂侇偆鍋涢懟顖涙櫠椤曗偓閺屻劑寮撮妸銈夊仐閻庢鍠涢褔鍩ユ径濠庢僵闁挎繂鎳嶆竟鏇㈡⒑閹稿海绠撳Δ鐘叉啞缁傚秴鈹戠€ｎ偄鈧爼鐓崶椋庡埌鐎殿噮鍣ｉ弻锛勪沪閻ｅ睗褔鏌熺粙鍖℃敾鐎垫澘瀚灒闁诡厼绋勭粻鎾愁潖閾忓厜鍋撻崷顓烆€岄柛銈嗙懃铻栭柣妯虹－閹藉啴鏌ｈ箛鏂挎诞婵﹨娅ｇ槐鎺懳熺拠鑼暡濠德板€楁慨鎾箟閿熺姵鍋ら煫鍥ㄦ礈绾句粙鏌涚仦鎹愬闁逞屽墯閹倸鐣烽幇鏉跨濞达絽鎽滈敍娆撴倵閻熸澘顏柛锝囶棎閵囨劙骞掗幋鐘测偓鐐差渻閵堝棗绗掓い锔垮嵆瀵煡顢旈崼鐔蜂画濠电姴锕ょ€氼參鎮￠妷鈺傜厽闁挎繂娲ら崢瀛樸亜閵忥紕娲撮柟顔界矒瀹曞崬螣缂佹褰ㄦ繝鐢靛У椤旀牠宕板Δ鍛偓锕傚炊椤掆偓閸屻劎鎲稿澶婄厺闁圭偓妞块弫鍐煥閺冨泦鎺楀箯濞差亝鈷戦柛娑橈功閳藉鏌ㄩ弴妯哄姕鐎垫澘瀚板畷鐔碱敍濞戞艾骞堥梻浣瑰缁诲倹顨ラ幖浣稿嚑婵炴垶鐟ｆ禍婊勩亜閹哄棗浜鹃梺鎸庢处娴滎亪濡存笟鈧顕€宕煎┑鍡氣偓鍨攽閻愬弶顥為柛鈺侊功濡?
interface EvaluationCacheData {
  testCases: TestCase[];
  criteria: EvaluationCriterion[];
  runs: EvaluationRun[];
  results: TestCaseResult[];
  selectedRunId: string | null;
}

// 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻鐔兼⒒鐎靛壊妲紒鐐劤椤兘寮婚敐鍛傜喎鈻庨幆褎顔勭紓鍌欒兌婵挳鎮樺璺何﹂柛鏇ㄥ枤閻も偓闂佸湱鍋撻幆灞轿涢妶鍥╃＝濞达絾褰冩禍鐐節閻㈤潧孝婵炶绠撻幃锟犲礃椤忓懎鏋戝┑鐘诧工閻楀棛绮堥崼鐔稿弿婵☆垰娼￠崫铏光偓瑙勬礀瀵墎鎹㈠☉銏犵闁绘劕鐏氶崳褏绱撴担绋款暢闁稿鍊濋獮鍐ㄎ旈崨顔芥珳闁硅偐琛ラ埀顒冨皺閺佹牗淇婇悙顏勨偓褏绱撳璺虹闁规儼妫勭粻鏍ㄤ繆閵堝倸浜鹃梺宕囩帛閹瑰洤鐣疯ぐ鎺濇晩闁伙絽鑻拏瀣⒒閸屾瑨鍏屾い顓炵墦椤㈡牠宕ㄧ€涙ɑ娅囬梺闈涱檧婵″洭鍩炲鍛斀闁绘ê寮舵径鍕煕閵堝拋鍎旀慨濠傤煼瀹曞ジ鎮㈤幁鎺嗗亾閹烘梻纾奸柟閭﹀枛娴狅妇绱掔紒妯肩疄闁诡喕绮欏Λ鍐归煬鎻掔伈闁诡喗顨呴～婵嬵敆閳ь剙危婵犳艾纭€闁告浼濊ぐ鎺撳亗閹艰揪绲鹃幉濂告⒑閹惰姤鏁遍悽顖涘浮濠€渚€姊洪幐搴ｇ畵闁瑰啿绻樺畷顖炴倷閻戞鍘遍梺缁樻煥閹碱偅绂掑鍫熺厪闁糕剝锚缁楁帗銇勯锝囩疄妞ゃ垺顭堥ˇ鎶芥煟閵堝嫮绐旈柟顔筋殘閹叉挳宕熼鍌︾喘闂備焦鎮堕崝宥咁渻閼恒儰绻嗛柛顐ｆ礃閺呮彃顭跨捄鐚村姛妞わ负鍔戝娲濞淬倖绋撴禒锕傛嚍閵夛妇褰欓梻鍌氬€搁崐鎼佸磹閻戣姤鍤勯柛鎾茬閸ㄦ繃銇勯弽顐汗闁逞屽墾缁犳挸鐣烽崼鏇ㄦ晢闁逞屽墴瀵憡绗熼埀顒勫蓟濞戞ǚ鏀介柛鏇ㄥ亜婵骸顪冮妶鍐ㄥ姕闁煎綊绠栧﹢渚€姊虹紒妯忣亜螣婵犲洤纾块柟鎵閻撶喖鏌熼幆褏鎽犵紒鈧€ｎ喗鐓欐い鏃€鏋婚懓鍧楁煙椤旂晫鎳囨鐐存崌楠炴帡宕卞Ο铏规Ш闂傚倸鍊烽悞锕傚礈濮樿泛鍨傞柛妤冧紳濞差亝鍋勯柣鎾虫捣閻ｅ搫鈹戦埥鍡楃仴婵炲娲熼幃鍧楀焵椤掑嫭鈷戦柟绋挎捣缁犳捇鏌熼崘鍙夋崳闁绘碍鍎抽鍏煎緞鐎Ｑ勫闂備礁鎲＄换鍌溾偓姘煎櫍閹偟鎹勯妸褏锛滈梺鍝勮閸庢娊鎮惧ú顏呯厽婵炴垵宕弸鐔虹磼缂佹绠炵€规洖鐖兼俊姝岊槻妤犵偛鐗撳缁樻媴閸涘﹥鍎撻梺鍝ュ枔婵炩偓鐎规洘鍨块獮妯肩磼濡厧骞堥梻渚€娼ч…鍫ュ磿閾忣偆顩烽柕寰涢绨婚梺鍝勬祩娴滅偟绮旈濮愪簻闁靛繆鍓濈粈瀣攽椤旂懓浜鹃梻浣哥枃濡椼劑鎮為敃鍌氱９妞ゆ牜鍋為埛鎺懨归敐鍫綈闁稿濞€閺屾稒鎯旈埥鍡欏悑濠殿喖锕ｇ划娆忕暦閻旂⒈鏁嶆慨姗€纭稿Σ褰掓⒒娴ｅ憡鍟為柛鏃撶畵瀹曟澘螖閸涱厾鍘遍梺纭呮彧闂勫嫰鎮￠弴銏㈠彄闁搞儯鍔忔竟妯好瑰鍐Ш闁哄本娲熷畷濂告偄缁嬪灝鏀梻浣告惈閻鎹㈠┑鍡欐殾闁靛ň鏅╅弫濠囨煕閹炬鎳忓鏍р攽鎺抽崐妤佹叏閻戣棄纾绘繛鎴旀嚍閸ヮ剙绠柦妯猴級閿曞倹鐓欓柣妤€鐗婄欢鑼磼閻樺啿鈻曢柡宀€鍠撶槐鎺楀閻樺吀鐢婚梺?localStorage闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕婵犲倹鍋ラ柡灞诲姂瀵噣宕奸悢鍛婎唶闂備胶顭堥鍡涘箰閸撗冨灊妞ゆ挾鍋愬Σ鍫熶繆椤栨繍鍤欐繛鍛囧洦鈷戞繛鑼额嚙楠炴鏌ｉ悢鍙夋珚鐎殿喖顭烽幃銏ゅ川婵犲嫮肖濠德板€х徊浠嬪疮椤栫儐鏁佺€广儱顦伴埛鎴犵磼鐎ｎ偒鍎ラ柛搴＄箲閵囧嫰骞嬪┑鎰枅閻庢鍠栭…鐑藉箖閵忋倕绀傞柣鎾崇岸閸嬫捇鏌ㄧ€ｃ劋绨婚梺鐟版惈濡绂嶉悙顒傜瘈闁冲皝鍋撻悘鐐垫櫕娴犳悂姊洪崫鍕効缂佹煡绠栭獮鍡涘籍閸惊褔鏌涘☉鍗炵仩閻㈩垰娼″缁樼瑹閳ь剙顭囪鐓ら柕鍫濇礌閸嬫挸顫濋鐔哄嚒濡炪倖娲╃紞渚€銆佸璺虹劦妞ゆ巻鍋撻柣锝囧厴楠炴帡骞嬮弮鈧～宥呪攽閻愬弶顥為柛銊╂涧閳藉顦查柍瑙勫灴閺佸秹宕熼鈩冩線闂備胶顭堥敃銉╁礉濞嗗浚鍤曢柟缁樺坊閺€浠嬫倵閿濆簼绨芥い蟻鍐ｆ斀妞ゆ柨顫曟禒婊堟煕鐎ｎ偅灏甸柍褜鍓氶鏍窗閺嶎厸鈧箓鏌ㄧ€ｂ晝绠氶梺鍓插亝濞叉牠鎮欐繝鍥ㄧ厓闁告繂瀚弳鐔兼煕濮楀棗鐏︽慨濠冩そ閹筹繝濡堕崨鍜冪到闇夋繝濞惧亾缂侇喗鐟ラ悾宄扳攽閸艾浜鹃柨婵嗛婢ь噣鏌涢妸锔剧疄婵﹤顭峰畷濂告偄鐞涒剝鐏侀梻浣姐€€閸嬫挸霉閻樺樊鍎愰柣鎾跺枛閺岀喖鏌囬敃鈧悘鐘绘煟閵娿儲鎯堟い顓″劵椤﹁櫕绻涢懠顒€鏋涚€殿喖顭烽弫鎰緞婵犲倸鏁ら柣鐔哥矊椤戝鐣烽幋锕€顫呴柍鍨涙櫅娴滅偓绻涢崼婵堜虎闁哄绋掗妵鍕敇閻樻彃骞嬪Δ鐘靛仜閸熷瓨鎱ㄩ埀顒勬煏閸繃顥滈柍褜鍓涚划顖涚┍婵犲浂鏁嶆繝闈涙祩娴犫晠鎮峰鍛暭闁圭鍟块～蹇曠磼濡顎撻梺鍛婄箓鐎氼亞绱撻幘缁樷拺缂佸鐏濋銏＄箾閸忚偐鎳囬柛鈹垮灩椤撳吋寰勬繝鍌氱ギ闂備線娼х换鍡涘焵椤掍焦鐏遍柛瀣崌瀹曞ジ寮撮悢鍝勫箞婵＄偑鍊栭崝妤佹叏閹绢喖绀夋繝濠傜墛閻撳啴姊洪崹顕呭剰闁诲繐鐡ㄩ幈銊︾節閸屻倗鍚嬮悗瑙勬礀閵堟悂骞冮姀銏″仒闁炽儲鍓氬鎾绘⒒閸屾瑨鍏岄柟铏崌瀹曘儳鈧綆鍠栫粈澶嬬箾閸℃ɑ灏柦鍐枛閺屾洘绻涢悙顒佺彅闂佸憡顨夊▍鏇熺┍婵犲浂鏁嶆慨姗嗗幗閸庢挻绻濆▓鍨灈濡ょ姵鎮傞垾鏃堝礃椤斿槈褔鏌涢埄鍐剧劷闁挎稒锕㈠铏圭矙閸ф寮板┑鐐板尃閸ャ劌浠奸梺缁樺灱婵倝宕戦崟顓犳／闁瑰嘲鐭傞崫娲煛閸滀椒閭慨濠冩そ瀹曘劍绻濇担铏圭畳闂備線娼荤紞鍡涘闯閿濆鏄ラ柍褜鍓氶妵鍕箳閸℃ぞ澹曟俊鐐€х粻鎺撶椤掆偓鍗?
const evaluationCache = new Map<string, EvaluationCacheData>();

// 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎悗骞垮劚椤︻垳绮堢€ｎ偁浜滈柟鍝勭Ф閸斿秵銇勯弬鎸庡缂佺粯绻傞銉╂煥鐎ｎ偆鍑￠梺閫炲苯澧繛鑼枛閻涱喗绻濋崒婊勬畷闂佸憡娲﹂崑鍡涘礉閿曗偓椤啴濡堕崱妤€娼戦梺绋款儐閹瑰洭寮诲☉銏″亞濞达絽鎽滄禒鈺侇渻閵堝棙纾搁柛搴ㄦ涧閻ｇ兘鎮㈢喊杈ㄦ櫖濠殿喗顭堟禍顒勫级閸涘﹣绻嗛柣鎰典簻閳ь剚鐗犲畷褰掓偄閻撳孩顥濋梺绋跨灱閸嬫稓澹曢崸妤佺厽闁靛繈鍩勯悞楣冩煢閸愵亜鏋戠紒缁樼洴楠炲鈻庤箛鏇氭偅缂傚倷鑳舵慨鐢告儎椤栫偛钃熸繛鎴炵矌閻も偓闂佽鍎抽悺銊╁窗閹扮増鈷戦弶鐐村閸斿秹鏌ｅΔ浣虹煂婵″弶鍔欓獮鎺懳旈埀顒傜不濮樿鲸鍠愮€广儱娲ㄧ粈濠囨煛瀹ュ骸浜炵痪鎯у悑閵囧嫰寮崒娑欑彧闂佺懓鍟垮ú銊╁焵椤掍緡鍟忛柛鐘崇墵閳ワ箓鎮滈挊澶岀暫闂侀潧绻堥崐鏍磻閸岀偛绠归弶鍫濆⒔閹ジ鏌￠崱鏇炲祮闁哄矉缍侀幃銏ゅ传閵壯呭帎缂傚倷鑳剁划顖炴晝閵忕媭鍤曟い鎰╁焺閸氬鏌涘鈧粈渚€骞冮幋鐐电瘈闁靛骏绲剧涵鐐亜閹存繃鍠樼€?
interface ListCache {
  evaluations: EvaluationWithRelations[];
  prompts: Prompt[];
  promptGroups: PromptGroup[];
  models: Model[];
  providers: Provider[];
}

let evaluationCacheUserId: string | null = null;
let listCache: ListCache | null = null;
const loadingEvaluations = new Set<string>();  // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻橀弻锝夊閻樺樊妫岄梺杞扮閿曨亪寮婚垾鎰佸悑閹肩补鈧磭顔愮紓鍌欑劍閸旀牠銆冮崱妯尖攳濠电姴娲ゅ洿闂佸憡渚楅崢钘夆枔閺屻儲鍊甸悷娆忓缁€鍐煟閹垮嫮绡€鐎殿喖顭烽幃銏ゅ礂閼测晛濮洪梻浣瑰濞插秹宕戦幘缁樼厸閻庯綆鍋嗛妴鎺旂磼鏉堛劌娴柣鎿冨墴楠炴捇骞掗崱妞惧濠电娀娼ч鍛存嫅閻斿吋鐓ラ柡鍥殔娴滈箖鏌ф导娆戝埌闁靛棙甯掗～婵嬫偂鎼达絼鐢绘俊鐐€曟绋课涘┑鍡╂綎婵炲樊浜濋崵鍐煃鏉炴壆璐伴柡鍡╁弮閺岋絾鎯旈敐鍥ㄥ殑闂佹悶鍎洪悘娑㈡晝閸屾稓鍘遍梺鍝勬储閸斿矂寮搁妶澶嬬厽闁靛牆鍊告禍楣冩⒒閸屾瑦绁版い顐㈩槸閻ｅ嘲螣鐞涒剝鐏冨┑鐐村焾濞煎潡鍩€椤掆偓閸婂潡骞栬ぐ鎺戞嵍妞ゆ挾濯寸槐鍐测攽閻愯埖褰х紒鍙夊礃閵囨劙宕橀埡鍐炬锤闂佺粯鍔﹂崜娑氬姬閳ь剟姊洪棃娑㈢崪缂佽弓绮欓幃锟犲箛閻楀牏鍘遍梺鍝勫暊閸嬫捇鏌ｅΔ鍐ㄢ枅妤犵偛鍟撮弫鎾绘偐閸愯弓绨婚梻鍌氬€甸崑鎾绘煙闁箑鏋ら柣锝囧亾娣囧﹪鎮欓鍕ㄥ亾閺嶎厽鍋嬫俊銈呭暙閸ㄦ繄鈧厜鍋撻柍褜鍓熷顐︻敋閳ь剙鐣锋總绋垮嵆闁绘柨鎼獮鍫ユ⒒娴ｅ憡鎯堥柛濠傜秺椤㈡牕鈻庨幘宕囷紵闂佺懓顕慨椋庡婵傜绾ч柛顐ｇ☉婵¤偐绱掑Δ浣稿摵闁哄瞼鍠庨悾锟犳偋閸繃顏犻梻浣风串缂嶅洨鎹㈠┑鍡╁殨闁告挷鐒﹀畷澶愭煏婵犲繒鍒板ù鐘茬箻濮婂宕掑顑藉亾妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇㈡晜閽樺澹掑┑鐘灱濞夋盯鎯夐懖鈺冪焼濠电姴浼呰ぐ鎺撴櫜濠㈣泛妫楁禍鐐箾閹寸偞鐨戦柣锝夌畺濮婄粯鎷呴崫銉ㄥ┑鈽嗗亯濞夋洜鍒掗崼鐔稿闁告稑锕ュ▓浼存⒒閸屾艾鈧娆㈠顒夌劷鐟滄棁妫熸繛瀵稿Т椤戝懐绮ｅΔ鍛厸闁搞儮鏅涙牎濡炪値鍋呭ú鐔煎蓟閻旂厧绀堢憸蹇曟暜濞戙垺鐓冮梺鍨儏缁楁帡妫佹径鎰叆婵犻潧妫Ο鍫熶繆椤愶絽鐏ラ柍钘夘樀楠炴﹢鎮烽幍顔筋嚄缂傚倷娴囨ご鍝ユ暜閿熺姴绠栭柍鍝勬噹缁€鍐煠绾板崬鍘告俊妤佹尰娣囧﹪鎮欓鍕ㄥ亾閹达箑绀夊┑鐘叉搐绾惧潡鏌ｉ姀鐘虫喐鐎规挷绶氶弻鈥愁吋閸愩劌顬夋繝娈垮灡閹告娊寮诲☉銏℃櫆閻犲洦褰冪粻濠氭⒑閸濆嫭顥撻柛銊ョ秺閸╃偤骞嬮敂钘変汗闂佸壊鐓堥崑鍛掗崟顒傜瘈婵炲牆鐏濋弸銈夋煕韫囨枂顏堫敋閿濆鏁冮柨鏇楀亾鐎瑰憡绻傞埞鎴︽偐閹绘帗娈悗娈垮枛濞尖€愁潖閾忓湱纾兼俊顖濇娴煎洤鈹戦埥鍡椾簻閻庢凹鍠氶崚鎺撶節濮樺吋鏅梺缁樺姍濞佳嗐亹閸曨垱鈷戦柟鑲╁仜閸旀﹢鏌涢弬鍧楀弰闁糕晛锕鎾閿涘嫬甯楅梻鍌欑閻忔繈顢栭崨顒煎綊顢氶埀顒勫蓟閿涘嫪娌柛鎾椾讲鍋撻幒鎳ㄥ綊鎮崨顖滄殼閻庤娲樼划蹇浡ㄦ笟鈧弻锟犲幢韫囧﹤浜鹃柟棰佺劍鐎靛矂姊洪棃娑氬闁哥噥鍋婂畷婵嗩煥閸涱垳锛滃銈嗘閸嬫劖鐗庣紓鍌欑閻焦銇旈崫銉﹀床婵犻潧顑呴悙濠囨煠缁嬭法浠涙繛鍛喘濮婄粯鎷呴悷閭﹀殝缂備浇顕ч崐濠氬焵椤掍胶鈻撻柡鍛█楠炲啴骞愭惔銏狀€撻梺?

export function resetEvaluationPageCaches(): void {
  evaluationCache.clear();
  listCache = null;
  loadingEvaluations.clear();
  evaluationCacheUserId = null;
}

export function EvaluationPage() {
  const { showToast } = useToast();
  const { t, i18n } = useTranslation('evaluation');
  const { t: tCommon } = useTranslation('common');
  const { enabledOcrProviders } = useEnabledOcrProviders();
  const evaluationOcrProviderOptions = useMemo(
    () => buildOcrProviderOptions(enabledOcrProviders, t, true),
    [enabledOcrProviders, t]
  );
  const location = useLocation();
  const { user } = useAuthStore();
  const currentUserId = user?.id;
  const evaluationRouteState = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const evaluationId = params.get('evaluationId');
    const tab = params.get('tab');
    const subtab = params.get('subtab');
    const analysisReportId = params.get('analysisReportId');
    const runId = params.get('runId');
    return {
      evaluationId: evaluationId && evaluationId.trim() ? evaluationId.trim() : null,
      tab: tab === 'results' || tab === 'analysis' ? tab : null,
      subtab: subtab === 'analysis' ? subtab : null,
      analysisReportId: analysisReportId && analysisReportId.trim() ? analysisReportId.trim() : null,
      runId: runId && runId.trim() ? runId.trim() : null,
    } as const;
  }, [location.search]);
  const evaluationIdFromUrl = evaluationRouteState.evaluationId;
  const [evaluations, setEvaluations] = useState<EvaluationWithRelations[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptGroups, setPromptGroups] = useState<PromptGroup[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedEvaluation, setSelectedEvaluation] = useState<EvaluationWithRelations | null>(null);
  const [listMode, setListMode] = useState<'mine' | 'public'>('mine');
  const [showNewEval, setShowNewEval] = useState(false);
  const [showImportEval, setShowImportEval] = useState(false);
  const [importMode, setImportMode] = useState<'create' | 'append' | 'overwrite'>('create');
  const [importTargetEvaluationId, setImportTargetEvaluationId] = useState<string>('');
  const [importZipFile, setImportZipFile] = useState<File | null>(null);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importJob, setImportJob] = useState<{
    status: 'pending' | 'running' | 'completed' | 'failed';
    mode: 'create' | 'append' | 'overwrite';
    targetEvaluationId: string | null;
    resultEvaluationId: string | null;
    progress: Record<string, unknown>;
    errors: unknown[];
    errorMessage: string | null;
  } | null>(null);
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [importTemplateDownloading, setImportTemplateDownloading] = useState(false);
  const [exportEvaluationSetLoading, setExportEvaluationSetLoading] = useState(false);
  const getImportStageLabel = useCallback((stage: string): string => {
    if (!stage) return '-';
    const key = importStageLabelKeyMap[stage];
    return key ? t(key) : stage;
  }, [t]);
  const [newEvalName, setNewEvalName] = useState('');
  const [newEvalPrompt, setNewEvalPrompt] = useState('');
  const [newEvalModel, setNewEvalModel] = useState('');
  const [newEvalJudgeModel, setNewEvalJudgeModel] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [refreshingPromptOptions, setRefreshingPromptOptions] = useState(false);
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
  const [retryOutputRefreshTick, setRetryOutputRefreshTick] = useState(0);
  const [retryingAiEvaluationTestCaseId, setRetryingAiEvaluationTestCaseId] = useState<string | null>(null);
  const [retryingAllScoresByRunId, setRetryingAllScoresByRunId] = useState<Record<string, boolean>>({});
  const [retryingErroredCasesRunId, setRetryingErroredCasesRunId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingRunId, setExportingRunId] = useState<string | null>(null);
  const [updatingRunTitleId, setUpdatingRunTitleId] = useState<string | null>(null);
  const [batchExporting, setBatchExporting] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [submittingNewVersion, setSubmittingNewVersion] = useState(false);
  const [draggedEvaluationId, setDraggedEvaluationId] = useState<string | null>(null);
  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧湱鈧懓瀚崳纾嬨亹閹烘垹鍊為悷婊冪箻瀵娊鏁冮崒娑氬幈濡炪値鍘介崹鍨濠靛鐓曟繛鍡楃箳缁犲鏌＄仦绋垮⒉鐎垫澘瀚埀顒婄秵娴滄繈顢欓崨顓涙斀闁绘劕寮堕埢鏇灻瑰鍕煀婵炴彃娼″缁樻媴鐟欏嫬浠╅梺绋挎唉瀹曢潧顕ユ繝鍥ㄥ殟闁靛／灞鹃敜闂備胶绮崝锕傚礈濮樿泛鐭楅煫鍥ㄦ煣缁诲棙銇勯弽銊х煀閻㈩垰鐖奸幃浠嬵敍濠靛棛鍘銈冨妸閸庣敻骞冨▎鎾崇妞ゆ挾濮存慨铏圭磽閸屾瑦绁板鏉戞憸閺侇噣鏁撻悩顔瑰亾娴ｇ硶鏋庨柟瀵稿仜閸樺綊姊哄Ч鍥р偓銈夊垂娴兼潙绠氶柛顐犲劜閻撶喖骞栧ǎ顒€鐒洪柛鐔风箻閺屾盯鎮╁畷鍥р拰闂佽鍠撻崕鑼紦娴犲浼犻柕澶堝劤閵堬箑鈹戦悩鍨毄濠殿喗鎸冲畷鎰節濮橆剚杈堥梺鎸庢礀閸婂綊鎮￠弴銏＄厪濠㈣泛顑呴悘銉╂倵濮樼厧鏋熺紒鍌氱Ч椤㈡棃宕奸悢鍙夊濠电偠鎻紞鈧い顐㈩樀瀹曟垿鎮╃紒妯煎幈闂佸搫鍊藉▔鏇熸櫏闁诲氦顫夊ú妯好洪悢鑲╁祦閹兼番鍔嶉崵宥夋煏婢跺牆鍔欓柟顕嗙秮濮婄粯鎷呴搹鐟扮闂佹悶鍔庨崢褑鐏嬮梺鍛婃处閸ㄩ亶宕愬畡鎵虫斀闁绘ê寮舵径鍕煟閹惧崬鍔滅紒缁樼箞濡啫鈽夊▎妯伙紒闂備線娼荤徊鍧椻€﹂崼銉⑩偓锔炬崉閵婏箑鏋傞梺鍛婃处閸撴盯藝閺夊簱鏀芥い鏃傘€嬫Λ姘箾閸滃啰鎮兼俊鍙夊姍楠炴帡骞婂畷鍥ф灈闁圭厧缍婇弻鍛槈濮橀硸妲板┑鐘垫暩婵兘銆傞挊澹╋綁宕ㄩ弶鎴狅紱闂佸憡娲﹂崢鎼佸磻閹炬剚娼╂い鎰╁灩缁侇喖螖閻橀潧浠滄俊顐ｇ⊕缁傛帡鏁傞懞銉ヮ潯闂佸湱顭堢€涒晠藟閸懇鍋撶憴鍕８闁告梹鍨块妴浣糕枎閹惧磭鐣鹃悷婊冪Ф缁鎮欓悜妯锋嫽婵炶揪绲块悺鏃堝吹濞嗘垹纾肩紓浣姑ù顔锯偓瑙勬礃閸ㄧ敻鍩ユ径濞炬瀻闁归偊鍘捐ぐ鍨攽閻愬樊鍤熷┑顔芥尦椤㈡牠宕ㄧ€涙ê浜楅梺閫炲苯澧存慨濠冩そ瀹曨偊宕熼鈧粣娑㈡⒑閸濄儱校闁圭澧介崚鎺旂磼濡浜濋梺鍛婂姀閺呮繈宕㈤崡鐑嗘富闁靛牆妫楁慨褏绱掗懠鑸电《缂侇喛顕ч～婊堝焵椤掑嫬钃熸繛鎴欏灩閻撴盯鎮楅敐搴″閽冮亶姊绘笟鈧埀顒佺〒閳规帡鏌涢弬璺ㄐら柟骞垮灩閳规垹鈧綆浜為ˇ銊╂⒑瀹曞洦鍤€闁靛洦锕㈤幖瑙勬償閵婏妇鍘介柟鍏肩暘閸╁嫰宕箛娑欑厱闁绘ê纾晶顒勬煛閸涙澘鐓愰柟顖涙婵℃悂濡疯閸炲綊姊绘担鍛婂暈婵炶绠撳畷褰掓偋閸繂濮呴梻鍌氬€峰ù鍥綖婢跺鐝堕悗锝庡枛閻ょ偓绻涢幋娆忕仼闁绘帒鐏氶妵鍕箳瀹ュ牆鍘＄紓浣哄Х閸嬬喖鍩€?
  const [evalModelConfig, setEvalModelConfig] = useState<PromptConfig>(DEFAULT_PROMPT_CONFIG);
  const [showParamsModal, setShowParamsModal] = useState(false);
  const [publishModal, setPublishModal] = useState<{ evaluationId: string; step: 'confirm' | 'done' } | null>(null);
  const [publishShareAttachments, setPublishShareAttachments] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [returnToShareAfterPublishModalClose, setReturnToShareAfterPublishModalClose] = useState(false);
  const [privateShareModalOpen, setPrivateShareModalOpen] = useState(false);
  const [privateShareLink, setPrivateShareLink] = useState<ShareLink | null>(null);
  const [privateShareExpirePreset, setPrivateShareExpirePreset] = useState<ShareExpirePreset>('30d');
  const [privateSharePasswordMode, setPrivateSharePasswordMode] = useState<'none' | 'random' | 'custom'>('none');
  const [privateSharePassword, setPrivateSharePassword] = useState('');
  const [privateShareLoading, setPrivateShareLoading] = useState(false);
  const [privateShareSaving, setPrivateShareSaving] = useState(false);
  const [hasPrivateShareLink, setHasPrivateShareLink] = useState(false);
  const [analysisReports, setAnalysisReports] = useState<EvaluationAnalysisReport[]>([]);
  const [analysisReportsLoading, setAnalysisReportsLoading] = useState(false);
  const [selectedAnalysisReportId, setSelectedAnalysisReportId] = useState<string | null>(null);
  const [analysisReportMutating, setAnalysisReportMutating] = useState(false);
  const [renameAnalysisModalOpen, setRenameAnalysisModalOpen] = useState(false);
  const [renameAnalysisTitle, setRenameAnalysisTitle] = useState('');
  const [analysisEntryModalOpen, setAnalysisEntryModalOpen] = useState(false);
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [analysisDraft, setAnalysisDraft] = useState<AnalysisDraftContext | null>(null);
  const [analysisModelId, setAnalysisModelId] = useState('');
  const [analysisPrompt, setAnalysisPrompt] = useState('');
  const [analysisDeepMode, setAnalysisDeepMode] = useState(true);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [analysisRunPhase, setAnalysisRunPhase] = useState<'idle' | 'generating' | 'saving'>('idle');
  const [analysisTaskMeta, setAnalysisTaskMeta] = useState<{
    scope: EvaluationAnalysisScope;
    runLabel: string;
    evaluationId: string;
  } | null>(null);
  const [analysisPreparing, setAnalysisPreparing] = useState(false);
  const [analysisPreviewCopied, setAnalysisPreviewCopied] = useState(false);
  const [analysisCompareTab, setAnalysisCompareTab] = useState<AnalysisCompareTabKey>('models');
  const [runHistoryAnalyzeSelectionTrigger, setRunHistoryAnalyzeSelectionTrigger] = useState(0);
  const analysisAbortControllerRef = useRef<AbortController | null>(null);
  const startGlobalAnalysisTask = useAnalysisTaskStore((state) => state.startTask);
  const setGlobalAnalysisPhase = useAnalysisTaskStore((state) => state.setPhase);
  const completeGlobalAnalysisTask = useAnalysisTaskStore((state) => state.completeTask);
  const failGlobalAnalysisTask = useAnalysisTaskStore((state) => state.failTask);
  const abortGlobalAnalysisTask = useAnalysisTaskStore((state) => state.abortTask);
  const setGlobalAnalysisTaskCollapsed = useAnalysisTaskStore((state) => state.setCollapsed);
  const abortControllersRef = useRef<Map<string, RunAbortController>>(new Map());
  const retryOutputAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const retryAiEvaluationAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const retryAllScoresStatusRef = useRef<Map<string, EvaluationStatus>>(new Map());
  const isFinalizingEvaluationDragRef = useRef(false);
  const selectedEvaluationIdRef = useRef<string | null>(null);
  const listModeRef = useRef<'mine' | 'public'>('mine');
  const runPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runsRef = useRef<EvaluationRun[]>([]);
  const importPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const nextUserId = currentUserId ?? null;

    if (evaluationCacheUserId && evaluationCacheUserId !== nextUserId) {
      resetEvaluationPageCaches();
      resetRunHistoryDateRangeCache();
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

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎梺鐟板⒔缁垶宕戦幇鐗堢厱闁归偊鍓欑痪褔鏌ｉ妶鍛仼闁宠鍨堕獮濠囨煕婵炑冩噹缁躲倕霉閻樺樊鍎忛柣銈庡枟閵囧嫰骞囬埡浣插亾閹版澘纾婚柟鐐墯濞尖晜銇勯幒鎴Ч閺佸牓姊绘笟鈧褍煤閵堝洠鍋撳顐㈠祮闁绘侗鍣ｉ獮鎺懳旈埀顒傜不閿濆棛绡€闁割煈鍋勬慨鍐磼鏉堛劎绠炴慨?ref 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻鐔兼⒒鐎靛壊妲紒鎯у⒔缁垳鎹㈠☉銏犵婵炲棗绻掗崝鎾⒑鏉炴壆顦︽い鎴濇婵＄敻宕熼姘鳖啋闁荤姾娅ｉ崕銈夋倵妤ｅ啯鈷戦柛娑橈功閹冲啰绱掔紒妯哄婵犫偓娓氣偓濮婅櫣绮欑捄銊ь唶闂佸憡鑹鹃鍥╂閻愬搫绠ｉ柣妯虹仛閿涘繘姊虹拠鈥崇€婚柛鏇ㄥ亗濞ｎ噣姊绘担鍛婃儓闁活剙銈稿畷鐗堟償閵娿儳鍘洪梺瑙勫礃椤曆囧垂閸屾稏浜滈柡鍐ㄥ€瑰▍鏇灻瑰鍫㈢暫婵﹦绮幏鍛喆閸曗晙鎴烽梻浣告啞椤牆螞閸曨垱鍋╂繝闈涱儏缁犵懓霉閿濆棛鎽冮柟鑺ユ礀閳规垿鎮欓弶鎴犱户闂佺硶鏅涚€氭澘顕ｉ锕€绀冩い鏃傛櫕閸欏棗鈹戦悩缁樻锭婵☆偅鐟╄棢闁绘鍋ㄦ禍婊堟煥閺傛寧鎯堥柛鏃撻檮閹便劍绻濋崘鈹夸虎閻庤娲滈崗姗€銆佸鈧幃銏ゆ煥鐎ｎ剚娈梻鍌氬€烽懗鍓佸垝椤栫偞鍋嬮柡鍥ュ灩鍥寸紓浣割儐椤戞瑩宕甸弴鐐╂斀闁绘ê鐤囨竟姗€鏌涘Δ浣糕枙闁哄矉缍佸顕€宕堕…鎴滃摋婵＄偑鍊栧鐟懊洪悢濂夋綎婵炲樊浜滅粈鍫ユ煠绾板崬澧悽顖樺劦濮婃椽宕妷銉愶綁鏌ｅΔ渚囨疁妤犵偛鐗撴俊鎼佸煛娓氬洦缍傞梻渚€娼х换鍫ュ垂婵犳碍鏅繝濠傜墛閳锋垹绱撴担濮戭亝鎱ㄩ敃鍌涚厱闁规儳顕幊鍛磼椤旇偐澧︾€规洘锕㈡俊鎼佸閳╁啯婢戝┑锛勫亼閸婃牠寮婚妸鈺佺妞ゆ劧绠戦悞鍨亜閹哄秷鍏岀紒鐘靛仱閺岋絽鈽夐崡鐐寸彎閻庤娲栭妶鍛婁繆閻戣棄唯閹煎瓨蓱濞呭﹪鏌＄仦鐐鐎垫澘瀚板畷鐓庘攽閸粎妫梻鍌欑閹碱偊宕愰悽绋跨；闁瑰墽绮埛鎺楁煕鐏炲墽鎳呮い锔肩畵閺岀喎霉鐎Ｑ冧壕閻℃帊鐒﹀浠嬪极閸愵喖纾兼慨妯诲敾缁遍亶姊绘担鍛婂暈婵炶绠撳畷婊冾潩鐠鸿櫣鐓戦棅顐㈡处缁嬫帡鎮″☉銏＄厱闁靛绲介崝姘舵煟韫囷絼閭柡灞界Ч閺屻劎鈧綆浜炴导宀勬⒑閸濆嫮鐒跨紓宥勭窔楠炲啴濮€閵忊€崇彴闂佽偐鈷堥崜娆愭叏濞差亝鈷掑ù锝勮閻掔偓銇勯幋婵嗘殻鐎规洝顫夌粋鎺斺偓锝庝海閹芥洟姊虹捄銊ユ灁濠殿喗鎸抽幃鐐哄垂椤愮姳绨婚梺鍦劋閸ㄧ敻顢旈鍫熺厽闁圭儤娲栨禍褰掓煃瑜滈崜娆戠不瀹ュ纾块梺顒€绉寸粻鐘绘煙娴兼潙浜伴柡浣革躬閺屾盯鍩勯崘顏佸闂佹娊鏀遍崹鍧楀蓟濞戞ǚ妲堟慨妤€鐗婇。鑲╃磽娴ｅ摜鍩ｅù婊冪埣瀵鈽夊Ο閿嬬€婚棅顐㈡处缁嬫垵顕ｆ导瀛樷拺閻犲洠鈧櫕鐝紓浣虹帛缁诲啯绌辨繝鍥ㄥ€婚柦妯侯槺閸樻悂姊虹粙鎸庢拱缂侇喖鐬奸弫顔嘉旈崨顔惧幗闂佺粯鏌ㄩ幗婊堟儗鐎ｎ剛纾兼い鏃囧Г鐏忣參鏌ｉ敐鍛Щ妞ゎ厹鍔戝畷濂告偄閾氬倻鐩庨梻鍌欒兌缁垶骞愮粙妫靛綊鎮滈懞銉ヤ痪闂佹悶鍎滈埀顒勫绩娴犲鐓熼柟閭﹀墮缁狙勩亜閵壯冧槐闁哄瞼鍠撶划娆撳箰鎼淬垹鏋戠紓鍌欑贰閸犳牠鈥﹂悜钘夋瀬闁归偊鍘肩欢鐐烘倵閿濆骸澧鐐搭殕缁绘繄鍠婂Ο娲绘綉闂佹悶鍔嬮崡鎶界嵁閺嶎収鏁冮柨鏇楀亾婵鐓″鍫曞醇濞戞ê惟婵炲瓨绮嶇划鎾荤嵁閺嶎灔搴敆閳ь剟鎮橀鐣岀闁圭粯甯為幗鐘绘煙娓氬灝濡界紒缁樼箞瀹曘劑顢氶崨顒€鎽嬬紓鍌氬€风欢锟犲窗濡も偓铻為柛鎰╁妿閺嗭箓鏌涘Δ鍐ㄢ偓锝夊籍閸繄鍔﹀銈嗗笒鐎氱兘寮崒鐐村€垫繛鎴炵懐閻掔晫绱掗悩鑽ょ暫闁哄本鐩、鏇㈠Χ閸涱喚鈧墽绱撴担鎻掍壕闁诲函缍嗛崰妤呮偂濞戙垺鍊堕柣鎰邦杺閸ゆ瑥鈹戦垾鐐藉仮闁哄苯绉归幐濠冨緞濡亶锕傛⒑鐎圭媭鍤欓梺甯秮閻涱喚鈧綆浜栭弨浠嬫煕閹般劍娅呮い蹇ｅ灦濮婂宕掑顑藉亾妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇㈡晜閽樺澹掑┑鐘灱濞夋盯寮甸鈧悾鐑藉矗婢跺瞼鐦堥梻鍌氱墛缁嬫帡藟閻樼粯鐓涢柛鈽嗗幘閻ｇ敻鏌″畝瀣М妤犵偞锕㈠畷姗€鎳犻浣囩偞绻濋悽闈涗粶闁汇劎鍏樺鎻掝煥閸惊锕傛煕閺囥劌鐏犵紒鐙呯稻缁绘繈妫冨☉姘暪闂佹儳绻愭鎼佲€旈崘顔嘉ч柛鎰╁妼婵洟鎮楅崗澶婁壕缂備礁顑嗛娆忣焽閺嵮€鏀介柣妯虹枃婢规鐥幆褍鎮戠紒缁樼洴瀹曞崬螣閾忕懓濮兼繝纰樷偓铏枙闁革綇绲介～蹇撁洪鍕祶濡炪倖鎸荤粙鎺斺偓姘洴濮婅櫣绮欏▎鎯у壈闂佹寧娲忛崐婵嬪箖妤ｅ啯鍊婚柦妯侯槺閻も偓婵＄偑鍊栧Λ浣肝涢崟顖氬嚑闁稿瞼鍋為埛鎴︽煕濞戞﹫鏀诲璺哄閺屾稑螣鐠囪尙顦ㄩ梺闈涙处閸旀牠濡堕敐澶婄闁冲湱鍋撶€氳偐绱撻崒娆戣窗闁搞劌宕叅闁哄秲鍔嶅▍鐘绘煛鐏炶鍔滈柣鎾崇箻閺屾盯濡烽敐鍛瀷濠电偞褰冮顓㈠焵?selectedEvaluation
  useEffect(() => {
    selectedEvaluationIdRef.current = selectedEvaluation?.id || null;
  }, [selectedEvaluation]);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  useEffect(() => {
    listModeRef.current = listMode;
  }, [listMode]);

  useEffect(() => {
    if (evaluationRouteState.tab === 'analysis' || (evaluationRouteState.tab === 'results' && evaluationRouteState.subtab === 'analysis')) {
      setActiveTab('analysis');
    } else if (evaluationRouteState.tab === 'results') {
      setActiveTab('results');
    }
    if (evaluationRouteState.analysisReportId) {
      setSelectedAnalysisReportId(evaluationRouteState.analysisReportId);
    }
  }, [evaluationRouteState]);

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

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧湱鈧懓瀚崳纾嬨亹閹烘垹鍊為悷婊冪箻瀵娊鏁冮崒娑氬幈濡炪値鍘介崹鍨濠靛鐓曟繛鍡楃箳缁犳娊鏌嶈閸撴繈锝炴径濞掓椽寮介‖鈩冩そ閺佸啴宕掗妶鍡樻珖濠电偛顕慨鎾敄閸℃稒鍋傞煫鍥ㄧ⊕閻撴洘銇勯幇鍓佹偧缂佺姵鐗曢…璺ㄦ崉閸濆嫷浠鹃梺闈涙搐鐎氫即銆侀弴銏℃櫜闁糕剝鐟Σ褰掓⒒娴ｅ憡鎯堥柣顓烆槺閹广垹鈹戦崱娆愭闂佸壊鍋呭ú鏍ф暜闂備線娼ч敍蹇涘磼濠婂嫸绱￠梻鍌氬€搁崐鐑芥嚄閸洍鈧箓宕奸妷顔芥櫈闂佺鐬奸崑娑㈡偪妤ｅ啯鐓熸俊顖涱儥閸ゆ瑩鏌﹂崘顏勬灈闁哄被鍔戦幃銏ゅ传閸曟垯鍨荤槐鎺楀焵椤掑倵鍋撻敐搴′簴濞存粍绮撻弻鐔煎箥閾忣偅鐝旈梺閫炲苯澧い銊ワ躬楠炲啴宕稿Δ鈧粈瀣亜閹烘垵鈧顢欓弴銏＄厽閹兼番鍨婚埊鏇熴亜椤撶偞鍠橀柟顖氭湰缁绘繈宕熼鐙呯闯闁诲骸绠嶉崕閬嶅箯閹达妇鍙曟い鎺戝€甸崑鎾斥枔閸喗鐏堝銈庡幘閸忔﹢鐛崘顔碱潊闁靛牆妫楁禍妤呮煙閼圭増褰х紒鎻掓健瀵櫕瀵肩€涙鍘介梺缁樻煥閹芥粓鎯屾繝鍕＜濠㈣泛鏈崵鈧銈嗘穿缂嶄線骞栬ぐ鎺濇晝闁挎繂娲ㄨ倴闂傚倷绶氬褔鈥﹂鐘茬筏闁兼祴鏅炴慨鍐测攽閻樺磭顣查柍閿嬪灴濮婂宕奸悢鎭掆偓鎺戭熆瑜庡ú鐔煎蓟閻旂厧绀冮柤纰卞墰椤旀帡鎮楃憴鍕闁轰浇顕ч悾鐑藉醇閺囥劍鏅㈡繛杈剧到閹碱偊鐛鍡曠箚闁绘劦浜滈埀顒佺墪铻炲〒姘ｅ亾鐎规洘鍨块獮鍥敊閸撗呭帬闂備焦鍎崇换鎰板储濠婂牆纾婚柟鎹愬煐閸犲棝鏌涢弴銊ュ妞わ负鍔戝铏圭矙閸ф鈧鏌曢崼鐔烘憙婵☆偆鍠栧娲川婵犲嫭鍣у銈忓瘜閸樼晫绮嬪鍜佺叆闁割偁鍨硅ぐ鍕⒑閹肩偛鍔︽い銉︽尵閳ь兛绲婚崑鎰閹烘惟鐟滃骸鈻嶉弴鐘电＜閺夊牄鍔岀粭姘箾閻撳海绠诲┑鈩冩倐婵＄柉顦撮柟铏墵濮婄粯鎷呴悜妯烘畬闂佹悶鍨洪悡锟犵嵁婵犲洤绠涢柡澶庢硶閻ゅ懘姊洪崷顓℃闁哥姵鐗滅划鍫⑩偓锝庡亖娴滄粓鏌熼幑鎰【鐞氥儵姊洪崫鍕靛剰缂佺粯锚椤繒绱掑Ο璇差€撶紓浣割儓濞夋洜绮欒箛鏇犵＝濞撴埃鍋撶痪顓熸倐瀹曟澘顫濇潏顭戞綗闂佺粯鍔曢顓㈡偡瑜版帗鐓冪憸婊堝礈濞嗘搩鏁嬮柨婵嗘处鐎氭氨鈧懓澹婇崰鏍箖閹寸偟绡€闁靛骏绲剧涵鍓ф嫬閳哄懏鐓忓┑鐐靛亾濞呭棝鏌ｉ幘宕囩妞ゎ叀娉曢幏鐘诲灳瀹曞洣鍝楃紓鍌欑椤︻垱鏅舵惔锝呭灊闁割偆鍠撶弧鈧梺鎼炲劘閸斿骞忕紒妯肩闁圭偓娼欓悞褰掓煕鐎ｎ偅宕岄柡灞界Х椤т線鏌涢幘瀵告创鐎规洘鍨甸埥澶愬閳ヨ櫕顓烘俊鐐€栭悧妤冪矙閹烘垟鏋嶉柣妯款梿瑜版帗鍋傞幖杈剧稻閹插ジ姊虹紒妯诲鞍婵炶尙鍠栭幃锟狀敃閿曗偓閻愬﹪鏌曟繝蹇撶槣婵☆偅鐗犲娲嚃閳轰緡鏆柣搴ｇ懗閸ャ儮鍋撻崘顔嘉ㄩ柍鍝勫€搁埀顒傚厴閺屾稑鈻庤箛锝嗏枔濠碘槅鍋撶粻鎾诲箖濡ゅ啯鍠嗛柛鏇ㄥ墰椤︺劑姊洪幐搴㈢８闁搞劋绮欐俊瀛樻媴缁洘鐎婚梺鍦亾濞兼瑥鈻撻幇鐗堚拺闁告劕寮堕幆鍫ユ煥閺囨ê鍔滈柡鍛劚閳规垿鎮╁▓鎸庢缂備浇椴稿ú鐔风暦閹达箑绠ｉ柨鏇楀亾缁炬儳缍婇弻鈥愁吋鎼粹€茬凹闂佸搫妫欑划宀勫煘閹达附鍋愰柛娆忣槸椤︹晠姊洪幖鐐测偓鏇犫偓姘嵆瀵鈽夐姀鈺傛櫇闂佹寧绻傚Λ娑⑺囬妷鈺傗拺缂備焦锚缁楁帡鏌ｈ箛鏂垮摵濠碉紕鏁诲畷鐔碱敍濮橀硸鍞洪梻浣筋潐閹矂宕㈤悾宀€鎳呴梻鍌氬€风粈渚€骞栭锔绘晞闁糕剝绋掗崕搴亜閺嶎煈鍤ゆ繛鎴炵懄婵挳鏌ｉ悢绋款棆缂佹劗鍋ゅ楦裤亹閹烘垳鍠婇梺鍛婏耿缁犳牕鐣烽姀銈嗗癄濠㈣泛妫欓弬鈧梻浣哥枃濡嫬螞濡ゅ懏鍊堕柨鐔哄У閸婄數绱掑Δ浣衡槈婵炶绠撳畷鎴︽偄閹肩偘绨婚棅顐㈡处閹哥偓鏅跺☉銏＄厽闁规儳顕ú鎾煙椤旂瓔娈滈柡浣瑰姈閹柨鈹戦崼銏℃櫒濠碉紕鍋戦崐鏇灻瑰璺虹；闁糕剝鐟﹂～鏇㈡煙閻戞ɑ灏扮紓宥呮喘閺屾洘绻涢崹顔煎Б闂佽崵鍠嗛崝鎴﹀蓟瑜忕槐鎺懳熼悡搴樻嫲闂備礁鎼懟顖滅矓閻戦摪銊︾瑹閳ь剟寮诲☉銏犵閻犺櫣鍎ら悗濠氭⒑娴兼瑧鎮奸柛蹇旓耿閻涱噣宕堕鈧痪褔鏌熺粙鍧楊€楃紒浣藉煐娣囧﹪鎮欓鍕ㄥ亾閺嶎厼绠伴柤濮愬€楅惌娆撴煙鐎电浠фい鈺傚絻铻栭柨婵嗘噹閺嗙偤鏌嶉柨瀣诞闁哄本鐩、鏇㈠Χ閸涱喚浜栭梻浣哥－椤戞洟宕愬┑瀣摕婵炴垶鍩冮崑鎾绘晲閸愩劌顬堥梺璇茬箲閻擄繝寮婚垾宕囨殕闁逞屽墴瀹曚即寮介婧惧亾娴ｇ硶鏋庨柟瀵稿仜閺嬪倿姊洪崨濠冨闁告挻绋栭妵鎰偓锝庡枟閻撶喖骞栧ǎ顒€鈧倕顭囬幇顓犵閻犲泧鍛殼閻庤娲橀崹鍓佹崲濠靛纾兼繝濠傚椤旀洟姊绘担铏瑰笡婵﹤顭烽崺娑㈠醇閵夈儲鐎梺鍛婂姦閸犳鎮¤箛娑氬彄闁搞儜灞藉壈闂佺粯甯楀浠嬪蓟濞戞﹩娼╂い鎺嶇濞堟鈹?
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

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氶梺璇叉唉椤煤韫囨稑纾块柟鎯版閻掑灚銇勯幒鎴姛缂佸鏁婚弻娑㈡偐瀹曞洤鈷堟繝銏ｎ潐濞茬喎鐣风粙璇炬梹鎷呴崫鍕闂傚倷娴囬鏍垂閾忣偅娅犳俊銈呮儰婢跺绶為柟閭﹀墰椤旀劙姊洪崫鍕垫Ч闁糕晛锕悡顒勵敆閸曨剛鍘搁柣蹇曞仩椤曆囧焵椤掍胶绠炴鐐诧工閳规垹鈧綆浜為鐓庮渻閵堝棙顥嗛柛瀣姈閺呭爼顢涘锝嗘杸闂佺粯鍔樼亸娆撳箺閻樼數纾兼い鏃囧亹閻忚京绱掓潏鈺佷沪缂佺粯绻堝畷鎯邦樁闁硅姤娲栭埞鎴︽倷閺夋垹浠ч梺鎼炲妿閹虫捇寮鎴掔箚闁绘劦浜滈埀顒佺墪铻炲ù锝呮憸閺嗭箓鏌ｉ姀銏╃劸婵懓寮舵穱濠囧Χ閸曨喖鍘＄紓浣哄█缁犳牠骞冨Δ鈧埥澶娾枎濡厧濮洪梻浣规た閸樺ジ鏁冮敂鐐潟闁圭偓鍓氶崥瀣煕濠婂啫鏆㈤柛姘煎亰閹鈻撻崹顔界亪濡炪値鍘鹃崗姗€鐛崘顔碱潊闁靛牆妫楁禍妤呮煙閼圭増褰х紒鎻掓健瀵櫕瀵肩€涙鍘介梺缁樻煥閹芥粓鎯屾繝鍕＜濠㈣泛鏈崵鈧銈嗘穿缂嶄線骞栬ぐ鎺濇晝闁挎繂娲ㄨ倴闂傚倷绶氬褔鈥﹂鐘茬筏闁兼祴鏅炴慨鍐测攽閻樺磭顣查柍閿嬪灴濮婂宕奸悢鎭掆偓鎺戭熆瑜庡ú鐔煎蓟閻旂厧绀冮柤纰卞墰椤旀帡鎮楃憴鍕闁轰浇顕ч悾鐑藉醇閺囥劍鏅㈡繛杈剧到閹碱偊鐛鍡曠箚闁绘劦浜滈埀顒佺墪铻炲〒姘ｅ亾鐎规洘鍨块獮鍥敊閸撗呭帬闂備焦鍎崇换鎰板储濠婂牆纾婚柟鎹愬煐閸犲棝鏌涢弴銊ュ妞わ负鍔戝铏圭矙閸ф鈧鏌曢崼鐔烘憙婵☆偆鍠栧娲川婵犲嫭鍣у銈忓瘜閸樼晫绮嬪鍜佺叆闁割偁鍨硅ぐ鍕⒑閹肩偛鍔︽い銉︽尵閳ь兛绲婚崑鎰閹烘惟鐟滃骸鈻嶉弴鐘电＜閺夊牄鍔岀粭姘箾閻撳海绠诲┑鈩冩倐婵＄柉顦撮柟铏墵濮婄粯鎷呴悜妯烘畬闂佹悶鍨洪悡锟犵嵁婵犲洤绠涢柡澶庢硶閻ゅ懘姊洪崷顓℃闁哥姵鐗滅划鍫⑩偓锝庡亖娴滄粓鏌熼幑鎰【鐞氥儵姊洪崫鍕靛剰缂佺粯锚椤繒绱掑Ο璇差€撶紓浣割儓濞夋洜绮欒箛鏇犵＝濞撴埃鍋撶痪顓熸倐瀹曟澘顫濇潏顭戞綗闂佺粯鍔曢顓㈡偡瑜版帗鐓冪憸婊堝礈濞嗘搩鏁嬮柨婵嗘处鐎氭氨鈧懓澹婇崰鏍箖閹寸偟绡€闁靛骏绲剧涵鍓ф嫬閳哄懏鐓忓┑鐐靛亾濞呭棝鏌ｉ幘宕囩妞ゎ叀娉曢幏鐘诲灳瀹曞洣鍝楃紓鍌欑椤︻垱鏅舵惔锝呭灊闁割偆鍠撶弧鈧梺鎼炲劘閸斿骞忕紒妯肩闁圭偓娼欓悞褰掓煕鐎ｎ偅宕岄柡灞界Х椤т線鏌涢幘瀵告创鐎规洘鍨甸埥澶愬閳ヨ櫕顓烘俊鐐€栭悧妤冪矙閹烘垟鏋嶉柣妯款梿瑜版帗鍋傞幖杈剧稻閹插ジ姊虹紒妯诲鞍婵炶尙鍠栭幃锟狀敃閿曗偓閻愬﹪鏌曟繝蹇撶槣婵☆偅鐗犲娲嚃閳轰緡鏆柣搴ｇ懗閸ャ儮鍋撻崘顔嘉ㄩ柍鍝勫€搁埀顒傚厴閺屾稑鈻庤箛锝嗏枔濠碘槅鍋撶粻鎾诲箖濡ゅ啯鍠嗛柛鏇ㄥ墰椤︺劑姊洪幐搴㈢８闁搞劋绮欐俊瀛樻媴缁洘鐎婚梺鍦亾濞兼瑥鈻撻幇鐗堚拺闁告劕寮堕幆鍫ユ煥閺囨ê鍔滈柡鍛劚閳规垿鎮╁▓鎸庢缂備浇椴稿ú鐔风暦閹达箑绠ｉ柨鏇楀亾缁炬儳缍婇弻锟犲炊閳轰絿锝団偓瑙勬礃閻擄繝寮婚悢鍏煎亱闁割偆鍠撻崙锟犳⒑濮瑰洤鈧倝宕抽敐澶婅摕闁绘柨鐨濋弸鏃堟煕椤垵鏋熼柣蹇旀尰缁绘盯骞嬮悙鏉戠缂備礁顦遍弫濠氱嵁閸儱惟闁靛娴烽崰鏍х暦瑜版帩鏁婇柟顖嗗啰绱伴梻鍌氬€烽悞锔界箾婵犲洤缁╅梺顒€绉撮崹鍌炴煕瑜庨〃鍛不閺嶎偅鍠愰柣妤€鐗嗙粭鎺楁煟閹邦剨韬柡灞诲妼閳规垿宕卞璇蹭壕闁告稑锕﹂々鎻捨旈敐鍛殲闁绘挻娲熼弻鐔兼焽閿曗偓楠炴牜绱掗懠顒傚笡闁靛洤瀚伴獮鎺楀箻閸撲胶鍘滄繝娈垮枛閿曪妇鍒掗鐐茬闁告侗鍨遍崰鍡涙煕閺囥劌浜楅柛婵囶殜濮婄粯鎷呴崨濠傛殘闂佸搫琚崝搴ｅ垝閺冨牊鍋ㄩ柛顭戝亜鎼村﹤鈹戦悙鏉戠仸闁荤啙鍛К闁逞屽墴濮婅櫣绮欓懗顖ｆ蕉闂佺锕ュú鏍煝閹捐惟闁靛鍠楃€靛矂姊洪棃娑氬婵☆偅顨嗛幈銊槾缂佽鲸甯￠幃鈺呭礃閼碱兛娣繝鐢靛仦瑜板啫顭囬垾鎰佹綎缂備焦蓱婵挳鏌ц箛鎾剁暛闁逞屽墮閿曨亪寮诲☉銏犵閻庨潧鎽滈悿鍕⒑鐠団€虫灓闁稿繑锕㈤妴浣糕槈濡偞甯￠、姗€鎮㈤幖鐐拌檸婵°倗濮烽崑鐐烘偋濡ゅ懎绠柛娑欐綑閹硅埖銇勯幘璺轰粶缂佺姰鍎靛濠氬磼濞嗘帒鍘＄紓渚囧櫘閸ㄥ爼鐛幇顔剧煓婵☆偊娼х紞濠囧箖濠婂牊瀵犲璺虹焾閸熷牓姊绘担铏瑰笡妞ゎ厼娲顐﹀传閵夈儺妫滄繝闈涘€搁幉锟犲磻閿濆鐓曢柕澶涚到婵¤偐绱掗懠顒傚笡闁靛洤瀚粻娑㈡晲閸涱厾鐫勯梻浣告惈閻ジ宕伴弽顓溾偓浣糕枎閹炬潙浠奸柣蹇曞仦閸庡啿鈻嶅Δ鍐＝闁稿本鐟ㄩ崗宀€绱掗鍛仯闁瑰箍鍨藉畷鐓庘攽閸喐顔曢梻浣稿閸嬪懎煤閺嶃劌鍔旈梻鍌欑窔濞佳呮崲閸℃稑鐒垫い鎺嶇婢ь垰霉閸忚偐澧紒缁樼箘閸犲﹥寰勫畝鈧敍鐔兼⒑缁嬫鍎愰柛銊ョ仢閻ｇ兘骞囬弶鍨敤濡炪倖鎸鹃崑鐔妓囬鈧幃宄邦煥閸愵亞顔囧銈嗘磸閸庤尙鎹㈠┑瀣倞闁靛鍎伴幃锝夋煟鎼粹€冲辅闁稿鎹囬弻宥堫檨闁告挻绋撻崚鎺撶節濮橆剛鐫勯梺绋挎湰缁嬫垿寮搁幋锔筋棅妞ゆ劑鍨烘径鍕箾閸欏鑰块柨婵堝仱瀵挳濮€閿涘嫬骞嶉梻浣虹帛閸ㄥ爼鏁冮埡浣叉灁闁靛繈鍊栭悡娑樏归敐澶嬩氦闂婎剦鍓熼弻鈥崇暆鐎ｎ剛鏆犻柧浼欑到閵嗘帒顫濋悡搴ｄ画闂佸磭绮幐鎼佸煘閹达箑鐓￠柛鈩冦仦缁ㄨ鈹戦埥鍡椾簼缂佽鍊块敐鐐剁疀閹句焦妞介、鏃堝川椤栨艾啸闂傚倷鑳剁划顖炲礉濡棿鐒婃い蹇撴閸嬫挸顫濋鐔哄嚒濡炪値鍙€閸庡篓娓氣偓閺屾盯濡搁妷褝绱炲┑鈥冲级閸旀瑩鐛幒妤€妫橀柛婵嗗婢规洟姊洪幐搴ｇ畵濡ょ姴鎲＄粋宥咁煥閸曨厾顔曢梺鍦拡閸樺ジ寮搁妶澶嬬厓鐟滄粓宕滃┑瀣剁稏濠㈣泛鈯曢崫鍕庣喖宕楅悡搴＄哎闂備胶顭堥張顒傛崲閸曨剛顩叉繛鍡樻尰閳锋帒霉閿濆懏鍟為柛鐔哄仱閺屾盯寮埀顒勫垂閸喚鏆︽繝闈涙閺嗗棝鏌涢弴銊ュ闁逞屽墲濞夋盯鍩為幋锔藉亹闁告瑥顦ˇ鈺呮⒑缁嬪尅宸ラ柣蹇斿哺閵嗗啴濡烽埡鍌氣偓鐑芥煠绾板崬鍘搁柧蹇撻叄濮婃椽宕ㄦ繝鍐ｆ嫻缂佺偓婢樼粔鐢电矚鏉堛劎绡€闁搞儴鍩栭弲婵嬫⒑閹稿海绠撴繛璇х畵瀹曟艾鈽夐姀鈾€鎷?
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

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕閵堝懎顏柡灞剧洴椤㈡洟鏁愰崱娆樻К缂備胶鍋撻崕鍐差焽閿熺姴钃熼柨婵嗩槸椤懘鏌曡箛濠冩珖闁告梹鎮傚鍝勑ч崶褉鍋撳Δ鍛；闁规崘鍩栧畷鍙夌節闂堟稒宸濈紒鈾€鍋撻梻浣侯焾閺堫剛鍒掑畝鍕┾偓鍌毭洪鍛嫼闂佺鍋愰崑娑欎繆婵傚憡鐓曞┑鐘插€归崑銉р偓娈垮枛椤兘寮幇顓炵窞濠电姴瀛╃紞鍌炴⒒娓氣偓濞佳呮崲閸℃稑鐤炬繝闈涱儏缁€澶愭煕濠靛嫬鍔ょ痪鎹愭闇夐柨婵嗘噺閹牓寮介敓鐘斥拺闁绘挸娴风粔铏圭磼閻樺磭澧甸柛銊╃畺閺佸倿鎮欓鈧壕顖炴⒑闂堟侗鐓紒鐘冲灩婢规洟顢涢悙绮规嫼闂佽鍨庨崨顖ｅ敹婵犵數濮崑鎾诲级閸稑濡兼い鏇憾閺屾盯濡烽姀鈩冪彇缂佺偓鍎抽妶鎼佸蓟閻旂⒈鏁嶉柛鈩冾殔閺嗙喓绱掔€ｎ亞绠崇紒杈ㄦ尰缁楃喖宕惰閻忓秹姊洪懡銈呮毐闁哄懏鐩、姘舵晲閸℃瑧鐦堝┑顔斤供閸樺吋绂嶅鍫熲拺缂備焦蓱鐏忣厽绻涚€电鍘撮柟顔惧亾閵堬綁宕橀埡浣风敾婵犵數濮撮敃銈夊疮閹殿喚涓嶅┑鐘崇閻撴稑霉閿濆懏鎲哥€涙繂顪冮妶鍡樺碍闁告艾顑呴銉╁礋椤撴稑浜鹃柨婵嗛婢ь喗顨ラ悙鑼ф慨濠勭帛閹峰懏顦版惔婵婎洬缂傚倷娴囧鎾跺垝濞嗘挸绠犻柣鏃傗拡閺佸秵鎱ㄥΟ鍧楀摵闁瑰啿鍟换婵堝枈婢跺瞼锛熼梺绋款儐閸ㄥ灝鐣烽幇鏉课у璺猴工閸嬪秹姊虹紒妯诲碍閻庡灚甯￠幃鐐寸鐎ｎ偆鍙嗛梺缁樻煥閹碱偄鏆╅柣搴ゎ潐閹搁娆㈠璺鸿摕婵炴垯鍨归悞娲煕韫囨洖顎屽ù婊庝邯閵嗕礁顫濋懜鐢靛姸閻庡箍鍎卞Λ娑㈠储閸涘﹦绡€闁靛骏绲剧涵鐐亜閹存繃鍤囬柟顔斤耿閺佸啴宕掑☉姘箥闂備焦鍎冲ù姘跺磻閸℃稑绠犻柛銉ｅ妽閸欏繐鈹戦悩鎻掝伀閻㈩垱鐩弻鐔风暋閻楀牆娈楅悗瑙勬磸閸斿秶鎹㈠┑瀣闁靛鍎遍ˉ鎺楁⒒閸屾艾鈧兘鎳楅崼鏇炵疇闁规崘顕ч悿顕€鏌涜椤ㄥ棝宕曞Δ鍛厱閻忕偟鍋撻惃鎴︽煛閸☆厾鐣甸柡宀嬬節瀹曞爼濡烽妷褌鐥梻浣规偠閸婃牠宕归崼鏇炍﹂柛鏇ㄥ灠缁犳娊鏌熺€涙濡囬柛瀣尰缁绘繂顫濋鐐╁亾閸ф鐓曠憸搴ㄣ€冮崱娑樼９闁割煈鍋掑▓浠嬫煟閹邦垰鐨哄ù鐘灲閺屾盯寮埀顒傚枈瀹ュ洦宕叉繛鎴欏灪閸ゆ垶銇勯幒鍡椾壕闂佸疇顕ч悧蹇涘焵椤掑喚娼愭繛鍙夛耿瀹曞綊宕稿Δ鍐ㄧウ濠碘槅鍨甸崑鎰閸忛棿绻嗘い鏍ㄧ矌鐢盯鏌ｅ┑鍥р枙婵﹦绮幏鍛瑹椤栨粌濮奸梻浣告惈閻楁粓宕滃☉姘灊婵炲棙鎸哥粻铏繆閵堝嫮顦﹀ù鐘欏洦鈷戦柛婵嗗瀹告繈鏌涙惔銏犲闁靛棙甯楃换婵嗩潩椤撶姴甯鹃梻浣稿閸嬪懐鎹㈤崘顔㈠顭ㄩ崘锝嗘杸濡炪倖姊婚崢褔寮抽悢铏圭＜閺夊牄鍔屽ù顔姐亜閵忥紕鎳囬柟顔煎⒔娴狅箓骞嗚閻濅即姊虹拠鎻掝劉妞ゆ梹鐗犲畷浼村冀椤撴稈鍋撻敃鍌涚叆閻庯絺鏅濈粻姘舵⒑瑜版帗锛熺紒鈧担鍛婃殰闂傚倷绶氬褏鎹㈤崱妞綁宕ㄩ褏鍔烽梺鍝勫暊閸嬫挾绱掔紒妯肩畼闁哥姴锕よ灒婵炶尙绮紞澶愭⒒娴ｈ鍋犻柛鏂款儔瀹曪繝骞庨挊澶岀暫濠碘槅鍨甸妴鈧柡鈧禒瀣€甸柨婵嗘噽娴犳盯鏌￠崨顔剧煀妞ゎ亜鍟存俊鍫曞幢濡儤娈┑鐘愁問閸ｏ綁藟閹惧鐝堕柡鍥╁枔椤╃兘鎮楅敐搴′簽闁告﹢浜堕弻锝堢疀閺囩偘鎴烽梺绋款儐閹瑰洭骞嗛崘顔肩闁绘﹩鍋勬禍鐐箾閹寸偟鎳呯紒鐘虫尰閵囧嫰顢旈崟顐ｆ婵犵鈧磭鍩ｇ€规洖宕灃闁告剬鍕枙婵犵绱曢崑鎴﹀磹瑜忛埀顒勬涧閻倸鐣疯ぐ鎺戦唶闁哄洨鍋熼悾娲⒑鐠団€崇€婚柛娑卞枟閻ゅ倿姊绘担鍝ョШ闁衡偓閸楃儐娼栭柣鐔稿珗濞戙垹绀冮柕濞у嫭顔曢梻渚€娼ц墝闁哄應鏅犲顐﹀炊椤掍胶鍘介梺瑙勫婢ф鈽夎缁辨挸顓奸崟顓犵崲濠殿喖锕ら…宄扮暦閹烘垟鏋庨柟瀛樼箓椤姊绘担瑙勩仧濞存粍绮庣槐鐐寸節閸屾粍娈鹃柣鐔哥懃鐎氼喚寮ч埀顒€鈹戦鏂や緵闁告挻宀搁幃妤咁敆娴ｈ櫣鐦堥梺姹囧灲濞佳勭墡闂備浇鍋愰幊鎾存櫠閻ｅ苯鍨濋柡鍕箞娴滃綊鏌熼悜妯诲暗闁告﹩浜濈换婵嬫偨闂堟刀銏㈢磼缂佹ê绗ф俊鍙夊姍楠炲秹顢欓崜褝绱查梺鑽ゅТ濞层倕顕ｉ崼鏇€澶愬閵堝棛鍘搁悗鍏夊亾閻庯綆鍓涜ⅵ婵°倗濮烽崑娑樏洪鐐垫殾婵°倕鎳庢导鐘绘煏婢诡垰瀚▍鎺楁⒒閸屾艾鈧娆㈠璺虹劦妞ゆ帒鍊告禒婊堟煠濞茶鐏￠柡鍛埣椤㈡稑鈽夐弽锔剧泿闂備線娼ч…鍫ュ磿鐠囧樊鍟呴柕澶涜礋娴滄粓鏌￠崶鏈电敖缂佸鍠楅妵鍕閳╁啰顦版繝纰樷偓宕囧煟鐎规洖宕灃闁告劑鍔戦崣锟犳⒒娴ｇ瓔鍤欐繛瀵稿厴楠炲﹪骞樼€靛摜褰炬繝鐢靛Т濞层倗绮ｅΔ浣瑰弿婵☆垱瀵х涵鍓х磼閳ь剚寰勯幇顓涙嫼闂佸壊鐓堥崳顕€宕曢幋鐘电＜闁绘宕甸悾娲煛鐏炵澧茬€垫澘瀚埀顒婄秵娴滅偞绂掗幘顔解拺閻犲洠鈧櫕鐏嶉梺鎼炲妼婢у酣骞戦姀鐘闁靛繒濮烽ˇ褔姊洪崗鑲┿偞闁哄懏绮撳畷铏鐎涙ê鈧敻鎮峰▎蹇擃仾缂佸矁娉曠槐鎺旂磼濡偐鐤勯梺缁樹緱閸犳骞嗛弮鍫澪╅柨鏇楀亾婵炲牏鍠栧娲濞戣鲸肖闂佺瀵掗崳锝呯暦閹达箑绠婚悹鍥ㄥ絻閻庮厼顪冮妶鍡楀闁稿﹥顨婇、娆撳即閵忊檧鎷洪梺鑽ゅ枛閸嬪﹪宕甸悢鍏肩厱閹兼番鍨规慨鍫ユ倵闂堟稏鍋㈢€规洖宕埥澶娾枎閹存繂绠ラ梻浣告惈椤︻垶鎮ч幘鍓佷笉闁哄诞宀€鈧埖銇勯弴妤€浜鹃梺鍝勬湰缁嬫捇鍩€椤掑﹦绉靛ù婊勭矒閸┾偓妞ゆ巻鍋撴繛灏栤偓鎰佸殨閻犲洤妯婇崥瀣煕椤愵偄浜濇い搴℃喘濮婄粯鎷呴崨濠傛殘闂佽鎮傜粻鏍х暦閻楀牊鍎熸い顓熷笧缁嬪繘妫呴銏″缂佸甯″畷鎰磼濡湱绠氬銈嗙墬缁诲秹宕靛▎鎰╀簻妞ゆ劦鍓涚弧鈧┑顔硷攻濡炰粙骞冮悜钘夌骇闁圭宸╅埡鍛拺闁稿繐鍚嬮妵鐔兼煕閵娿劍纭鹃柣锝囧厴婵偓闁靛牆鎳愰崝鎾⒑閸涘﹤濮﹀ù婊呭仱閹線宕奸妷锔规嫼闂佸憡鍔樼亸娆忊枔闁秵鐓曢悗锝庡亝瀹曞矂鏌＄仦鍓ф创鐎殿喗鎸抽幃娆撳礂閸濄儵鈹忛梻鍌欐缁鳖喚寰婃禒瀣亯闁绘挸瀵掑鏍煟閹寸伝顏堫敋鏉堛劎绠鹃柛鈩兠悘銉╂煕閳轰胶鐒告慨濠呮閹风娀鎳犻鍌ゅ敼婵犳鍠楄彠闁告柨閰ｅ畷姘跺箳濡ゅ﹥鏅ｉ梺闈涚箚閳ь剙鍘栫花濠氭⒒娴ｈ櫣甯涢柟鍝ヮ焾闇夐柣鎴ｆ缁€澶愭煥閺囨浜惧銈庝簻閸熷瓨淇婇崼鏇炲耿婵°倐鍋撴繛鍏煎灴濮婅櫣绮欏▎鎯у壉闂佸湱顭堥…閿嬩繆閻㈢绀嬫い鏍ㄨ壘瀹撳棗顪冮妶鍛婵☆偅绋栭埅闈涒攽閿涘嫬浜奸柛濠冨灴瀹曠懓煤椤忓懎浠梺鍐叉惈閹冲海绮婚弽銊х闁糕剝蓱閹嫰鏌℃担鍛婎棦闁哄苯绉烽¨渚€鏌涢幘瀵糕姇缂佹梻鍠栧鎾閳哄倹娅栭梻浣虹帛閸旀鎮伴妷鈺佺婵炲樊浜濋埛鎴︽煕濞戞﹫鍔熼柍钘夘樀閺屻劑寮撮鍕垫喘缂備緡鍠栭…鐑界嵁濡偐纾兼俊顖濄€€閸嬫捇宕归锝呭伎濠碘槅鍨抽崢褏鏁懜鐢电闁告侗鍘捐倴闂侀€炲苯澧叉い顐㈩槸鐓ら煫鍥ㄧ☉閸ㄥ倸霉閻樺樊鍎忛柦鍐枛閺屾盯鍩勯崘鐐吂闂佸憡鑹鹃澶愬蓟濞戙垹鐏崇€规洖娲ㄩ澶愭煟?
  useEffect(() => {
    const unsubscribe = cacheEvents.subscribe((type, data) => {
      if (type === 'prompts') {
        // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻娑樷槈濮楀牊鏁鹃梺鍛婄懃缁绘﹢寮婚敐澶婄婵犲灚鍔栫紞妤呮⒑闁偛鑻晶顕€鏌涙繝鍌涜础缂侇喖顑夐獮鎺楀棘閸濆嫪澹曢梺鎸庣箓缁ㄨ偐鑺辨禒瀣厱闁哄啯鎸鹃悾杈ㄣ亜椤忓嫬鏆ｅ┑鈥崇埣瀹曞崬螖閳ь剙顭囬幋锔解拺缂佸顑欓崕鎰版煙閻熺増鍠樼€殿喛顕ч埥澶愬閳ュ厖绨婚梻鍌欑閻忔繈顢栭崨顔绢浄闁圭虎鍠楅埛鎴犵磼椤栨稒绀冮柡澶婄秺閺屾稓鈧綆鍋呯亸顓熴亜椤忓嫬鏆ｅ┑鈥崇埣瀹曞崬螖閳ь剙顭囬幋锔解拺缂佸顑欓崕鎰版煙缁嬪灝鈷旀俊鍙夊姍楠炴﹢骞囨担鍛婂€梻浣告啞缁矂宕幎钘夎Е妞ゆ劏鎳￠弮鍫熷亹闂傚牊绋愮划鍫曟⒑閸濄儱娅忛柛瀣樀閹﹢骞掑Δ浣哄幗闂佺粯锚瀵墎绮氶崸妤佸€堕煫鍥ㄦ⒒閹冲懐绱掗鍡欑М闁诡喗鐟╅幃婊兾熼柨瀣伖闂佽崵鍠愮划搴㈡櫠濡ゅ啯鏆滈柟鐑樻尵椤╂彃霉閻撳海鎽犻柣鎾存礋閺岀喖骞嗚閸ょ喖鏌熼崘鍙夊枠闁哄瞼鍠栭、姘跺焵椤掆偓椤洩顦堕柣蹇斿浮濮婃椽鎮℃惔顔界稐闂佺锕ラ〃濠囧箚娓氣偓瀹曞ジ濡烽敂瑙勫闂傚倸鍊搁悧濠囨儎椤栫偞鍋樻繝濠傛噽绾惧ジ鏌熺紒妯虹瑨闁抽攱姊圭换娑㈠箣閻樿櫕姣堥梺璇″枟閻熲晠銆侀弽顓炵煑闁靛／鍛櫒闂傚倸鍊烽懗鍫曞箠閹剧粯鍋ら柕濞у嫬搴婇梺鍛婂姦閸熺喐寰勯幇顓炰汗缂傚倷鐒﹂…鍥储娴犲鈷戦梻鍫熶緱濡牓鏌涢悩铏闁哄苯娲、娑樷槈閺嶏妇鐩庨梻渚€娼ф蹇曟閺囩伝娲箻椤旂晫鍘靛銈嗘⒒閺咁偊骞婇崨瀛樼厓鐟滄粓宕滃☉銏犳瀬闁归棿璁查埀顒婄畵瀹曞ジ濡疯缁侊箓姊虹憴鍕棆濠⒀勵殜閸╂盯骞掗幊銊ョ秺閺佹劙宕熼鍛Τ闂備胶绮敮锛勭不閺嶎厼钃熼柨鐔哄Т闁卞洦銇勯幇鈺佺仼妞ゎ偒鍋嗙槐鎾寸瑹閸パ勭亶闂佽崵鍟块弲鐘绘偘椤旈敮鍋撻敐鍌涙珖缂佸鐡ㄧ换婵嬪閿濆棛銆愭繝銏ｆ硾濞差厼鐣烽幋锕€绠荤紓浣股戝▍婊堟煙閼测晞藟闁逞屽墲鐏忔瑩寮弽顐ょ＝?prompt 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳婀遍埀顒傛嚀鐎氼參宕崇壕瀣ㄤ汗闁圭儤鍨归崐鐐烘偡濠婂嫮鐭婇棁澶愭煛瀹ュ骸骞楅柣鎾崇箰閳规垿鎮欓棃娑楀濠电偛鎳庡Λ婵嬪蓟濞戙垹围闁告侗鍙庢导鍐⒑閸濆嫯顫﹂柛濠冾殘閸掓帒鈻庨幋鐐茬／闂侀潧顭堥崐妤併仚閾忣偆绡€闁汇垽娼ф禒婊堟煙閾忣偄濮堥柟渚垮姂瀹曞綊顢曢妶鍌涙暤濠电姷鏁告慨鏉懨洪妶鍛函闂傚倷鑳堕…鍫ュ嫉椤掑嫭鍎楁い鏃傛櫕閻濆爼鏌￠崶銉ョ仾闁抽攱甯掗湁闁挎繂顦藉Λ鎴濃槈閹剧懓鐨虹紒杈ㄥ浮閻擃偊顢橀悩鐢靛幆闂備浇顕栭崰妤呮晪濡炪値鍋呯换鍐焽韫囨稑鐓涢柛鎰典簼濞堜粙姊婚崒娆掑厡缂侇噮鍨伴～蹇旂節濮橆剙鍋嶉悷婊勬楠炲啴鎮欓崫鍕€銈嗗姉婵磭鑺辨繝姘拺闁革富鍘奸崝瀣煕閵娧勬毈妞ゃ垺妫冮崺锟犲川椤旀儳骞愰梺璇插嚱缁叉椽寮查悙鍝勭鐎光偓閸曨剛鍘撻悷婊勭矒瀹曟粌鈻庨幋鐘辩瑝閻庡箍鍎遍ˇ顖滃閸ф鈷戞い鎺嗗亾缂佸顕划濠氭偐缂佹鍘甸梺缁橆殔閻楀﹦娆㈤崣澶嬪弿閻熸瑥瀚崣鈧梺鍝勬湰閻╊垶宕洪崟顖氱妞ゅ繋绀侀～宀勬⒒娴ｈ櫣甯涢柟鍛婃倐瀹曨垱瀵奸弶鎴犵枀缂備礁顑嗛娆撴偂閵夆晜鐓曟い鎰剁悼缁犳ɑ銇勯敂璇插箹闁宠鍨块幃娆撳矗婢舵ɑ锛侀梻浣规偠閸旀垵顭囪椤㈡岸鏁愭径濠呮憰闂侀潧顧€閼靛綊骞忕紒妯肩閺夊牆澧界€靛ジ鎮归埀顒勬晝閳ь剟鈥﹂崶顒€绠虫俊銈勮兌閸橀亶姊洪崫鍕窛闁稿鍠愮粋鎺戔槈閵忥紕鍘介梺鎸庣箓閹冲酣銆傚畷鍥╃＜閺夊牄鍔嶇亸浼存煙瀹勭増鍤囩€规洦鍋婂畷鐔煎箣椤栨粌鍩岄梺瀹狀潐閸ㄥ潡骞冨▎鎴炲珰鐟滄垿宕ラ锔藉€垫繛鍫濈仢閺嬫稒銇勯鐐叉Щ妞ゆ洩缍侀獮姗€顢欓挊澶夌盎濠碉紕鍋涢鍛归悜鑺ュ仒妞ゆ梻鏅弧鈧梺姹囧灲濞佳勭閿曞倹鐓曟い顓熷灥閻忥妇鈧娲滈幊鎾跺弲濡炪倕绻愮粔鐢稿疾濞戙垺鍊垫鐐茬仢閸旀碍绻涚仦鍌氬濠㈣娲熼幐濠冪珶濠靛棛绉洪柡浣瑰姈瀵板嫬鐣濋埀顒傜玻濡も偓閳规垿鏁嶉崟顐″闂佽鍠栭崐鍨嚕鐠囨祴妲堥柕蹇曞閳哄懏鐓忓璇″灠閸熶即宕㈡禒瀣厽?prompts 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕閵堝懎顏柡灞剧洴楠炴﹢鎳犻澶嬓滈梻浣规偠閸斿秶鎹㈤崘顔嘉﹂柛鏇ㄥ灠閸愨偓濡炪倖鍔﹀鈧慨瑙勵殜濮婃椽鏌呴悙鑼跺濠⒀冨⒔缁辨帡鎮╅搹顐㈢闂佷紮缍侀弨杈╃紦閻ｅ瞼鐭欓悹鍥﹀嫎閸旀垿寮婚弴鐔风窞婵炴垯鍨洪宥夋偠濮樺墽绉慨濠傤煼瀹曟帒鈻庨幋顓熜滈梻浣告贡閳峰牓宕戦崱娆忓灊婵炲棙鍔楅悷褰掓煃瑜滈崜娆撴偩閻戣棄顫呴柨娑樺濡绢噣姊洪崨濠勨槈闁挎洏鍊濋崺鈧?
        if (data && typeof data === 'object' && 'id' in data) {
          const updatedPrompt = data as Prompt;
          setPrompts((prev) =>
            prev.some((p) => p.id === updatedPrompt.id)
              ? prev.map((p) => (p.id === updatedPrompt.id ? updatedPrompt : p))
              : [updatedPrompt, ...prev]
          );
          // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎梺鐟板⒔缁垶宕戦幇鐗堢厱闁归偊鍓欑痪褔鏌ｉ妶鍛仼闁宠鍨堕獮濠囨煕婵炑冩噹缁躲倕霉閻樺樊鍎忛柣銈庡枟閵囧嫰骞囬埡浣插亾閹版澘纾婚柟鐐墯濞尖晜銇勯幒鎴Ч閺佸牓姊绘笟鈧褍煤閵堝洠鍋撳顐㈠祮闁绘侗鍣ｉ獮鎺懳旈埀顒勭嵁閵忊€茬箚闁绘劖娼欓崝銈嗐亜閵夛箒澹橀柍瑙勫灴閺佸秹宕熼鈩冩線闂備胶顭堥…鍫ュ磹閺嶎偆鐭夌€广儱鎷嬮悡銉╂煕椤愶絿绠橀柡灞界墦濮婃椽宕崟鍨ч梺鎼炲妼缂嶅﹤顕ｉ幎鑺ユ櫇闁稿本绋撻崢鐢告⒑缂佹ê鐏﹂柨鏇楁櫅閳绘捇寮撮姀锛勫幈婵犵數濮寸€氼剟宕㈤幘顔界厸鐎光偓閳ь剟宕伴幘鑸殿潟闁圭儤鍤﹂悢鍏兼優闁革富鍘介崳顖滅磽閸屾艾鈧嘲顪冮幒鏃€顐介柨鐔哄Т闂傤垶鏌ㄥ┑鍡樺婵炲吋鐗犻弻褑绠涘鍏肩秷闁诲孩纰嶅畝鎼佸蓟閻旇櫣纾兼俊顖濇〃閸掑﹪姊洪崨濠冪叆妞わ箒浜Σ鎰板箻鐎涙ê顎撻梺鍛婃尰瑜板啴宕滈柆宥嗙厽闁靛繆鏅涢悘锝夋煕閻樺磭澧甸柣娑卞枛铻栭柛婊€鐒﹂弲婵嬫⒑閹稿孩顥嗙悮娆撴煙閻ゎ垱顏犵紒杈ㄦ崌瀹曟帒鈻庨幋婵嗩瀴闂佽棄鍟存禍鍫曞箖濡法鐤€閻庯綆浜滈～鍥⒑?listCache闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕婵犲倹鍋ラ柡灞诲姂瀵噣宕奸悢鍛婎唶闂備胶顭堥鍡涘箰閸撗冨灊妞ゆ挾鍋愬Σ鍫熶繆椤栨繍鍤欐繛鍛囧洦鈷戞繛鑼额嚙楠炴鏌ｉ悢鍙夋珚鐎殿喖顭烽幃銏ゅ川婵犲嫮肖濠德板€х徊浠嬪疮椤栫儐鏁佺€广儱顦伴埛鎴犵磼鐎ｎ偒鍎ラ柛搴＄箲閵囧嫰骞嬪┑鎰枅閻庢鍠涢褔鍩ユ径鎰潊闁绘﹢娼ф慨鍫曟⒒娴ｅ憡鍟為柛鏃撻檮缁傚秹寮介‖顒佺洴婵℃悂鍩￠崒妤佸闂傚倷绶￠崑鍡涘磻濞戙垺鍤愭い鏍ㄧ⊕濞呯姵銇勯弴妤€浜鹃梺鍝勭灱閸犳牠骞栬ぐ鎺濇晝闁挎繂鎳愰敍鎾绘⒑閼恒儔鎴犳崲閸儱钃熸繛鎴欏灪閺呮粓鎮归崶銊ョ祷缂佺姳鍗冲铏圭矙濞嗘儳鍓遍梺鐟版啞閹倿宕洪姀銈呯閻犲洦褰冮悗顓烆渻閵堝棙鈷掗柡鍜佸亝缁傚秹鎮欓璺ㄧ畾闂佺粯鍔︽禍婊堝焵椤戞儳鈧繂鐣烽姀锛勯檮闁告稑锕ゆ禍閬嶆⒑鐟欏嫬绀冩い鏇嗗洦鍊堕柟鎯板Г閻撱儵鏌￠崶鈺佷粶闁逞屽墮閹诧繝宕曢锔解拻濞达絽鎽滈弸鍐╀繆濡炵厧濮傞柟铏殜瀹曞ジ寮撮埀顒勫炊椤掆偓鎯熼梺闈涱樈閸犳鈧潧鐭傚娲濞戞艾顣洪梺纭呮珪閸旀鍒掔紒妯侯嚤閻庢稒顭囬崢鐢告⒑閸涘﹤濮岄悘蹇旂懅缁鎳￠妶鍌氫壕閻熸瑥瀚壕濠氭煕濡も偓閸熷潡顢氶敐鍡欘浄閻庯絽鐏氶弲锝夋⒑缂佹ɑ鐓ョ€殿喖澧庨埀顒佷亢濡嫰鍩為幋锔藉€烽悗娑櫭棄宥夋⒑缁洘娅呴柛鐔告綑閻ｇ兘骞嬮敃鈧粻濠氭倵闂堟稒鎲告い鏃€娲熷娲嚌闁附缍堝┑鐘灪閿曘垹鐣烽妷銊ｄ汗闁圭儤鎸鹃崢鎾绘偡濠婂嫮鐭掔€规洘绮撻幃銏＄附婢跺苯濮洪柣鐔哥矋濡啴鐛崱妤冩殕闁告洦鍋嗛敍婊堟⒑缂佹ê濮岄悘蹇旂懇閹儳煤椤忓應鎷洪梺鍝勫€堕崕鎻掆枍閸涘瓨鐓曢柣鏇氱娴滅偞绻涢崱鎰伈闁诡喗鐟╅幃婊兾熺悰鈥充壕闁割偅娲橀悡鐔兼煙闁缚绨界紒渚€鏀辨穱濠囧箚瑜庨崯鐐电磼?
          if (listCache) {
            listCache.prompts = listCache.prompts.some((p: Prompt) => p.id === updatedPrompt.id)
              ? listCache.prompts.map((p: Prompt) => (p.id === updatedPrompt.id ? updatedPrompt : p))
              : [updatedPrompt, ...listCache.prompts];
          }
        } else {
          // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻橀弻锝夊箣閿濆棭妫勯梺鍝勵儎缁舵岸寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ゆい顓犲厴瀵鏁愭径濠勭杸濡炪倖甯婇悞锕傚磿閹惧墎纾藉ù锝呮惈灏忛梺鍛婎殕婵炲﹤顕ｆ繝姘亜闁稿繐鐨烽幏濠氭煟鎼淬劍娑у鐟帮工鍗辨い鏂垮⒔绾捐棄霉閿濆懏鎯堥崯鍛婄節濞堝灝鏋涢柣蹇旀皑缁碍娼忛妸褏鐦堥梺鎼炲劥閸╂牠寮查鈧埞鎴︽偐缂佹ɑ閿柣搴㈢殰閸パ咃紱闂佽宕橀褔鎮為崹顐犱簻闁圭儤鍨甸顏堟煟閹惧娲撮柟顔筋殜閺佹劖鎯斿┑鍫熸櫦闂佽桨绀侀悧鍡氱亙闂佺粯锕㈠褎绂掗敃鍌涚厽婵°倓鐒︾粈澶屾喐妫颁胶顦︽い顏勫暣婵″爼宕卞Δ鈧鎴︽⒑缁嬫鍎愰柟鍛婃倐閸╃偤骞嬮敂绛嬧偓鎰版⒑缁嬫鍎愰柛鏃€顨呭嵄闁圭増婢樼粻铏繆閵堝倸浜鹃梺缁樺笒閻忔岸濡甸崟顖氱闁瑰瓨绻嶆禒鐓幬旈悩闈涗杭闁搞劎鍎ょ粚杈ㄧ節閸ヨ埖鏅┑顔斤供閸欌偓缁绢厸鍋撶紓鍌氬€烽懗鑸垫叏闂堟稓鏆嗙紒瀣儥濞兼牗绻涘顔荤凹妞ゃ儱鐗婄换娑㈠箣閻愯泛顥濆銈忕稻濡炶棄顫忓ú顏呭仭闁哄瀵уВ鎰版⒒娴ｇ绨荤紓宥勭窔婵″瓨绗熼埀顒€顕ｉ鈧畷鐓庮熆椤忓倸濮傞柡灞界Ч瀹曨偊宕熼鐔蜂壕濠电姵鑹鹃崒銊╂煙閸撗呭笡闁稿鍓濈换婵囩節閸屾凹浼€闂佹椿鍘界敮鐐哄焵椤掑喚娼愭繛鍙夘焽閸掓帒鐣濋崟顐ゅ幒闁瑰吋鐣崝宀€绮婚懡銈傚亾鐟欏嫭绀€婵炶绠撻幃鐐淬偅閸愨斁鎷绘繛杈剧悼閻℃柨顭囬幇顓滀簻闁哄啠鍋撻柣妤冨Т閻ｇ兘寮剁拠鐐瀹曨亪宕橀鍡忔（闂傚倷绀侀幖顐⒚洪姀銈呭瀭婵炲樊浜濋崑鍌涚箾閸℃ɑ灏伴柣鎾寸懇閹嘲鈻庤箛鎿冧患婵犳鍣粻鎾诲蓟濞戙垹围闁糕剝鐟﹂崳顔剧磽娴ｄ粙鍝洪悽顖ょ節楠炲啴鍩￠崨顓濈炊闂佸憡娲﹂崑鍛村磿椤忓牊鈷掑〒姘ｅ亾闁逞屽墰閸嬫盯鎳熼娑欐珷闁告瑥顦禍婊勩亜閹扳晛鐒烘俊鍙夋倐閹繝濡舵径瀣幐閻庡箍鍎卞ù閿嬬鐟欏嫮绠剧€瑰壊鍠曠花濂告煛閸涱喚绠為柡灞剧〒娴狅箓鎮欓鍌涱吇闂備焦鐪归崐鏇㈠箠韫囨洘宕叉繝闈涱儐椤ュ牊绻涢幋鐐冩岸宕戦幘璇茬濞达絽鎽滈悿鍛存⒑鐠恒劌鏋斿┑顔芥尦閹繝寮撮姀锛勫幍闁哄鐗撶粻鏍ь瀶椤曗偓閺岋綁骞樼€靛憡鍣紓浣介哺鐢偤鍩€椤掑﹦绉甸柛瀣椤㈡艾顭ㄩ崼鐔哄幍闂佽皫鍐╂喐缂佸鍣ｉ弻锛勪沪閻ｅ睗褔鏌熺粙鍖℃敾鐎垫澘瀚灒闁诡厼绋勭粻鎾愁潖閾忓厜鍋撻崷顓烆€屾繛鍏煎姍閺屾盯濡搁妷褌铏庨梺浼欑悼閸忔﹢鐛幒妤€绠ｉ柡鍐ｅ亾妞ゎ偄绉撮埞鎴︽倷閸欏妫為梺鍝勭墱閸撴盯鍩€椤掍焦鐨戦柡鍜佸亞濡叉劙骞樼拠鑼紲濠电偛妫欓崹鑲╃玻濡ゅ懏鈷戦梻鍫氭櫇缁夌敻鏌涢敐蹇曞埌闁伙絿鍏橀弫鎰緞婵犲嫷妲伴梻渚€娼ц噹闁告洦鍓﹂崯搴ㄦ⒒閸屾瑧绐旀繛浣冲棗顤傞梻浣告惈閹冲寮查悩宸殨妞ゆ劧绠戦悙濠囨煏婵炑冩媼閸熷酣姊绘担鐑樺殌妞ゆ洦鍙冨畷鎴︽偄閻撳海鐤囬梺鍛婄☉閻°劑鎮￠崘顏呭枑婵犲﹤鐗嗙粈鍫熺箾閸℃ɑ灏ㄩ柍褜鍓ㄧ粻鎴︽偩閿熺姵鐒介柨鏃傛櫕缁嬩焦绻濋悽闈涗粶婵☆垰锕ョ粋宥呪攽鐎ｎ亞锛欓梺缁樺灱婵倝鎮￠姀鈥茬箚妞ゆ牗鐟ㄩ鐔镐繆閼碱剦鐒鹃柍瑙勫灴椤㈡瑦绺界粙鍨強婵犳鍠栭敃銉ヮ渻閽樺鏆︽い鎰剁畱鍞梺闈涱檧婵″洭鍩€椤掑喚鍤欓柍瑙勫灴閹瑩鎮欓崗澶婁壕閻庯綆鍓氬畷鍙夌節闂堟侗鍎忛柡瀣╃窔閺岀喖骞嶉纰辨毉闂佺锕﹂崗姗€寮婚敐澶婄闁绘劕妫欓崹鐢稿煝瀹ュ拋鐓ラ柛鏇ㄥ幘閻﹀牓姊洪棃娑㈢崪缂佹彃澧藉☉鍨偅閸愨晝鍙嗛梺鍝勬祩娴滎亜顬婇濮愪簻闁靛绲介崝锔锯偓瑙勬礀閻栧ジ銆佸Δ浣瑰闁告瑥顦鍦磽閸屾艾鈧悂宕愰悜鑺ュ€块柨鏇炲€归弲顏勨攽閻樻剚鍟忛柛鐘崇墵瀵敻顢楅崒娑樺簥濠电偞鍨堕悷銉ф閻愮儤鍊甸柨婵嗛婢у鏌ｈ箛鎾宠埞妞ゎ亜鍟存俊鎯扮疀閺囩姁鎴︽煟鎼达絿鎳楅柛娑卞枛鎼村﹤鈹戦悩缁樻锭闁绘妫濆鎼佸醇濠垫劗鍞甸柣鐘荤細濞咃綁鎮橀柆宥嗙叆婵炴垶鑹鹃弸娑欐叏婵犲懏顏犵紒顔界懃閳诲酣骞嗚婢瑰姊绘担鍝勫姦闁哄應鏅犲畷瑙勫鐎涙ê浠奸梺缁樺灱濡嫮绮诲☉銏＄厸濠㈣泛顑呴婊呪偓瑙勬尭缁夋挳鈥旈崘顔嘉ч柛鈩兠棄宥囩磽娴ｅ壊鍎愰柛銊ュ缁顓奸崱鎰簼闂佸憡鍔忛弲婵嬪储娴犲鈷戦梻鍫熺〒缁犵偤鏌涙繝鍐ⅹ闁宠棄顦抽ˇ褰掓煙椤旇崵鐭欐い銏＄☉閳规垿宕卞▎蹇撶細闂傚倷绶氬褍煤閵堝洠鍋撳顐㈠祮闁靛棔绶氬鎾閳╁啯鐝抽梻浣规偠閸庮噣寮插┑瀣辈妞ゆ挶鍨洪埛鎺懨归敐鍛暈閻犳劧绻濋弻鐔兼惞椤愶絽鏆楅梺閫炲苯澧柣顓у櫍瀹曪繝骞庨悾灞界ウ闂佸憡鍔﹂悡鍫ユ偂閵夆晜鐓曢柟閭﹀枛娴滃墽鈧偣鍊栧钘夘潖閾忕懓瀵查柡鍥╁仜閳峰鈹戦悙鎻掔骇闁挎洏鍨归悾鐑藉传閸曘劍顫嶉梺闈涚箚濡狙囧箯婵犳碍鈷戠紒瀣濠€浼存煠瑜版帞鐣洪柛鈹惧亾濡炪倖甯掔€氬嘲螞閹寸姷纾兼い鏃囧亹婢ф稓绱掑Δ鍐ㄦ灈闁糕斁鍋撳銈嗗笒鐎氼喖鐣垫笟鈧弻鈥愁吋鎼粹€冲闂佽桨绀侀崯鎾蓟閵娾晛鍗虫俊銈傚亾濞存粌澧界槐鎺楁倷椤掆偓閸斻倗绱撳鍜冭含妤犵偛鍟悾锟犲箥閾忣偆鈧妫呴銏″闁瑰皷鏅滅粋鎺撶附閸涘ň鎷洪梺纭呭亹閸嬫稒淇婃禒瀣厸閻忕偠顕ф慨鍌涚節閳ь剚绗熼埀顒€顫忛搹鍦＜婵☆垰娴氭禍婊嗙亽婵犵數濮村ú銈囧閸ф鐓欓悗鐢殿焾琚ラ梺绋款儐閹搁箖骞夐幘顔肩妞ゆ巻鍋撻柣顓у枤缁辨挻鎷呴挊澶屽帿閻庡厜鍋撻柟闂寸缁犳牠鏌ㄩ悢鍝勵€岄柡浣稿暣閺屻劑寮村Δ鈧禍楣冩⒑缂佹ê濮囬柨鏇ㄤ邯瀵寮撮悢铏诡啎閻熸粌顦靛畷鎴﹀箻缂堢姷绠氶梺鍦帛鐢偞鏅堕敂鑺ュ弿濠电姴鍊归幆鍫ユ偂閵堝鍋ｉ柛銉ｅ妼缁茶崵绱掗悩鍙夋儓妞ゎ亜鍟存俊鍫曞礃閵娿儺鐎抽梻浣瑰濞诧附绂嶅鍫晪闁挎繂妫涚弧鈧┑顔斤供閸撴稒瀵肩€ｎ喗鈷戠憸鐗堝俯閺嗘帞绱掗埀顒佺瑹閳ь剟鐛崘顔肩闁挎棁袙閹锋椽姊洪崨濠勨槈闁挎洏鍊栭幈銊╁磼閻愬鍘遍梺鍝勫€藉▔鏇㈡倿閹间焦鐓冮柕澶涘婢ь剛鈧灚婢樼€氼厾鎹㈠☉銏″€锋い鎺嶇劍濠㈡垿姊婚崒娆掑厡缂侇噮鍨跺畷婵單熼梻瀵稿墾濠电偛妫欓崝鏍р枍閻樼粯鐓涢柛銉ｅ劚閻忣亪鏌ｉ幘璺烘灈闁哄备鈧磭鏆ゆい鏃囧吹椤︼箑霉閻欌偓閸ｏ綁骞?
          listCache = null;
        }
      }

      if (type === 'promptGroups') {
        (async () => {
          try {
            const promptGroupsData = await promptGroupsApi.list();
            const latestPromptGroups = (promptGroupsData || []) as PromptGroup[];
            setPromptGroups(latestPromptGroups);
            if (listCache) {
              listCache.promptGroups = latestPromptGroups;
            }
          } catch (e) {
            console.error('Failed to refresh prompt groups:', e);
          }
        })();
        return;
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
    // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻橀弻锝夊箣濠垫劖缍楅梺閫炲苯澧柛濠傛健楠炴劖绻濋崘顏嗗骄闂佸啿鎼鍥╃矓椤旈敮鍋撶憴鍕８闁告梹鍨甸锝夊醇閺囩偟顓洪梺缁樼懃閹虫劙鐛姀銈嗏拻闁稿本鐟х粣鏃堟煃瑜滈崜娑㈠磻濞戙垺鍤愭い鏍ㄧ⊕濞呯娀鏌熺紒銏犳灍闁绘挻鐩幃姗€鎮欓幓鎺嗘寖闂侀潧妫欑敮锟犲蓟瀹ュ牜妾ㄩ梺鍛婃尪閸斿海妲愰悙鍝勫耿婵炴垶顭囬敍娑㈡⒑閸涘﹣绶遍柛姗€绠栧鎶芥晜闁款垰浜鹃柛蹇擃槸娴滈箖姊洪崨濠冨闁告挻鐩畷銏ゅ箹娴ｇ懓鈧敻鏌涜箛鎿冩Ц濞存粓绠栭弻锝嗘償椤栨粎校闂佸憡鎸婚惄顖炲极瀹ュ鍋勯柛婵勫劤椤旀洟鏌ｆ惔锝嗘毄妞ゎ厼鐗撻、鎾诲箻閺傘儲鏂€闂佺偨鍎村▍鏇㈠窗濡椿娈介柣鎰皺缁犲鏌熼瑙勬珖闁归濞€閹崇娀顢楁径濠冩澑闂傚倸鍊风粈浣革耿闁秴纾块柕鍫濐槸閸氬綊鏌嶉崫鍕櫣缂佺媴缍侀弻锝呂熼崗鍏兼瘎闂佹寧绋掔换鍫濐潖閾忓湱鐭欓柟绋垮閹烽亶姊洪懡銈呮殌闁搞儜鍜佹Х闁诲骸绠嶉崕閬嵥囨导瀛樺亗闁哄洢鍨洪悡鐔兼煙闁箑鏋熼柡鍡忔櫊閹粙顢涘☉姘ｆ闁兼寧鍔欓弻娑㈠Ψ閹存繄啸闁告凹鍋婇幃妤冩喆閸曨剛顦ラ梺缁樼墪閵堟悂濡存担鑲濇棃宕ㄩ鐘插Е婵＄偑鍊栫敮鎺斺偓姘煎弮瀹?- 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愮儤鍋嬮柣妯荤湽閳ь兛绶氬鎾閳╁啯鐝曢梻浣藉Г閿氭い锔诲枤缁辨棃寮撮姀鈾€鎷绘繛杈剧秬濞咃綁濡存繝鍥ㄧ厱闁规儳顕粻鐐烘煙閽樺鈧鍩€椤掑﹦绉甸柛鐘崇墵閹瑦绻濋崶銊у帾婵犵數濮寸换鎰般€呴鍌滅＜濠㈣泛锕﹂崺锝嗘叏婵犲啯銇濈€规洘锕㈠畷锝嗗緞鐎ｎ亜澹嶉梻鍌欒兌椤牓顢栭崨顓囨稑螖閸涱亖鍋撻敃鍌氱倞妞ゆ帊绀佹禍婊堟⒑缁嬭法绠伴柣銊у厴楠炲繐煤椤忓應鎷洪梺闈╁瘜閸欏酣鎮炴ィ鍐╁€垫繛鎴炲笚濞呭﹪鎸婇悢鍏肩厱妞ゆ劗濮撮崝婊堟煟閹惧鈽夐柕鍡樺笒椤繈顢楁担瑙勫€锋繝鐢靛仜閹冲海绮旈崼鏇炵劦妞ゆ帒鍠氬鎰箾閸欏鑰跨€规洖缍婂畷绋课旈崘銊с偊婵犳鍠楅妵娑㈠磻閹惧灈鍋撳▓鍨珮闁告挾鍠愭穱濠囨倻閼恒儲娅嗙紓鍌欑劍椤洨绮旈悙顒傜瘈闁汇垽娼у暩闂佽桨鐒﹂幃鍌氱暦閹存績妲堟俊顖涚矋缁嬫垿鍩㈡惔銊ョ妞ゆ牗顨呮禍楣冩煥閺囩偛鈧悂鎮欐繝鍐︿簻闁瑰搫妫楁禍鍓х磽娴ｆ彃浜炬繝銏ｆ硾婢跺洭宕戦幘缁樺仭闁哄顑欐禒鐐節閵忋垺鍤€妞ゆ垵顦锝夊Ω閿旂虎娴勯柣搴秵閸嬪棝宕㈡禒瀣拺鐟滅増甯掓禍浼存煕濡吋娅曠紒杈╁仱楠炲鎮╅悽纰夌床闂備浇鍋愰埛鍫ュ礈濞戞碍鏆滄繛鎴炴皑绾捐偐绱撴担璇＄劷闁靛棙甯楃换娑㈠箣濠靛牅绮靛銈忓婢ф骞嗛弮鍫熸櫜闁搞儺鐓堝鎾绘⒒閸屾艾鈧兘鎳楅崜浣稿灊妞ゆ牗绋撻悷瑙勪繆閵堝懏鍣归梻鍌ゅ灦閺屻劌鈹戦崱鈺傂ㄩ悗瑙勬尫缁舵岸寮婚悢鍏煎€绘俊顖滃劋椤旀洟姊洪崫鍕殭闁绘妫濋幃鐐哄垂椤愮姳绨婚梺鐟版惈濡绂嶆ィ鍐┾拺閺夌偞澹嗙拹浼存煕閿濆繒鍒版い顐㈢箳缁辨帒螣閼测晜鍤岄梻渚€鈧偛鑻晶顔姐亜椤撶偞绌挎い锕€缍婇弻鐔碱敊閵娿儲鎼愭鐐灪缁绘盯骞嬮悜鍡欏姺闂佹眹鍊曞ú锔炬崲濠靛顫呴柨婵嗘噽閸橆偊姊洪崨濠冣拹婵炶尙鍠庨悾宄扳枎閹炬潙浜归梺鐓庮潟閸婃洝銇愰崟顖涒拺闁硅偐鍋涢崝姗€鏌涢弬鍧楀弰闁糕晛锕鎾閿涘嫬甯?
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

    // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻娑樷槈濮楀牊鏁鹃梺鍛婄懃缁绘﹢寮婚敐澶婄婵犲灚鍔栫紞妤呮⒑闁偛鑻晶顕€鏌涙繝鍌涜础缂侇喖顑夐獮鎺楀棘閸濆嫪澹曢梺鎸庣箓缁ㄨ偐鑺辨禒瀣厱闁哄啯鎸鹃悾杈ㄣ亜椤忓嫬鏆ｅ┑鈥崇埣瀹曞崬螖閳ь剙顭囬幋锔解拺缂佸顑欓崕鎰版煙閻熺増鍠樼€殿喛顕ч埥澶愬閳ュ厖绨婚梻鍌欑閻忔繈顢栭崨顔绢浄闁圭虎鍠楅埛鎴犵磼椤栨稒绀冮柡澶婄秺閺屾稓鈧綆鍋呯亸顓熴亜椤忓嫬鏆ｅ┑鈥崇埣瀹曞崬螖閳ь剙顭囬幋锔解拺缂佸顑欓崕鎰版煙缁嬪灝鈷旀俊鍙夊姍楠炴﹢骞囨担鍛婂€梻浣告啞缁矂宕幎钘夎Е妞ゆ劏鎳￠弮鍫熷亹闂傚牊绋愮划鍫曟⒑閸濄儱娅忛柛瀣樀閹﹢骞掑Δ浣哄幗闂佺粯锚瀵墎绮氶崸妤佸€堕煫鍥ㄦ⒒閹冲懐绱掗鍡欑М闁诡喗鐟ч埀顒勬涧閹芥粓鎯侀崼銉︹拺婵懓娲ら悘鍙夌箾娴ｅ啿鍟伴幗銉╂⒒娴ｇ瓔鍤欓悗娑掓櫇缁瑩宕奸妷銉ф煣濠电偞鍩堝鍧楀焵椤掆偓閹冲繒缂撻悾宀€鐭欓悹鍥暜閺呯娀寮诲澶婁紶闁告洦鍋€閸嬫捇鎮界粙璺唵濠电偛妯婃禍婵嬪煕閹达附鐓曢柨鏃囶嚙瀵箖鏌ｉ幒鏂夸壕缂佺粯鐩獮姗€顢氶崨顕呮缂傚倷绶￠崰鏍€﹂悜鐣屽祦婵☆垵鍋愮壕鍏间繆椤栨粌甯舵鐐茬Ч濮婄粯鎷呴崨濠傛殘闂佸憡姊归…鍥ㄧ缁嬪簱鏋庨柟瀵稿С缁楀绻濋悽闈浶ｇ痪鏉跨Ч閹繝鎮㈤崗鑲╁幍闂佸壊鐓堥崰鏍汲濞嗗浚鐔嗙憸宥夋偤閵娾晛桅闁告洦鍨伴～鍛存煃閽樺顥為柣銈勭窔閹鎲撮崟顒傤槶闂佸摜濮甸悧鐘诲Υ娴ｈ倽鏃堝川椤撶媴绱叉繝娈垮枟閿曗晠宕滃☉銏″仾闁告洦鍨遍埛鎺楁煕鐏炴崘澹橀柍褜鍓熼ˉ鎾跺垝閸喓鐟归柍褜鍓熼悰顕€寮介褎鏅濋梺鎸庢磵閸嬫捇鏌ｉ妶搴℃灍闁靛洤瀚伴獮鍥礈娴ｇ儤娈哥紓浣哄亾閸庡磭绱炴繝鍥ц摕闁绘柨鍚嬮埛鎺旂棯閹屽剰闁告﹫绻濆娲焻閻愯尪瀚板褎鎸抽弻锟犲焵椤掍焦缍囬柍鍝勫€告惔濠傗攽閻樼粯娑фい鎴濇瀹曟垿濡搁埡鍌楁嫽闂佸壊鍋嗛崰鎾诲煟閵夛妇绠剧€光偓婵犱胶鐩庨梺瀹狀潐閸ㄥ潡骞冨▎鎾崇闁圭儤鎸搁埀顒夊灦濮婃椽鎳￠妶鍛€梺绋垮婵炲﹤鐣烽敐澶婂窛閻庢稒菤閹锋椽姊洪崷顓х劸閻庢稈鏅濇竟鏇㈡偨閸涘﹦鍘遍柣搴秵閸嬪懐浜告导瀛樼厪闁搞儜鍐句純濡炪們鍨洪敃銏ゅ箖濞嗘挸绾ч柟瀵稿Х瀹曟椽姊婚崒娆戭槮缂傚秴锕棢闁规儳鐡ㄩ崣蹇涙煙缂併垹鏋熺紒鐘冲浮濮婅櫣鎷犻幓鎺戞瘣缂傚倸绉村Λ婵嗙暦閹达箑骞㈡繛鎴烆焽閸旓箑顪冮妶鍡楀潑闁稿鎸婚妵鍕敇閻樻彃骞嬮悗娈垮枛椤兘骞冮姀銈嗗亗閹艰揪缍嗗Σ顖炴⒒娴ｇ鎮戠紒浣规尦瀵彃顭ㄩ崘锝嗙亖濡炪倖甯掔€氼參鍩涢幋锔界厱婵炴垶锕弨濠氭煟閹惧崬鍔﹂柡灞诲€曠叅閻犲洩灏欐禒鎼佹⒑缁洘鏉洪柛銊ょ矙閻涱喖顫滈埀顒€顕ｉ鍕ㄩ柨鏃囧Г濠㈡垿姊绘担绛嬪殭闁告垹鏅槐鐐哄幢濞戞锛涢梺绯曞墲缁嬫垿宕掗妸銉冨綊鎮╁顔煎壉闂佹娊鏀遍崹鍦閹惧瓨濯撮柛蹇擃槹閿涘牆顪冮妶鍛閻庢氨鍏樺畷鐢稿即閵忥紕鍘卞銈嗗姧缁插墽绮堥埀顒傜磽娴ｅ搫孝缂傚秴锕濠氭偄閻撳海顓煎銈嗘⒒閳峰牓寮抽銏♀拺缂佸灏呭銉╂煟韫囨柨鍝烘鐐茬墦婵℃悂濡锋惔锝呮灈闁诡喒鍓濋幆鏃堝灳閼碱剙绗℃繝寰锋澘鈧鎱ㄩ悜钘夌；闁绘劘銆€閳ь剨绠撳畷鍫曞煛閸屻倖缍楅梻浣告贡閸庛倝銆冭箛娑樻瀬濠电姴瀚Λ顖涖亜閹捐泛校闁绘帒娼￠弻娑橆潩閻撳簼绨婚柧缁樼墵閺岋絽顫滈埀顒€顭囪缁傛帡鏁冮崒娑氬弳闂佸搫娲﹂敋闁诲繑鐓￠弻鏇㈠幢閺囩媭妲梺瀹狀嚙闁帮綁鐛鈧鍫曞箣閻愬灚鐎梻鍌氬€风欢姘焽瑜旂瘬闁逞屽墮閳规垿鍨鹃搹顐も敍闂侀潧娲﹂崝娆愪繆閹间礁鐓涢柛灞绢殕鐎氳棄鈹戦悙鑸靛涧缂佹彃娼￠幃娲籍閸繂鎯炲┑鐐叉閸ㄥ湱澹曢懖鈺冪＝濞达絽顫栭鍔藉綊顢欓柨顖氫壕閻熸瑥瀚粈鍐煕閵娿儲鍋ユ鐐插暣閸╋繝宕ㄩ鐘靛幀闂備胶顭堥張顒傜矙閹捐秮铏光偓鐢电《閸嬫挾鎲撮崟顒傤槶闂佸摜濮甸悧鐘诲Υ娓氣偓瀵挳濮€閳ュ厖绨婚梻浣告啞閹哥顕ｉ崜浣虹鐎光偓閸曨兘鎷洪梺鐓庮潟閸婃洟寮搁幋鐘电＜妞ゆ棁鍋愭晥閻庢鍠栭…閿嬩繆閹间礁鐓涢悗锝庡墰閳笺倝姊绘繝搴′簻婵炶绠戦～蹇涙嚒閵堝懎袣闂侀€炲苯澧柍瑙勫灴椤㈡瑩寮妶鍕繑闂備礁鎲￠幐濠氭儎椤栨氨鏆﹂柟鎵閸婄兘鏌ｉ幋鐐冩岸骞忓ú顏呪拺闁革富鍙庨悞鐐箾閹绢噮妫戠紒顔碱煼楠炴绱掑Ο鐓庡箥闂備礁鎲￠崝妯间焊濞嗘劗澧＄紓鍌氬€烽悞锕€顫忔繝姘獥闁哄诞灞芥闂佸湱铏庨崰鏍綖閸涘瓨鐓冮梺娆惧灠娴滈箖姊鸿ぐ鎺撴暠婵＄偠妫勯～蹇撁洪鍛簵闁瑰吋鎯岄崰妤冪礊濡ゅ懏鈷戠紒瀣皡閺€缁樼箾閼碱剙鏋庢い鏇秮楠炴牗鎷呴崫銉悈闂備胶绮崝妤呭极閹间緡鏁婇柡鍥ュ灪閳锋垿鏌涘☉姗堝姛闁瑰啿鍟妵鍕晜鐠囪尙浠搁梺璇″枟閿曘垽鐛鈧、娆撴偩鐏炶棄绠ュ┑锛勫亼閸婃牕顫忚ぐ鎺戠？闁惧浚鍋嗛々鐑芥⒑椤掆偓缁夌敻鎮″☉妯忓綊鏁愰崶鍓佸姼闂佸搫妫寸紞渚€寮诲☉銏犵厴闁诡垎鍌氼棜婵犵绱曢崑鎴﹀磹閺嶎偅鏆滈柟鐑橆殔閻ゎ噣鏌ｅΔ鈧悧蹇涖€呴弻銉︾參婵☆垯璀﹀Σ鎾煛閳ь剚绂掔€ｎ偆鍘藉┑顔筋殔濡寮稿☉銏＄厽闊洦宀搁崫铏圭磼缂佹鈯曠€垫澘瀚埀顒婄秵閸撴岸宕氬☉銏♀拺閻犲洠鈧磭浠╁銈忛檮婢瑰棛绱撻幘瀵割浄閻庯綆浜滅粣娑欑節閻㈤潧孝闁稿﹤鎲＄粩鐔煎箳濡や讲鎷绘繛杈剧秬濞咃綁濡存繝鍥ㄧ厱闁规儳顕粻妯肩磼椤旂晫鎳囨鐐村笒铻栧ù锝夋櫜缁ㄧ敻姊绘担鍛婃儓婵炲眰鍔戝畷浼村箻鐠哄搫袣闂侀€炲苯澧存慨濠傤煼瀹曟帒顫濋崡鐑嗘澑缂傚倷绀侀鍡欐暜闄囧Λ銏犫攽閻樿宸ラ悗姘ュ妽缁傚秴顭ㄩ崼銏犲絼闂佹悶鍎滃鍡樻毎婵犵數鍋涢幊搴∥涘┑瀣摕闁哄洢鍨归悙濠勬喐瀹ュ鏁傛い鎾跺枂娴滄粓鏌曡箛濠傚⒉缂佲偓鐎ｎ偁浜滈柕蹇婃濞堟粎鈧娲樼敮鎺楀煘閸愵喗鍊烽悗闈涙憸閻撳姊虹拠鈥虫灍妞ゃ劌鎳橀崺銏ゅ箻鐠囨彃鐎銈嗘⒒閺咁偅绂嶉鍫熲拻濞达綀娅ｇ敮娑㈡煟濡や焦绀嬪┑鈥崇埣楠炴牗鎷呴崫鍕偊闂備礁鎲￠崝鎴﹀礉婢舵劕鍑犻幖娣妽閻撴瑩鏌熼鍡楀暞濮ｆ劙姊虹拠鎻掔槰闁告ê銈搁垾鏃堝礃椤斿槈褔鏌涢埄鍐炬當鐞涜偐绱撻崒娆愮グ閻忓浚浜畷鏇熺節濮橆儵锕傛煙闁箑鐏辨俊鎻掝煼濮婅櫣鈧湱濯鎰版煕閵娿儲鍋ユ鐐插暣閸╋繝宕ㄩ鐘垫澑濠电偠鎻徊浠嬪箟閳ユ枼鏋嶆繛鎴欏灪閳锋帒霉閿濆懏鍟為柟鑼焾閳规垿顢欓悙顒佹瘓闂侀潧妫楅崯顖滄崲濠靛鐐婇柍杞拌兌閵堬箓姊绘担鍛婂暈闁告棑绠撳畷浼村冀椤愩埄妫滄繝闈涘€搁幉锟犳偂閻斿吋鐓欓柟娈垮枛椤ｅ吋绻涢幊宄版噽绾剧厧銆掑顒婂姛闁伙絽鐏氶幈銊︾節閸愨斂浠㈤梺鍝勮嫰閹虫﹢骞冨▎鎾村殤閻犺桨璀︽导鍐ㄢ攽閻橆偅濯伴悘鐐跺Г閻濇繈姊洪崫鍕拱婵炶尙鍠庨悾鐑藉础閻愬秶鍠栭幖褰掑捶椤撶喎娅欐繝纰夌磿閸嬫垿宕愰妶澶婄；闁告侗鍨卞畷鏌ユ煕椤愮姴鍔橀柍褜鍏涚粈浣界亙婵炶揪缍€濞咃綁鎯侀崼銉︹拺缂佸瀵у﹢浼存煕閹寸姵鍤€妞ゎ厼娲、妤呭磼濠婂拑绱抽梻浣侯焾閺堫剟鎳濇ィ鍐ㄧ劦妞ゆ帒瀚峰Λ鎴︽煙瀹勯偊鍎旂€殿喖顭锋俊鐑藉Ψ瑜濈槐閬嶆⒒娴ｅ憡璐￠柛瀣崌瀹曟粌顫濋懜闈涗簻闂佺硶鍓濈粙鎺楀磻閿濆鐓曟繝闈涙椤忊晛鈹戦悙鍙夊枠闁哄本鐩、鏇㈡晲閸℃澹忛梻浣瑰缁诲倿藝椤栫偞鐓侀柛銉墯閻撳繐顭块懜鐢碘槈妞も晩鍓熼弻娑樜熼崗鍏兼瘓濠殿喖锕ㄥ▍锝夊箯閻樿鐏崇€规洖娲犻崑鎾寸節濮橆厾鍘卞┑鐘诧工閸燁偊寮抽悢铏圭＜闁逞屽墯缁绘繈宕堕妸銏″闂佸搫顦遍崑鐐寸珶閸℃蛋鍥晝閸屾稓鍘藉┑掳鍊撻悞锔句焊椤撶喆浜滄い鎰╁灮缁犱即鎮￠妶鍡愪簻闊洦鎸绘刊鍏间繆椤愩垹鏆ｆ慨濠冩そ瀹曟﹢宕ｆ径瀣壍闂備礁鎽滈崳銉╁磻婵犲倻鏆﹂柛婵嗗閺嗗棝鏌涢弴銊ュ幋闁归攱妞介弻锝夋偄閸濄儲鍣ч柣搴㈠嚬閸ｏ絾淇婇崼鏇炵妞ゆ梻鏅崢鎾绘偡濠婂嫮鐭掔€规洘绮岄～婵堟崉閾忚妲舵繝娈垮枟椤牆鈻斿☉銏犺Е閻熸瑥瀚换鍡涙煏閸繃鍣洪柛锝嗘そ閺岋綁骞樼€涙顦伴梺鍝勭焿缁绘繂鐣烽崼鏇炍ㄩ柕澶堝労閻庡啿鈹戦悙鑼憼缂侇喖鐗忛崚鎺戔枎閹惧疇鎽曞┑鐐村灦閿曗晛顭囬埡鍌樹簻闁圭儤鍩堝Σ鎼佹煕閹惧磭鍩ｆ慨濠冩そ瀹曨偊宕熼浣瑰缂傚倷绀侀鍡涘垂閸ф鏄ラ柕澶涚畱缁剁偤鏌熼柇锕€澧版い銏犳嚇濮婅櫣绱掑Ο鍝勵潙闁诲繐绻戦悷鈺呫€佸▎鎾崇婵°倓鑳堕崢浠嬫煙閼测晞藟闁逞屽墮閸熸寧娼忛崨瀛樷拺缂佸顑欓崕鎰版煙濮濆苯鍚归柟骞垮灩閳藉濮€閻樻鍚呮繝鐢靛仜濡鎹㈤幒鎾额浄濡わ絽鍟埛鎴犵磽娴ｈ偂鎴犱焊閻㈠憡鐓曢柣妯虹－婢х數鈧鍠栭…鐑藉极閹版澘宸濋柛灞剧矊閺嬫盯鏌熺粵鍦瘈濠碘€崇埣瀹曞崬螖娴ｅ搫缍撻梻鍌氬€搁崐鐑芥嚄閸洖绠犻柟鎹愵嚙閻ゎ噣鎮归幁鎺戝鐎规洖寮堕幈銊ヮ渻鐠囪弓澹曟俊銈囧Х閸嬫盯宕幘顔肩畺婵炲棙鎸告导鐘绘煕閺囥劌寮鹃柛鐐茬埣濮婃椽宕烽鐐蹭粯闂佸鏉垮缂侇喗鐟╅獮鍥敊閸啩鈩冪節閻㈤潧校缁炬澘绉归崺娑㈠箣閿旂晫鍘卞┑鐘绘涧濡顢旈鍫熺厱閻忕偠顕ф慨鍌炴煛鐏炲墽娲寸€殿噮鍓熼獮鎰償閵忊€愁伆闂傚倷绀侀幖顐﹀箠鎼淬劍鍋夊┑鍌涙偠閳ь兛绀侀～婵堟崉閾忕懓濮︽俊鐐€栧濠氬磻閹炬番浜?
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
      // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻鐔兼⒒鐎靛壊妲紒鐐劤椤兘寮婚敐鍛傜喎鈻庨幆褎顔勭紓鍌欒兌婵挳鎮樺璺何﹂柛鏇ㄥ枤閻も偓闂佸湱鍋撻幆灞轿涢妶鍥╃＝濞达絾褰冩禍鐐節閻㈤潧孝婵炶绠撻幃锟犲礃椤忓懎鏋戝┑鐘诧工閻楀棛绮堥崼鐔稿弿婵☆垰娼￠崫铏光偓瑙勬礀瀵墎鎹㈠☉銏犵闁绘劕鐏氶崳褏绱撴担绋款暢闁稿鍊濋獮鍐ㄎ旈崨顔芥珳闁硅偐琛ラ埀顒冨皺閺佹牗淇婇悙顏勨偓褏绱撳璺虹闁规儼妫勭粻鏍ㄤ繆閵堝倸浜鹃梺宕囩帛閹瑰洤鐣疯ぐ鎺濇晩闁伙絽鑻拏瀣⒒閸屾瑨鍏屾い顓炵墦椤㈡牠宕ㄧ€涙ɑ娅囬梺闈涱檧婵″洭鍩炲鍛斀闁绘ê寮舵径鍕煕閵堝拋鍎旀慨濠傤煼瀹曞ジ鎮㈤幁鎺嗗亾閹烘梻纾奸柟閭﹀枛娴狅妇绱掔紒妯肩疄闁诡喕绮欏Λ鍐归煬鎻掔伈闁哄本鐩幃鈺冣偓鍦Т椤ユ繈鏌?API 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氶梺璇叉唉椤煤韫囨稑纾块柟鎯版閻掑灚銇勯幒鎴姛缂佸鏁婚弻娑㈡偐瀹曞洤鈷堟繝銏ｎ潐濞茬喎鐣风粙璇炬梹鎷呴崫鍕闂傚倷娴囬鏍垂閾忣偅娅犳俊銈呮儰婢跺绶為柟閭﹀墰椤旀劙姊洪崫鍕垫Ч闁糕晛锕悡顒勵敆閸曨剛鍘搁柣蹇曞仩椤曆囧焵椤掍胶绠炴鐐诧工閳规垹鈧綆浜為鐓庮渻閵堝棙顥嗛柛瀣姈閺呭爼顢涘锝嗘杸闂佺粯鍔樼亸娆撳箺閻樼數纾兼い鏃囧亹閻忚京绱掓潏鈺佷沪缂佺粯绻堝畷鎯邦樁闁硅姤娲栭埞鎴︽倷閺夋垹浠ч梺鎼炲妿閹虫捇寮鈧缁樼瑹閳ь剙顭囪閹广垽宕卞☉妯碱槶濠电娀娼ч鍡涘磻閻斿吋鐓涢柛銉ｅ劚閻忣亪鏌ｉ幘璺烘灈妤犵偞鐗曡彁妞ゆ巻鍋撻柣蹇ｅ枟閵囧嫰鏁愰崼婵堟闂侀€炲苯澧柛妯荤矒瀹曟垿骞樼紒妯煎幍闂傚倸鍊搁顓⑺囬敃鍌涚參闁告劦浜滈弸鎴犵磼缂佹娲存鐐差儏閳诲氦绠涢弴姘亝闂傚倷绀侀幉锟犮€冮崱妯肩濠电姴娲ら拑鐔兼煛閸モ晛鏋旂紒鐘荤畺閺屾盯鈥﹂幋婵囩亪婵犳鍠栨鎼佲€旈崘顔嘉ч幖绮光偓鑼跺焻闂備胶顭堥鍛存晝閵堝缍栭煫鍥ㄦ媼濞差亶鏁傞柛婊€鐒﹂ˉ鍫熺節閻㈤潧浠﹂柛銊ョ埣閹虫繃銈ｉ崗鐔哄厴閸┾偓妞ゆ帒瀚埛鎺懨归敐鍥у妺闁搞倐鍋撻梻浣筋潐缁佹挳宕滃┑鍫熷床婵炴垶鐟х弧鈧梺鎼炲劗閺呮稓绮婇敃鍌涒拺闁告稑锕ゆ慨锕傛煕濡娼愮紒鍌氱Х閵囨劙骞掗幘璺哄箥闂備胶绮崹鍫曟晪闂佽绻嗛弲鐘诲蓟濞戞瑧绡€闁告洦鍋傚Σ鎰攽椤旂》榫氭繛鍜冪悼濡叉劙骞掗幊宕囧枛閹煎綊鏌呭☉姘鳖槰濠电姷鏁告慨鐢割敊閺嶎厼绐楅柟鎹愵嚙绾捐绻濋棃娑卞剭闁逞屽厸缁舵岸鐛鈧獮鍥ㄦ媴閸涘﹤鈧垰鈹戦悩顔肩伇婵炲鐩、鏍磼閻愯尙顔嗛梺鎯х箰濠€杈╁閽樺褰掓晲閸涱収妫岄梺绋块缁绘垹鎹㈠☉姘厹濡炲娴烽惁鍫濐渻閵堝啫鐏柟鍛婄摃閻忓啴姊洪崨濠傚Е濞存粎鍋ら弫宥咁煥閸涱垳锛濋梺绋挎湰閻熝囧礉瀹ュ鐓ラ柡鍥ュ妼娴滀即鏌熼搹顐ｅ暗闁圭懓瀚版俊鎼佸閻樺崬顥氭繝鐢靛仜閻楀棝鎮樺┑鍡忔瀺婵せ鍋撻柡灞剧〒閳ь剨缍嗘禍婊堫敂椤撶喆浜滈柕蹇婃閼拌法鈧娲橀〃濠囧箖閳╁啯鍎熼柨婵嗘川瀹撲焦绻濋悽闈浶ラ柡浣告啞閹便劑寮堕幊銊︽そ婵¤埖寰勬繝鍐偓顒勬煟閻斿摜鎳冮悗姘煎枤瀵囧焵椤掑嫭鈷戞慨鐟版搐閻忓弶绻涙担鍐叉搐閻撴繈鏌涢銈呮灁缂佺姵鍎抽湁闁挎繂鎳庨弳閬嶆煕濮橆劶顏堝煡婢跺á鐔兼煥鐎ｅ灚缍屽┑鐘殿暯濡插懘宕规潏鈺佸灊閹兼番鍔岀粣妤呮煙闁箑鏋ょ紒鐘虫閺岋綁寮崒姘粯闂佺粯甯掗悘姘跺Φ閸曨垰绠抽柛鈩冦仦婢规洘淇婇悙顏勨偓銈夊磻閸曨厽宕查柟閭﹀枛瀵弶淇婇悙顏勨偓鏇犳崲閹邦喒鍋撳鐓庡缂侇噯绲介埥澶娾枎閹寸姷妲囬梻浣圭湽閸ㄨ棄顭囪閻☆參姊绘担渚劸闁挎洩绠撻垾锕傚醇閿濆孩姣庨梻鍌欑婢瑰﹪宕戞笟鈧畷鏇㈠蓟閵夈儳鍘遍梺鐟邦嚟婵澹曟總鍛婂€甸柨婵嗛娴滀粙鏌涙惔娑樺姦闁哄本绋掗幆鏃堟晬閸曨収鍟嬮梻浣告惈閻ジ宕伴弽褏鏆︽慨妞诲亾闁瑰磭濞€椤㈡宕掗妶鍛珨闂備浇顕х€涒晠顢欓弽顓炵獥婵炴垶鐭悞濠冪箾閸℃ɑ灏紒鐘崇叀閺屾盯寮撮妸銉ヮ潾闂佽崵鍠曢～澶愬Φ閸曨垰鍐€闁靛ě灞炬闂備胶顭堥…顒勫垂娴兼潙鐓橀柟杈鹃檮閸嬫劖銇勯弮鍥т汗濞寸厧娲ら埞鎴︽倷瀹割喗效闂佺儵鏅╅崹璺侯嚕椤愶箑绀冩い鏂挎瑜嶉…璺ㄦ崉娓氼垰鍓版繛瀵稿閸愶絾鏂€闂佸疇妫勫Λ妤呮倶閵壯€鍋撶憴鍕闁轰胶顭堥锝堫樄闁糕斁鍋撳銈嗗笒鐎氼參鍩涢幋锔解拻闁割偆鍠撳ú鎾煟濞戞瑧鐭岀紒杈ㄥ浮楠炴捇骞掗幋鏃€瀵栨繝鐢靛仦閸ㄧ敻鎮樺璺何ч柨婵嗩槸缁€鍐煃閸濆嫬鏆欑€殿喗濞婂缁樻媴閸涘﹥鍎撳┑鐐额嚋缁犳捇寮€ｎ喗鈷戦梺顐ゅ仜閼活垱鏅堕鐐寸厽闁冲搫锕ら悘鈥城庨崶褝韬柟顔炬櫕缁瑧鎹勯妸褎婢戦梻鍌欒兌缁垶銆冮崨瀛樺亱闁糕剝顭囬々鏌ユ煕閿旇骞樼痪鍙ョ矙閺屾稓浠﹂崜褎鍣梺鍛婃煥缁夌敻濡甸崟顖ｆ晣闁绘劖娼欓弸鐘绘倵鐟欏嫭纾搁柛銊︽そ婵″爼鏁愭径濠勵槰闂佸啿鎼崯顐︾嵁閹邦兘鏀介柣姗嗗枛閻忚鲸绻涙径瀣创闁轰礁鍟撮弫鍌炴嚍閵夛妇褰块梻浣侯攰閹活亪姊介崟顖涘亗闁哄洢鍨洪悡娑㈡煕鐏炲墽绠栫痪顓炵埣瀵偊宕奸妷锔规嫼缂備緡鍨卞ú妯衡枍閸℃稒鐓熼柍鍝勶工閻忥箓鏌ｅ☉鍗炴珝鐎规洖鐖奸、妤佹媴闂€鎰秿闂傚倷绀佹竟濠囧磻娓氣偓瀹曠銇愰幒鏂跨ウ闂佽澹嗘晶妤呭煕閹烘嚚褰掓晲閸噥浠╅梺闈涙閿曨亪寮诲☉銏犵閻庨潧鎽滈悿鍕⒑鐠団€虫灓闁稿繑蓱娣囧﹪鎮滈挊澶屽幐婵炶揪绲块…鍫濃枔閵堝棛绡€闁汇垽娼ф禒锕傛煕閵娿儳鍩ｉ柟顔惧厴椤㈡稑顫濋敐鍡欎簴濠电偛顕慨鎾敄閸℃稒鍋傞柣鏂垮悑閻撴瑩姊洪銊х暠妤犵偞顨堢槐鎾愁吋閸℃浼岄梺鍝勭焿缂嶁偓缂佺姵鐩獮姗€鎳滈崹顐㈡灈闂傚倷绶氬褍煤閵堝洠鍋撳鍗烆暭闁逛究鍔戦崺鈧い鎺戝閻撳啴鏌曟径鍫濆姎闁哄棝浜堕弻鐔兼偩鐏炵偓姣堥梺璇″枟椤ㄥ牓骞夐幘顔肩妞ゆ帒鍋嗗Σ顒勬煟鎼淬値娼愭繛璇х畵瀹曟粓鎮㈤悡搴㈡К闂侀潧绻嗛崜婵嬪磿閻斿吋鐓忓┑鐐茬仢閸斻倖銇勯幘铏儓妞ゎ亜鍟存俊鍫曞幢濡儤娈梻?
      const evaluation = await evaluationsApi.getById(evaluationId);

      // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎梺鐟板⒔缁垶宕戦幇鐗堢厱闁归偊鍓欑痪褔鏌ｉ妶鍛仼闁宠鍨堕獮濠囨煕婵炑冩噹缁躲倕霉閻樺樊鍎忛柣銈庡枟閵囧嫰骞囬埡浣插亾閹版澘纾婚柟鐐墯濞尖晜銇勯幒鎴Ч閺佸牓姊绘笟鈧褍煤閵堝洠鍋撳顐㈠祮闁绘侗鍣ｉ獮鎺懳旈埀顒傜不閿濆棛绡€闁割煈鍋勬慨鍐磼鏉堛劎绠炴慨濠勭帛閹峰懘鎳為妷锝傚亾閸愵亞纾奸柍褜鍓氶幏鍛存嚃濠靛洨鈽夐柍瑙勫灩閳ь剨缍嗘禍锝夊箺閺囥垺鈷戦柟绋挎捣缁犳挻銇勯敂璇茬仯缂侇喛顕ч埥澶娾枎瀹ュ嫮鐩庨梻浣告贡閸庛倝宕归悽绋跨劦妞ゆ帒瀚峰Λ鎴︽煕閹烘挸娴柟顔荤矙瀹曘劍绻濋崟顐㈢闂備胶鎳撻崥瀣偩椤忓牆鍨傚┑鐘冲搸閳ь剙鍊块幊鐘活敄閽樺澹曢梺绋跨箰椤︻垱绂嶆ィ鍐┾拺鐟滅増甯楅敍鐔虹磼閳ь剚绗熼埀顒勫箯閹达附鍋勯柛婵勫劤椤旀洟姊洪悷鎵憼闁荤喆鍎甸幃姗€鍩￠崨顔惧幈濠德板€撶粈渚€鍩㈤弴銏＄厸閻忕偟鍋撶粈鍐磼缂佹娲寸€规洖缍婇、娆撴偂鎼搭喗缍撴繝纰夌磿閸嬫垿宕愰妶澶婄；闁圭儤顨呯壕璇测攽閻樻彃浜炴繛鍏肩墬缁绘稑顔忛鑽ゅ嚬濡炪們鍎遍悧濠勬崲濞戙垹绠ｉ柣鎰硾椤ユ繂顪冮妶鍐ㄢ偓鎰板磻閹剧粯鈷掗柛灞剧懆閸忓矂鏌熼搹顐ｅ磳妤犵偛顦甸崺鍕礃椤忓棭鍟庡┑鐘垫暩婵挳宕戦崱娑樺惞闁哄洨鍋愰弨浠嬫煟濡櫣锛嶆い锝嗙叀閺岋繝宕ㄩ鎯у绩闂佸搫鏈粙鎴﹀煡婢跺á鐔烘偘閳ュ厖澹曟繝鐢靛У閼瑰墽绮ｅΔ鍛厸鐎规搩鍠栭幊蹇撯枔妤ｅ啯鍋℃繝濠傛噹椤ｅジ鎮介妤佹珚鐎殿噮鍋呯换婵嬪炊閵娧冨箥婵＄偑鍊栭悧鏇炍涘Δ鍛柈闁规鍠楅～鏇灻归悡搴ｆ憼闁?缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ょ紓宥咃躬瀵鏁愭径濠勵吅闂佹寧绻傞幉娑㈠箻缂佹鍘辨繝鐢靛Т閸婂綊宕戦妷鈺傜厸閻忕偠顕ф慨鍌溾偓娈垮枟閹告娊骞冨▎寰濆湱鈧綆浜欐竟鏇㈡⒑閸涘﹦缂氶柛搴ゆ珪缁嬪顓兼径瀣幐婵犮垼娉涢敃锕€顫濋妸鈺傜厸闁逞屽墯缁傛帞鈧綆鍋嗛崢钘夆攽閳藉棗鐏ユ繛鍜冪秮閺佸秴顓奸崱鎰盎闂佹寧绻傚Λ娑㈠矗閳ь剟姊洪崫鍕拱缂佸甯為幑銏犫攽鐎ｎ亜绐涘銈嗘煣閸曟﹢鍩€椤掍礁濮囨い顏勫暣婵¤埖鎯旈垾宕囶啇婵犵數鍋熼妴瀣崲濠靛宓佸┑鐘插亞閻撱儵鏌涢銈呮珡婵☆偄鍟埞鎴︽倷閺夋垹浠搁梺鎸庢磵閺呮盯鈥﹂崶顒€绫嶉柛顐ゅ暱閹风粯绻涙潏鍓у埌闁硅绻濋獮鍡涘醇閵夛妇鍘甸悗鐟板閸嬪﹪宕曢弮鍌楀亾鐟欏嫭绀冪紒顔肩焸閸┿儲寰勯幇顒夋綂闂佺粯锕㈠褎鎱ㄩ敂鎴掔箚闁绘劦浜滈埀顒佺墪椤斿繑绻濆顒傦紱闂佺懓澧界划顖炴偂閺囩喍绻嗘い鏍ㄧ箓閸氬綊鏌ｉ鐔风闁逞屽墲椤煤濮椻偓瀹曞綊宕稿Δ鍐ㄧウ濠碘槅鍨甸崑鎰閸忛棿绻嗘い鏍ㄧ矊鐢埖顨ラ悙鑼ⅵ婵﹦绮幏鍛村川婵犲啫鍓垫繝鐢靛仜閻即宕归挊澶屾殾婵犻潧鐗冮崑鎾绘晲鎼粹€斥拤婵犳鍠楁繛濠囧蓟閿濆鏅查柛娑卞灣娴煎洨绱掗悙顒€鍔ら柕鍫㈩焾椤曪綁宕奸弴鐐哄敹濠电偞鍨堕敋妞ゎ剙鐗撳娲川婵犲嫮鐣奸梺绋跨昂閸婃繈鐛崼銉ノ╅柨鏂垮⒔閻﹀牓姊洪崨濠佺繁闁革綆鍠楃粋鎺楀煛閸愵亞锛濇繛鎾磋壘濞层倝寮搁悢鍏肩厽闁绘梹绻傚ú銈囩不閺屻儲鐓曢柡鍥ュ妼閻忕娀骞嗛悢鍏煎仭婵犲﹤瀚惌鎺斺偓瑙勬处閸撶喎鐣峰鍕闁惧繒娅㈢槐鎶芥⒒娴ｄ警鐒鹃柡鍫墴閹柉顦归挊婵嬫煥閺傛娼熷ù婊勭矒閺屻劑寮捄銊よ檸閻庤鎸稿Λ娆撱€冮妷鈺傚€烽柡澶嬪灥椤帡鎮楃憴鍕闁挎洏鍨介獮濠囨偐濞茬粯鏅㈡繛杈剧秬椤曟牠宕惔銊︹拺闁煎鍊曢弸鎴犵磼椤旂厧顒㈤柡鍛版硾铻栭柛鎰ㄦ櫆濞堜即姊洪崘鍙夋儓闁瑰啿閰ｅ鍛婄瑹閳ь剟寮诲☉妯兼殕闁逞屽墴瀹曟垿鎮欓悜妯轰簵闂佸搫娲㈤崹娲偂閸愵喗鐓冮弶鐐村椤︼附顨ラ悙鐡锋垿濡甸崟顔剧杸闁圭偓娼欏▍褍顪冮妶鍌涙珖闁稿繑锕㈠濠氭偄閸忕厧鈧粯鎱ㄥΔ鈧Λ娆撴偩閻戣姤鈷戦柟鎯板Г閺侀亶鏌涢妸銉т虎妞ゎ偄绻戠换婵嗩潩椤掑嫬鏁归梻浣虹帛濮婂綊宕曟總绋胯Е闁稿本鍩冮弨浠嬫煟閹邦厽缍戦柣蹇曞枛閺屾盯濡歌閸も偓濡炪倖鏌ㄧ换鎰板煘閹达箑鐐婇柕澶堝€楅惄搴ㄦ⒒娴ｅ憡璐￠柛瀣崌閵嗗啴宕ㄩ妤€浜炬慨姗嗗墯閸ゅ洭鏌熼鍝勭伈鐎规洘顨堟禍鎼佸冀閵娿儺浼滃┑鐘垫暩閸嬬娀骞撻鍡楃筏闁秆勵殕閸嬨倝鏌￠崘銊у闁告俺顫夌换娑㈠幢濡闉嶉梺绋匡工閻忔氨鎹㈠☉銏犵闁绘劘灏欓悷鎻掆攽閻愬弶鍣规繛灞傚妿濡叉劙骞掑Δ濠冩櫓闂佷紮绲介張顒勫闯閺夎鏃堟偐闂堟稐娌柣銏╁灡鐢喖鎮橀崘鈺冪閺夊牆澧界粔顒併亜椤愩埄妯€闁诡喚鏁绘俊鎼佹晜閸撗呮缂備胶鍋撳姗€藝鏉堚晛顥氶柛褎顨嗛悡鏇㈡倵閿濆骸浜滈柣蹇擃嚟閳ь剝顫夊ú姗€宕濆▎蹇ｅ殨濞寸姴顑傞埀顒佺墵閸╁嫰宕橀埞澶歌檸闂備浇顕栭崰鎾诲垂閽樺鏆︽い鎰剁畱鍞銈嗘煣缁瑩寮鍫熲拻闁稿本鐟чˇ锕€顭块悷甯含鐎规洘鍨垮畷銊╊敆閸忓吋銇濈€殿喕绮欓、鏇㈠Χ閸曨厾鎲归梻鍌欒兌缁垶鏁嬬紒鍓ц檸閸樺墽鍒掔紒妯稿亝闁告劏鏅濋崢鐢告煟鎼达絾鏆╂い顓炵墛缁傛帒顭ㄩ崼鐔哄幗闂佸湱鍎ら崹鍦矓濞差亝鐓涢悘鐐插⒔閵嗘帡鏌嶈閸撱劎绱為崱娑樼；闁告侗鍘鹃弳锔锯偓鍏夊亾闁告洦鍓涢崢闈涱渻閵堝棙鈷愰悗绗涘泚澶嬪緞閹邦厾鍘撶紓鍌欑劍钃遍悘蹇曟暬閺岀喖鎮烽弶娆句純婵犵鍓濋幃鍌涗繆閻戣棄唯闁规澘鍚€缁ㄧ晫绱掓潏銊﹀磳鐎规洘甯掗埢搴ㄥ箣濠靛棭鐎村┑锛勫亼閸婃垿宕濈仦杞挎稑鈹戦崱娆愭閻熸粎澧楃敮鎺楀垂閸屾稏浜滈柡鍥╁仦閸ｈ櫣绱撳鍛村弰婵﹥妞介獮鍡氼槾缂佺姷鍎ら妵鍕敃閵忊晜楔闂侀€炲苯澧痪鏉跨Т閻ｆ繈骞栨担姝屾憰閻庡箍鍎遍ˇ顖氭暜闂備線娼чˇ顓㈠磿閹绘崼鎺楀箛椤戔晜妫冮幃鈺呮濞戞鍕冮梻浣告啞濮婂綊鎮烽妷鈺嬬稏闊洦绋掗幆鐐烘煕閿旇骞橀柨娑欑矊閳规垿鍩ラ崱妤冧画濠碉紕鍋樼划娆忕暦閻㈢鍋撻敐搴′簽缂佲檧鍋撶紓浣稿⒔婢ф褰滈梺绋款儐閹瑰洭骞栬ぐ鎺濇晝闁挎繂妫楅埀顒傚厴濮婃椽宕ㄦ繝搴㈢杹婵炲瓨绮岄悥鐓庮嚕婵犳碍鍋勯柛蹇曞帶娴滈亶姊洪崜鎻掍簽闁哥姵鎹囧畷娆撴晬閸曨厾锛濇繛杈剧到閹碱偄鐡俊鐐€ら崢楣冨礂濡警鍤曢悹鍥ㄧゴ濡插牓鏌曡箛鏇炐ユい鏃€甯″娲嚌閺夋妫堝┑鐐差槹閻╊垰鐣烽姀銈嗘櫢闁绘ɑ鏋奸幏铏圭磽閸屾瑧鍔嶉拑閬嶆倶韫囷絽骞楅柕鍥у楠炲鈹戦崶鑸碉骏闂備胶鎳撶粻宥夊垂瑜版帒鐓″鑸靛姇椤懘鏌ｅΟ鍏兼毈闁绘稒鎹囧缁樻媴閻戞ê娈岄梺瀹︽澘濡块柟骞垮灲瀹曟﹢顢欓懖鈺嬬串婵＄偑鍊栭悧婊堝磻閻愬搫鐓曢柟杈鹃檮閻撶姴鈹戦钘夊闁逞屽墯濞茬喎顕ｉ幎钘夌劦妞ゆ帒瀚埛鎴︽煕濞戞﹫姊楃紒鍫曚憾閺屾盯濡搁敃鈧埢鏇㈡煙椤旀儳浠︾紒杞扮矙瀹曘劍绻涢悙顒€顏归梻鍌欑閹诧紕绮欓幋锔芥櫇闁靛绠戠欢鐐烘煕閺囥劌鐏￠柣鎾存礋閹鏁愰崒娑欑彇缂備焦鍔栧Λ鍐蓟濞戙垹鐓橀柟顖嗗倸顥氭繝纰夌磿閸嬫垿宕愰弽顐ｆ殰濠电姴瀚惌鍡椕归敐鍫燁仩缂佺姵妫冮弻鐔兼倻濡钄兼繛瀛樼矋缁秹濡甸崟顖氱疀闁告挷鐒﹂崑褏绱撴担鍝勑ラ柛瀣仱婵＄敻宕熼姘兼綂闂佸疇妫勫Λ娆撴偩閻戣姤鍊甸柛顭戝亝缁舵煡鎮楀鐓庡箻闁瑰箍鍨归埞鎴犫偓锝庝簽閿涙粌鈹戦鐭亪宕ョ€ｎ啟澶婎吋閸涱亝鏂€?run 闂傚倸鍊搁崐鎼佸磹閹间礁纾圭€瑰嫭鍣磋ぐ鎺戠倞妞ゆ帒顦伴弲顏堟偡濠婂啰效婵犫偓娓氣偓濮婅櫣绱掑Ο铏逛紘濠碘槅鍋勭€氼喚鍒掓繝姘亹缂備焦顭囬崢鐢告⒑绾拋娼愰柛鏃撶畵瀹曢潧鈻庨幋鐘碉紲闂佺粯锕㈠褔寮稿☉娆愬弿濠电姳鑳堕惌娆戔偓瑙勬礀閻栧ジ銆佸Δ鍛劦妞ゆ帊绶￠弨浼存⒒閸屾瑧顦︽繝鈧潏銊︽珷婵°倐鍋撴い顓炵仢铻ｉ柤娴嬫櫇閻掑ジ姊洪崨濠傚闁哄倸鍊圭粋宥咁煥閸喓鍘搁梺鍛婂姂閸斿秵寰勯崟顑句簻闁靛鍎哄Σ鎼佹婢舵劖鐓熸慨妞诲亾婵炰匠鍛殰闁煎摜鍋ｆ禍婊勩亜韫囨挸顏╅柡鍡到閳规垿鍨惧畷鍥х厽閻庤娲栧畷顒冪亙闂佸憡鍔︽禍婵嬪闯椤栫偞鈷掑ù锝囩摂閸ゆ瑩鎮楀☉鎺撴珚鐎规洘鐟ㄩ妵鎰板箳閹寸媭妲舵繝鐢靛仦閸ㄥ爼鎳濇ィ鍐ㄥ瀭婵犻潧妫岄弨浠嬫煟濡櫣锛嶆い锝嗙叀閺岋繝宕ㄩ鑲╃シ濡炪値鍙€濞夋洟骞戦崟顒傜懝妞ゆ牗鑹炬竟瀣⒒娴ｅ憡鍟炴い顓炴喘瀵偆鎷犲顔界稁缂傚倷鐒﹂…鍥偡瑜版帗鐓曢柕澶嬪灥閸熲晝妲愰悢铏圭＝闁稿本鑹鹃埀顒佹倐瀹曟劙鎮烽柇锔藉兊闂侀潧艌閺呮粓宕靛澶嬧拺妞ゆ巻鍋撶紒澶屾暬瀹曟垿鍩￠崘锝呬壕闁稿繐顦禍楣冩⒑闁偛鑻晶鏉款熆鐟欏嫭绀冪紒杞扮矙瀹曘劍绻濋崒妤€浜鹃柣銏犳啞閻撱儲绻濋棃娑欘棤闁告垵缍婇弻鐔煎蓟閵壯呮毇闂佸搫鐭夌紞渚€鐛鈧幃娆撴寠婢跺鍨濋梻鍌欑閹碱偊鎯屾径灞绢潟闁哄洨鍠撻々鐑芥煥閺囩偛鈧摜绮堥崼銏″枑閹兼番鍔岀粈鍡樼箾閹寸儐鐒搁柡鍐ㄧ墛閸嬫劙姊婚崼鐔衡棩婵炲矈浜弻锝夊閳轰胶浼堢紓浣虹帛缁诲牓骞冩导鎼晩閻忓繑鐗楅悗濠氭⒑鐟欏嫬鍔ょ痪缁㈠弮钘濋柕濞炬櫆閳锋垿鏌涢幇顒€绾ч柟顖氱墦閺屾盯鎮ゆ担鍝ヤ哗閻炴碍鐟ч埀顒€鍘滈崑鎾绘煕閺囥劌鍘撮柟宄邦煼濮婅櫣绮欓幐搴㈡嫳闂佽崵鍟欓崨顖滃箵闂佸搫鍟犻崑鎾剁磼缂佹鈯曢柟宄版嚇瀹曟﹢骞撻幒鎾充汗婵犵數鍋為崹鍫曗€﹂崒鐐茬睄闁割偅绻傜粣娑橆渻閵堝棙灏靛┑顔炬暬閹偤鎮欓璺ㄧ畾闂佺粯鍔︽禍婊堝焵椤掍胶澧甸柟顔ㄥ吘鏃堝礃閵娿儳浜伴梺鐟板悑閻ｎ亪宕濆澶婄？婵°倐鍋撴い顓炴健閹虫粓妫冨☉姗嗘綌闂備胶绮幐濠氭偡閳哄懎钃熼柨婵嗩槸缁狅綁鏌ｈ箛鏃€銇熷ù婊庝邯楠炲啴鎮欏ǎ顒€浜濋梺鍛婂姀閺呮繈宕㈤崡鐐╂斀妞ゆ梹鏋绘笟娑㈡煕閹垮嫮鐣电€规洘娲熷顕€宕奸悢鍝勫箰闂佽绻掗崑娑欐櫠閽樺娲箻椤旂晫鍘遍梺瀹犳〃缁€渚€顢旈鐘亾鐟欏嫭绀冩い銊ワ躬瀵偊宕掗悙鏉戠檮婵犮垼娉涢敃銉╁箠濞嗘挻鐓熼幖娣焺閸熷繘鏌涢悩鎰佹疁妤犵偛鍟村畷鎺戭潩閻撳孩顓垮┑鐐差嚟婵挳顢栭幇鏉挎瀬闁告劦鍠楅悡蹇涙煕椤愶絿绠栫紒渚囧亞缁辨帡宕￠悙鍙夋瘣闂佸疇顫夐崹鍧楀箖濞嗘挻鍤嬮梻鍫熺⊕闁款厾绱撻崒娆戭槮鐎殿喛娉涢悾宄邦潨閳ь剚淇婇悽绋跨疀闁哄娉曢ˇ銊╂⒑閸愬弶鎯堥柛鐘宠壘鐓ら柟闂寸劍閳锋垹绱撴担濮戭亝鎱ㄩ敃鍌涚厱闊洦姊婚妴鎺楁煙楠炲灝鐏茬€规洖宕埥澶娾枎閹存繂濡囬梻鍌欑婢瑰﹪宕戦崨顖涘床闁告洦鍘炬稉宥夋煙閹澘袚闁绘挾鍠栭弻銊モ攽閸℃瑥顤€闂佺粯绻嶆禍鐐垫閹烘梻纾兼俊顖氱毞婵洭鎮楅崹顐ｇ凡閻庢凹鍣ｉ崺鈧い鎺戯功缁夌敻鏌涚€ｎ亝顥㈤挊婵囥亜閹捐泛啸缁炬崘妫勯妴鎺戭潩椤掍焦鎮欓梺鍝勵儐缁嬫帡濡甸崟顖ｆ晣闁靛繆鍓濋弳鐘崇箾閿濆懏鎼愰柨鏇ㄤ邯楠炲啫顭ㄩ崼鐔风檮婵犮垼娉涢懟顖炵嵁閹扮増鈷掑ù锝勮閻掗箖鏌￠崼顐㈠⒋闁诡垰鐭傞、姘跺焵椤掆偓閻ｇ兘顢曢埗鑺ユ⒐閹峰懘鎼归崷顓燁潓闂傚倷鐒﹂惇褰掑垂閽樺鐒界憸搴ｇ矉閹烘鏅濋柛灞剧〒閸橀亶姊洪棃娑辩劸闁稿孩濞婂畷娲晲婢跺鍘告繛杈剧到婢瑰﹪宕曡箛鏂讳簻妞ゅ繐瀚弳锝呪攽閳ュ磭鍩ｇ€规洘锕㈡俊鎼佸Ψ椤旈敮鍋撻幘顔解拻濞达綀妫勯崥褰掓煕閻旈攱鍋ョ€殿喗鐓￠幃鈺侇啅椤斿吋顓垮┑鐘垫暩婵敻鎳濋幆褎绾繝鐢靛О閸ㄧ厧鈻斿☉銏℃櫇闁靛牆顦伴崐鍨亜閹捐泛鍓辨繛鎾愁煼閺屾洟宕煎┑鍥舵婵犳鍠栭崐鍧楀蓟濞戙垹惟鐟滃繒鏁☉銏″€甸柣銏ゆ涧鐢爼鏌ｉ敐鍡欑疄鐎规洜鍠栭、鏍嚍閵夈儺浼?
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

      // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧湱鈧懓瀚崳纾嬨亹閹烘垹鍊炲銈嗗笒椤︿即寮查鍫熷仭婵犲﹤鍟扮粻濠氭煕閳规儳浜炬俊鐐€栫敮濠囨嚄閸洖鐓濋柟鍓х帛閻撴盯鏌涘☉鍗炴灓缂佺姵锕㈤弻娑㈠箳閹惧磭鐟ㄩ梺瀹狀嚙闁帮綁鐛Ο铏规殾闁搞儴娉涢弫钘夆攽閻樿尙妫勯柡澶婄氨閸嬫捇骞樼紒妯衡偓鍧楁煥閺囨浜鹃梺瀹狀嚙缁夌懓顕ｉ鈧畷濂告偄閸欏顏洪梻鍌欒兌椤牓寮甸鍕仭鐟滄棁妫熼梺鎸庢礀閸婂綊鎮″▎鎾村仯闁搞儱娲ら幊鎰版儊閸儲鈷戦悹鍥ｂ偓铏亾闂佺绻戣摫濞ｅ洤锕幃婊堟寠婢光斂鍔戦獮鏍庨鈧悘顕€鏌嶉挊澶樻█闁哄苯绉归幐濠冨緞濡亶锕€顪冮妶搴′簼缂佽鐗撻妴浣肝熷▎鐐紓鍌氬€哥粔鐢搞€冩繝鍌ゆ綎缂備焦蓱婵绱掑☉姗嗗剱缂傚秴鐗撻幃妤冩喆閸曨剛顦ㄩ梺鎸庢磸閸ㄤ粙濡存担鍓叉僵闁归鐒﹂瀷缂傚倸鍊风欢锟犲窗閺嶎厸鈧箓鎮滈挊澶岀枃闂佽法鍠撴慨鏉戞纯闂備胶顭堥張顒勬儗椤旂晫鐝堕柡鍥ュ灪閻撶喖鏌ｉ弬鎸庢喐闁瑰啿鍟撮幃妤€顫濋悡搴＄缂備緡鍠栭悧鎾诲春閳ь剚銇勯幒鍡椾壕闂佸疇顫夐崹鍧楀箖濞嗘劧绱ｆ繝闈涙閻ゅ倻绱撻崒娆掑厡濠殿喚鏁婚獮鎴﹀炊椤掍礁浠?
      evaluationCache.set(evaluationId, {
        testCases: loadedTestCases,
        criteria: loadedCriteria,
        runs: loadedRuns,
        results: loadedResults,
        selectedRunId: loadedSelectedRunId,
      });

      // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎梺鐟板⒔缁垶宕戦幇鐗堢厱闁归偊鍨扮槐锕傛煟閵忋垻甯涘ǎ鍥э躬閹瑩顢旈崟銊ヤ壕闁哄稁鍘介崑瀣繆閵堝懎鏆熼柣顓熺懇閺岀喖鎮欓鍌涜弴闂侀€炲苯澧柟铏悾鐑芥晲閸℃绐為悗鍏夊亾闁逞屽墴閹線宕奸妷锔规嫽闂佺鏈銊︽櫠濞戞氨纾奸悗锝庡亜濞搭噣鏌℃担鍝バх€殿噮鍣ｅ畷濂告偄閸濆嫬绠婚梻鍌欑閹碱偊藝閸愭祴鏋栭柡鍥╁枔椤╃兘鏌曡箛瀣偓鏍夐崱妤婄唵闁兼悂娼ф慨鍫ユ煟閹惧崬鍔滅紒缁樼箞濡啫鈽夊▎妯伙紒濠电姵顔栭崹浼村触鐎ｎ剚宕叉繛鎴欏灪閸ゅ啴鏌嶆潪鎵妽闁诲骸顭峰濠氬炊瑜滃Σ鍦磼缂佹绠栫紒缁樼箞瀹曟帒顫濋鐕佸晙缂傚倸鍊风粈渚€藝閺夋娓诲ù鐘差儏閽冪喖鏌嶉妷銉э紞闁哄棗妫濋弻宥堫檨闁告挾鍠庨悾閿嬪閺夋垵鍞ㄥ銈嗘尵婵绮婇敃鍌涒拺缂侇垱娲栨晶鏌ユ煕閹寸姵鍤€閸楀崬鈹戦悩宕囶暡闁抽攱鍨块弻娑樷攽閸℃浠惧銈冨劗閳ь剚鍓氬〒濠氭倵濞戞鎴﹀磹閹邦兘鏀介柨娑樺閺嗩剛鈧娲滈崰鏍€佸☉妯炴帗鎷呴崘鍙夊闁绘挻娲樼换娑㈠箣濠靛棜鍩為梺鍝勵儐缁嬫帞鎹㈠☉銏犻唶闁绘洑鐒﹂悾鍫曟⒑鐎圭媭娼愰柛銊ユ健閵嗕礁鈻庨幋鐐插幑闂備礁鐏濋鍡涘汲閻楀牏绡€缁炬澘顦辩壕鍧楁煕鐎ｎ偒鐒介柛鎺撳笒閳诲酣骞樺鍕╁劚閵嗘帒顫濋敐鍛闁诲孩顔栭崰妤呭箰閾忣偅鍙忛柍褜鍓熼弻锝呪枎鐏炴垝澹曟繝鐢靛仧閸樠囨晝椤忓嫷娼栨繛宸簻缁€鍐煕濞嗗浚妲归柛搴㈡崌濮婅櫣绮欓崠鈩冩暰闂佸憡姊归悷锔界┍婵犲洦鍊婚柦妯侯槺閸樻悂姊虹粙鎸庢拱妞ゃ劌妫涢埀顒佽壘閵堢顫忕紒妯诲闁惧繒鎳撶粭锟犳⒑閻熺増鎲告い顓炵墦濠€渚€姊绘担鍝ヤ虎妞ゆ垵娲妴鍛存煥鐎ｎ剛顔曢梺鐟扮摠閻熴儵鎮橀鍫熺厽闁规儳鐡ㄧ粈瀣煛鐏炵偓绀冪紒缁樼洴瀹曞綊顢欓悡搴渐闂傚倷鑳堕…鍫ヮ敄閸愵喖纾块柡灞诲劘閳ь剙鍟存俊鐑藉煛閸屾埃鍋撻悜鑺ョ厱婵炲棗娴氬Ο鍫熶繆椤愵剛鐣甸柟顔筋殘閹叉挳宕熼鍌ゆО闂備焦瀵уú蹇涘垂娴犲违濞达絿纭堕弸搴ㄦ煙閻愵剚缍戞繛鍫熷姍濮婃椽宕橀崣澶嬪創闂佹寧娲忛崕鏌ュ疾閵夈儮鏀介柣妯活問閺嗘粎绱掓潏銊︾鐎规洘鍨块獮瀣晝閳ь剛澹曡ぐ鎺撶厸鐎规搩鍠栭張顒傜礊鎼淬垻绡€闁汇垽娼ф牎闂佽偐鎳撴晶鑺ョ珶閺囩喓绡€婵﹩鍘鹃崢鐢告⒑閸涘﹦鎳€闁稿氦娅曠粙澶愭嚑椤掑倻锛濋悗骞垮劚濡稒鏅堕悽鍛婄厸閻忕偟纭堕崑鎾崇暦閸ャ劍顔撴俊鐐€栧濠氬箠閹惧顩插Δ锝呭暞閳锋垿鎮跺☉鎺嗗亾閸忓懎顥氭繝鐢靛仜椤曨厽鎱ㄩ幘顕呮晞闁糕剝绋掗崑鍌炴煟閺傚灝鎮戦柣鎾寸懇濮婃椽顢橀妸褏鏆犳繝鈷€鍌氬祮闁哄瞼鍠栭幃鍓т沪閸欘偁鍎崇槐鎺撴綇閵婏箑纰嶅銈嗘尭閵堢鐣烽崡鐐嶆棃宕樿椤㈡﹢姊婚崒娆戠獢婵炰匠鍏犳椽濡堕崶锝呬壕婵﹩鍋勫畵鍡涙煟濞戝崬鏋ら柍褜鍓ㄧ紞鍡樼閺嶎厼缁╁ù鐘差儐閻撴洘銇勯幇鍓佹偧濠碘€虫喘閺屾稑鈻庡▎鎴犵槇濠殿喖锕︾划顖炲箯閸涘瓨鍊绘俊顖滃劋閻ｎ剛绱撻崒娆掑厡濠殿喖顕划鏃堟偡閹殿喗娈鹃悷婊呭鐢鈧數濮撮…鍧楁嚋瀵版浜滈埢鎾诲Ω閳哄倵鎷洪梺闈╁瘜閸欌偓婵＄偓鎮傞弻娑㈡偐瀹曞洤鈷岄梺鎸庣箘閸嬨倕鐣烽妸褉鍋撳☉娆樼劷闁告妫勯埞鎴﹀煡閸℃浠村銈嗘肠閸涱厾绛忔繝鐢靛У绾板秹鎮″▎鎾寸厵闁兼祴鏅涙禒婊堟煃瑜滈崜姘舵偋濡ゅ啰鐭氶弶鍫涘妿缁♀偓闂佹悶鍎崝宀勫焵椤掑嫭鏁遍柕鍥у缁犳盯骞橀幇浣锋闂備胶顭堥鍡涘箲閸パ屽殨濞寸姴顑愰弫鍥煟閺冨洦鑵圭紓鍐╂礃缁绘繂顕ラ柨瀣凡闁逞屽墯濞茬喎鐣烽鐑嗘晬婵椴稿▓楣冩⒑閸濆嫯顫﹂柛搴㈢叀閹繝寮撮姀锛勫幐闂佹悶鍎崕杈ㄤ繆閸忕⒈娈介柣鎰煏椤忓牆鐓″鑸靛姇缁犺崵鈧娲栧▔锕侇樄闁哄备鈧磭鏆嗛悗锝庡墰琚﹂梻浣筋嚃閸犳捇宕归懡銈呭灊婵炲棗绻嗛弸搴ㄦ煟閹伴潧澧绘俊顐ｅ灥閳规垿鎮╁▓鎸庢瘜闂佸憡鎸荤换鍡涘Φ閹版澘绀冩い鏃囨娴滈亶姊虹憴鍕妞ゆ泦鍥ㄥ珔闁绘柨鍚嬮悡鐔兼煛閸愩劌鈧摜鏁崼鏇熺厱闁靛鍎遍埀顒€缍婃俊鐢稿礋椤栨碍顥濋梺鍓茬厛閸犳宕愰姘ｆ斀闁绘劘灏欐晶鎴︽煕閺傛寧鎹ｆ俊鍙夊姍楠炴鈧稒锚椤庢捇姊婚崒姘卞缂佸鍨块垾鏍醇閵夛腹鎷洪梺鍛婄☉閿曘劍绔熷Ο姹囦簻闁瑰瓨绻冮ˉ鐘电磼椤旂晫顣叉繛鐓庣箻婵℃瓕顦撮柣锕€鐗撳娲箹閻愭彃濮岄梺鍛婃煥閻倿宕洪埀顒併亜閹烘垵鈧悂宕㈤幘顔界厸鐎光偓閳ь剟宕伴幘鑸殿潟闁圭儤鍤﹂悢鐓庝紶闁告洦鍓涚粔褰掓⒒閸屾瑨鍏屾い顓炵墦椤㈡牠宕卞☉妯碱唹闂佹悶鍎滈崨顔筋啎缂傚倷绀侀鍫ヮ敋閹惰棄绫嶉柛顐ｇ箘椤︺劑姊洪棃娴ゆ稒鎷呴梹鎰瀳闂傚倸鍊峰ù鍥敋瑜庨〃銉╁传閵壯傜瑝閻庡箍鍎遍ˇ顖滃閸ф鈷戞い鎺嗗亾缂佸顕划濠氼敍閻愭潙鈧敻鏌ㄥ┑鍡涱€楅柡瀣洴閹嘲鈻庡▎鎴犳殼闂佽鍠楅〃濠囧极閹邦厽鍎熼柍鈺佸暟娴滃爼姊绘担铏瑰笡闁规瓕顕х叅闁绘梻鍘ч拑鐔衡偓骞垮劚椤︻垶鎮″☉妯忓綊鏁愰崨顔兼殘闂佽绻戦幑鍥ь潖閾忓湱纾兼俊顖濇閻熸劗绱撴笟鍥ф灍闁荤啿鏅涢锝囨嫚濞村顫嶉梺闈涚箳婵兘顢橀崫鍕ㄦ斀闁绘顕滃銉╂煙閾忣偄濮嶉柟顕嗙節楠炴﹢寮妷锔芥澑婵＄偑鍊栧濠氬Υ鐎ｎ喖缁╃紓浣姑肩换鍡涙煟閹邦垰鐓愭い銉ヮ樀閺岋綁鏁愰崶褍骞嬪銈冨灪濞茬喖寮崘顔肩劦妞ゆ帒鍊婚惌鍡涙倵閿濆骸浜栧ù婊勭矒閺岀喖鏌囬敃鈧弸娑㈡煛鐎ｎ亪顎楅棁澶嬬節婵犲倻澧㈤柣锝嗘そ閺岀喖顢欓悡搴⑿╅梺瀹狀嚙濮橈妇绮诲☉銏犵闁告剬鍛紱闂傚倸鍊烽懗鍓佸垝椤栨粍宕查柛宀€鍋為崑澶娾攽閸屾粠鐒鹃柦鍐枑缁绘盯骞嬪▎蹇曚患闂佺粯甯楀浠嬪蓟濞戞粎鐤€濠电姴鍟悵鏇㈡⒑閹肩偛濡奸柣蹇旂箞閹箖鎮滈懞銉︽珳闂佸壊鍋侀崹濠氬级缁嬪簱鏀介柣鎰綑閻忥箓鏌ｉ悢婵嗘搐閸屻劑鏌ｉ姀鐘冲暈闁抽攱甯￠弻娑氫沪閹规劕顥濋梺閫炲苯澧柟顔煎€块妴浣割潩妫版繃鏅ｉ梺瀹犳硾閹碱偄煤椤撱垹鏋侀柛宀€鍋涚粈鍫㈡喐韫囨稒鏅?
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

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎梺鐟板⒔缁垶宕戦幇鐗堢厱闁归偊鍨扮槐锕傛煟閵忋垻甯涘ǎ鍥э躬閹瑩顢旈崟銊ヤ壕闁哄稁鍘介崑瀣繆閵堝懎鏆熼柣顓熺懇閺岀喖鎮欓鍌涜弴闂侀€炲苯澧柟铏悾鐑芥晲閸℃绐為悗鍏夊亾闁逞屽墴閹線宕奸悢铏圭槇闂佹眹鍨藉褍鐡梻浣侯焾閿曘儵骞冮崒姘煎殨闁归棿鐒﹂弲婵嬫煕鐏炲墽銆掗柛?selectedEvaluation.id 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎梺鐟板⒔缁垶宕戦幇鐗堢厱闁归偊鍨扮槐锕傛煟閵忕媭鐓兼慨濠勭帛閹峰懘鎮烽柇锕€娈濇繝鐢靛仜瀵爼鎮ч悩鑼殾闁归偊鍨禍褰掓煙閻戞ê鐏╅柡灞熷喚娓婚柕鍫濇噽缁犱即鏌ｅΔ鈧敃顏堝春濞戙垹绠ｉ柨鏃囨娴狀垶姊洪幖鐐插姌闁告柨閰ｅ畷锝夊焵椤掆偓椤啴濡堕崨顓у妷濡炪們鍔岄敃顏勵嚕婵犳碍鏅查柛顐犲灮閺夋悂姊洪崫鍕偓鎼佹倶濠靛绠洪柣銏犳啞閳锋垿鎮归崶锝傚亾閾忣偆褰茬紓鍌欒兌缁垳鎹㈤崼婵堟殾閻熸瑥瀚ㄩ崑鍛存煕閹扳晛濡块柣銈傚亾婵犵數鍋犻幓顏嗗緤娴犲绠熼柨鐔哄閺佸洭鏌熺粙璺ㄥ嚬缂佽妫濋弻锝夊箛閸忓摜鐩庨梺閫炲苯澧柣妤佹礈閸欏懘鎮楅獮鍨姎妞わ富鍨虫竟鏇熺節濮橆厾鍘甸梺璇″瀻閸涱剟鍋楅梻浣侯焾椤戝棝骞愭ィ鍐ㄧ疅闁圭虎鍠栫粈瀣亜閹烘垵浜炴俊宸墴濮婄粯绗熼埀顒€顭囪閹嗙疀濞戞巻鍋撻敃鍌氶唶闁靛鍠楅弲顏堟⒑閹稿海绠撴い锔诲灣缁崵绱掑Ο闀愮盎闂佸搫鍟ú锕偹夋径鎰厓鐟滄粓宕滃☉銏犵婵せ鍋撶€殿喖顭烽幃銏ゅ传閸曨剛鈧娊姊洪崨濠庢畼闁稿绋撶划濠氬箮閼恒儮鎷洪梺鑽ゅ枛閸嬪﹪宕甸悢鍏肩厱闊洦鏋傞鍫稏闊洦姊荤弧鈧┑顔斤供閸撴盯鏁嶅鍐ｆ斀闁绘劕寮堕ˉ鐐烘煕閳轰胶澧曢崡杈ㄣ亜閺囨浜惧┑顔硷攻濡炶棄鐣烽悜绛嬫晣婵炴垶鐟ラ悵閬嶆⒒娴ｄ警鐒炬い鎴濇嚇閺佸啴濡舵径瀣患闂佺粯鍨煎Λ鍕不濞戙垺鐓熸俊銈傚亾闁绘妫欑粋鎺楊敇閵忊檧鎷绘繛鎾磋壘濞层倕顕ｉ崹顔规斀闁炽儴娅曢崰妯尖偓瑙勬处閸撶喎螞閸愩劉妲堥柟鐑樻尰閺夋悂姊绘担鍝ユ瀮婵☆偄瀚灋婵°倕鎳忛崐鍫曟煥濠靛棙宸濈痪鎯у悑閵囧嫰寮撮悙鏉戞闂佽楠忔俊鍥焵椤掑喚娼愭繛娴嬫櫇缁辩偤鍩€椤掑倻纾奸柣妯虹－閳藉鏌嶉挊澶樻Ц闁宠閰ｉ獮瀣攽閸℃瑯鍟堥梻鍌氬€搁崐椋庣矆娴ｈ櫣绀婂┑鐘叉搐绾捐鈹戦悩鍙夋悙缂佲偓閸喓绠鹃柟瀛樼懃閻忊晝绱掗悩铏仢闁哄矉绲借灒闁煎鍊戦崑鐐烘⒑鐞涒€充壕闂佸吋浜介崕顖涚濠婂牊鐓涢柛鎰╁妼閳ь剛鎳撻埢宥夊即閵忥紕鍘藉銈嗘尵閸犲骸霉椤曗偓閺岋紕浠︾化鏇炰壕鐎规洖娲﹀▓鏇㈡煟鎼搭垳绉甸柛鎾寸洴閹線宕奸妷锕€鈧敻鎮峰▎蹇擃仾缂佲偓閸愵喗鍋ㄦい鏍ㄧ☉缁椻晠鏌ｈ箛鏂挎诞闁哄矉缍侀幃娆戔偓鐢电《閺嬫棃姊洪柅鐐茶嫰婢ь噣鏌涘Ο鑽ゅ缂佹梻鍠栧鎾倷閳哄倹鏉搁梺鍦劋婵炲﹤鐣烽幇鏉垮嵆闁靛繒濮烽弻鍫熺箾鐎电甯堕柣掳鍔戝畷鏇炍旈崨顔惧幈闂佹枼鏅涢崰姘枔閵忋倖鐓熼柡鍌涘椤ャ垽鏌＄仦璇测偓婵嬬嵁閺嶃劍濯撮悷娆忓閺侇亜鈹戦悩鎰佸晱闁哥姵鐗犻幃褔骞樼拠鑼舵憰閻庡箍鍎遍ˇ浼存偂閵夆晜鍊甸柨婵嗙凹缁ㄨ棄霉閻樿櫕鍊愭慨濠冩そ濡啫鈽夊▎鎰€烽梺璇插閻噣宕￠幎鑺ュ仒妞ゆ洍鍋撴鐐村笒铻栭柍褜鍓熼悰顕€濮€閳ヨ尙绠氶梺缁樺姈濞兼瑩宕濋妶鍡愪簻闁靛绠戦崫鐑樻叏婵犲偆鐓肩€规洘甯掗埢搴ㄥ箛椤斿搫浠掑┑锛勫亼閸婃牕鈻旈敃鍌氬窛妞ゆ梻鍘х花銉╂⒒娴ｇ儤鍤€妞ゆ洦鍘介幈銊╂濞戞碍娈鹃梺鍝勮閸庢煡鎮￠弴鐔翠簻闁规澘澧庨幃鑲╃磼閻樼鑰块柡?status 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎梺鐟板⒔缁垶宕戦幇鐗堢厱闁归偊鍨扮槐锕傛煟閵忕媭鐓兼慨濠勭帛閹峰懘鎮烽柇锕€娈濇繝鐢靛仜瀵爼鎮ч悩鑼殾闁归偊鍨禍褰掓煙閻戞ê鐏╅柡灞熷喚娓婚柕鍫濇噽缁犱即鏌ｅΔ鈧敃顏堝春濞戙垹绠ｉ柨鏃囨娴狀垶姊洪幖鐐插姶濞存粍绮撻幆鍐洪鍛幈闂佺懓鐡ㄧ换鍐嫻閿涘嫮纾奸弶鍫涘妼濞搭噣鏌熷畷鍥ラ柟鐟板瀹曨偊宕熼鈧崝鎺撶節閻㈤潧浠滈柣掳鍔庨崚鎺撴償閵娾懇鍋撻敃鍌氶唶闁靛鍎抽崢娲煙閸忚偐鏆橀柛鏂跨灱缁鎳￠妶鍌氫壕閻熸瑥瀚粈鈧┑鐐茬湴閸旀垵顕ｉ幖浣哥劦妞ゆ帒瀚埛鎺楁煕鐏炲墽鎳呮い锔奸檮缁绘繈鍩€椤掑嫭鐒肩€广儱妫欓崕顏堟煙閸忚偐鏆橀柛鏂跨灱缁絽螖娴ｉ绠氶梺闈涚墕閹冲繘宕宠ぐ鎺撶厽闁靛牆娲ゆ禍鍓х磼缂佹绠炴俊顐㈠暙閳藉宕￠悙鎻掝棊闂傚倷鑳剁划顖炲箰閹间礁鐤ù鍏兼綑缁犵喓绱掔€ｎ偒鍎ラ柣鎾卞劦閺屾盯顢曢敐鍥╃暭濡炪倧瀵岄崢濂稿煘閹达附鍋愮紓浣股戦柨顓烆渻閵堝棗鐏ラ柟鍐茬箻閵嗕焦绻濋崶銊㈡嫽婵炶揪绲介幉锛勬嫻閳ユ剚鐔嗙憸搴ㄣ€冮崨绮光偓锕傚垂椤斻儳鍠栭幃鈩冩償椤旂瓔妫ユ繝鐢靛█濞佳囧磹閹间礁绠熼柨鐔哄У閸嬪倿鏌ｉ弬鍨倯闁绘挻鐟╁娲敇閵娧呮殸婵犫拃鍐剧吋闁哄本鐩俊鍫曞炊瑜庨悘鍫ユ⒑閸濆嫭婀扮紒瀣灱閻忔帡鏌ｉ悩鍙夋悙鐎殿喖澧庨幏鐘绘倷閻戞ǚ鎷洪柣鐘叉礌閳ь剝娅曢悘宥咁渻閵堝啫濡奸柨鏇ㄤ邯楠炲啯瀵奸幖顓熸櫔闂侀€炲苯澧柣锝囨焿閵囨劙骞掑┑鍥ㄦ珦闂備胶绮幐鍝モ偓鍨笒椤洤鈽夐姀鈾€鎷婚梺绋挎湰閻熴劑宕楀畝鈧槐鎺楊敋閸涱厾浠搁梺闈涙閸熸潙鐣烽妸褉鍋撳☉娅虫垵鈻嶉崶顒佲拺闁圭瀛╅埛鎰版煕鎼淬垹鈻曠€规洜鎳撻埞鎴﹀幢韫囨梹鏉搁梻浣虹帛钃辩憸鏉垮暣瀵啿鈻庨幇鈺€绨婚梺鍝勬祩濠⑩偓闁规煡绠栭弻鐔碱敊缁涘鐣堕梺瀹犳椤︻垶鍩㈠澶樻晣鐟滃瞼鑺遍懖鈺冪＜闁稿本绋戝ù顔姐亜閵忊槄鑰垮┑顔瑰亾闂佹娊鏁崑鎾绘煙闁垮銇濇慨濠冩そ瀹曘劍绻濋崟顓犳殼闂佽瀛╅崙褰掑储婵傚壊鏁婇煫鍥ㄦ尨閺€浠嬫倵閿濆骸浜為柛姗€浜堕弻锝嗘償椤栨粎校闂佸憡鎸婚悷锔剧矉閹烘鐒肩€广儱妫楅惂鍕⒑缂佹ɑ鐓ラ柛姘儔閹繝鎮㈤梹鎰畾濡炪倖鐗楃换鍐敂閻樼粯鐓ユ繛鎴烆焽鑲栫紓浣介哺鐢繝骞冮埡鍛殥闁靛牆娲﹀В鍥⒒娴ｅ憡鎯堥柣顒€銈稿畷浼村箻閼告娼熼梺鍦劋閸わ箓鎮㈢拋鎸庢そ椤㈡棃宕熼鍌涙緭闂傚倸鍊搁崐鎼佸磹閹间讲鈧箓顢楅崟顐ゎ槶闂佹寧娲栭崐鍝ョ矆閸喓绠鹃柟瀛樼懃閻忊晠鏌ｉ幒鎴犱粵闁靛洤瀚伴獮鎺戭吋閸ヮ亞鐛ラ梻浣告憸閸犲海鎹㈠鈧璇测槈閵忊剝娅滈柟鑲╄ˉ閸撴繈鎮靛┑瀣€甸悷娆忓缁€鍐煕閵娿儱顣抽柟骞垮灩閳规垹鈧綆浜為崐鐐烘偡濠婂啰绠婚柟顔藉劤鐓ゆい蹇撴噹娴狀厼鈹戦悩璇у伐閻庢凹鍙冮幃锟犲Ψ閳哄倻鍘介梺鎸庣箓濞层倝宕㈤幘顔界厵妞ゆ梻鎳撴晶鏌ユ煙椤栨稒鐓ラ摶锝囩磽娴ｈ偂鎴濐熆閹达附鈷掗柛灞剧懅椤︼箑顭块悷甯含鐎规洘鍨垮畷銊╊敍濠婂懐鍘梻浣烘嚀椤曨參宕戦悢绗衡偓?
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

  useEffect(() => {
    const retryingRunIds = Object.keys(retryingAllScoresByRunId);
    if (retryingRunIds.length === 0) return;

    const completedRetryRunIds: string[] = [];
    for (const runId of retryingRunIds) {
      const run = runs.find((item) => item.id === runId);
      const currentStatus = run?.status;
      const prevStatus = retryAllScoresStatusRef.current.get(runId);

      if (currentStatus) {
        retryAllScoresStatusRef.current.set(runId, currentStatus);
      }

      const hadStarted = prevStatus === 'pending' || prevStatus === 'running';
      const isNowCompleted = currentStatus === 'completed' || currentStatus === 'failed';
      if (hadStarted && isNowCompleted) {
        completedRetryRunIds.push(runId);
      }
    }

    if (completedRetryRunIds.length === 0) return;

    if (selectedEvaluation && selectedRun && completedRetryRunIds.includes(selectedRun.id)) {
      void runsApi.getResults(selectedRun.id)
        .then((latestResults) => {
          setResults((prev) => {
            const next = mergeResultsByTestCase(prev, latestResults);
            updateEvaluationCache(selectedEvaluation.id, { results: next, selectedRunId: selectedRun.id });
            return next;
          });
        })
        .catch((error) => {
          console.error('Failed to refresh results after retry scores completion:', error);
        });
    }

    setRetryingAllScoresByRunId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const runId of completedRetryRunIds) {
        if (next[runId]) {
          delete next[runId];
          retryAllScoresStatusRef.current.delete(runId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [retryingAllScoresByRunId, runs, selectedEvaluation, selectedRun]);

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

  const loadAnalysisReports = useCallback(async (evaluationId: string) => {
    setAnalysisReportsLoading(true);
    try {
      const items = await evaluationAnalysisReportsApi.list(evaluationId);
      setAnalysisReports(items);
      setSelectedAnalysisReportId((prev) => {
        if (!prev) return items[0]?.id ?? null;
        return items.some((item) => item.id === prev) ? prev : (items[0]?.id ?? null);
      });
    } catch (error) {
      console.error('Failed to load analysis reports:', error);
      setAnalysisReports([]);
      setSelectedAnalysisReportId(null);
    } finally {
      setAnalysisReportsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedEvaluationId || !isSelectedEvaluationOwner) {
      setAnalysisReports([]);
      setSelectedAnalysisReportId(null);
      return;
    }
    void loadAnalysisReports(selectedEvaluationId);
  }, [selectedEvaluationId, isSelectedEvaluationOwner, loadAnalysisReports]);

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

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎梺鐟板⒔缁垶宕戦幇鐗堢厱闁归偊鍓欑痪褔鏌ｉ妶鍛仼闁宠鍨堕獮濠囨煕婵炑冩噹缁躲倕霉閻樺樊鍎忛柣銈庡枟閵囧嫰骞囬埡浣插亾閹版澘纾婚柟鐐墯濞尖晜銇勯幒鎴Ч閺佸牓姊绘笟鈧褍煤閵堝洠鍋撳顐㈠祮闁绘侗鍣ｉ獮鎺懳旈埀顒傜不閿濆棛绡€闁割煈鍋勬慨鍐磼鏉堛劎绠炴慨濠勭帛閹峰懘鎳為妷锝傚亾閸愵亞纾奸柍褜鍓氶幏鍛存嚃濠靛洨鈽夐柍瑙勫灩閳ь剨缍嗘禍锝夊箺閺囥垺鈷戦柟绋挎捣缁犳挻銇勯敂璇茬仯缂侇喛顕ч埥澶娾枎瀹ュ嫮鐩庨梻浣告贡閸庛倝宕归悽绋跨劦妞ゆ帒瀚峰Λ鎴︽煕閹烘挸娴柟顔荤矙瀹曘劍绻濋崟顐㈢闂備胶鎳撻崥瀣偩椤忓牆鍨傚┑鐘冲搸閳ь剙鍊块幊鐘活敄閽樺澹曢梺绋跨箰椤︻垱绂嶆ィ鍐┾拺鐟滅増甯楅敍鐔虹磼閳ь剚绗熼埀顒勫箯閹达附鍋勯柛婵勫劤椤旀洟姊洪悷鎵憼闁荤喆鍎甸幃姗€鍩￠崨顔惧幈濠德板€撶粈渚€鍩㈤弴銏＄厸閻忕偟鍋撶粈鍐磼缂佹娲寸€规洖缍婇、娆撴偂鎼搭喗缍撴繝纰夌磿閸嬫垿宕愰妶澶婄；闁圭儤顨呯壕璇测攽閻樻彃浜炴繛鍏肩墬缁绘稑顔忛鑽ゅ嚬濡炪們鍎遍悧濠勬崲濞戙垹绠ｉ柣鎰硾椤ユ繂顪冮妶鍐ㄢ偓鎰板磻閹剧粯鈷掗柛灞剧懅椤︼附绻濋埀顒勬焼瀹ヤ讲鍋撻敃鍌氶唶闁靛鍎抽弻鍫ユ⒑缁夊棗瀚峰▓锝囩磽瀹ュ棛澧甸柣鎿冨亰瀹曞爼濡搁敃鈧娑樷攽閻愬弶鈻曞ù婊冪埣瀵偊宕掗悙瀵稿幈闂佸搫娲㈤崝灞筋嚕椤曗偓閺岋絽鈽夊▎鎰３濠殿喖锕ュ浠嬪箠閿熺姴围闁告稑鎷戠徊浠嬫箒濠电姴艌閸嬫挾绱掗鐣屾噧闁伙絽鍢查…銊╁醇閻斿搫濮搁柣搴＄畭閸庨亶骞夊Ο娆炬Щ濡炪値鍙€濞夋洟骞戦崟顒傜懝妞ゆ牗鑹炬竟瀣⒒娴ｅ憡鍟為惇澶岀磼椤旂晫鎳冩い顐㈢箰鐓ゆい蹇撴媼濡啫鈹戦悙鏉戠仸闁煎綊绠栭妴鍌毭洪鍛嫼闂佽崵鍠愬姗€寮虫潏鈺冪＜缂備焦锕╅悞鐐繆椤愮姴鐏叉慨濠呮缁辨帒螣閸濆嫷娼曢梻浣芥〃缁€渚€骞楀鍕彾闁哄洨鍠撻梽鍕煕濞戞﹫宸ラ柍褜鍓涢弫濠氬蓟閵娿儮鏀介柛鈩冪懃閸ゎ剟姊虹涵鍛毢闁稿鎸荤粚杈ㄧ節閸ヨ埖鏅┑掳鍊愰崑鎾趁瑰鍕姢闁宠鍨块弫宥夊礋椤愨剝婢€闂備胶顭堥敃銉╁垂閸喚鏆﹂柣鐔稿櫞濞差亶鏁傞柛娑卞枟閻濇牠姊绘笟鈧褏鎹㈤崼銉ョ９闁哄洨濮锋稉宥夋煛瀹ュ骸骞楅柣鎾冲暣瀵爼鎮欓弶鎴偓婊堟煕韫囨挾鐒搁柡宀嬬節瀹曢亶顢橀悩鍨闂備礁鎼張顒勬儎椤栨稐绻嗛柣鎴ｅГ閺呮煡鏌涘☉鍗炲季闁诲骸鐡ㄦ穱濠囨倷椤忓嫧鍋撻弽顓炶摕闁靛ě鍕簥闂佸湱澧楀姗€鎮″鈧弻鐔告綇妤ｅ啯顎嶉梺绋款儐閸旀牜鎹㈠☉銏犻唶闁绘柨顨庨崵瀣攽椤曞棛鍒伴柤娲诲灦閸╃偤骞嬮敃鈧悞娲煕閹扳晛濡跨紒浣哄厴濮婅櫣娑甸崨顔惧涧闂佹寧宀搁弻锝夋晲閸ャ劎鍔归梺闈涙处閸旀瑩鐛幒鎴旀斀闁搞儯鍔嶉悵鏇㈡⒒閸屾瑧顦﹀鐟帮躬瀹曟垿宕ㄩ娑樺簥闂佸憡娲﹂崹鎵矆婢舵劖鐓ラ柡鍥殔娴滄儳顪冮妶搴濈盎闁哥喎鐡ㄦ穱濠囧醇閺囩偛鑰垮┑掳鍊愰崑鎾寸箾閸忕厧鐏存慨濠呮缁瑥鈻庨幆褍澹夐梻浣筋潐閹倻绮婚弽顓炵畾闁逞屽墯閵囧嫯绠涢幘鎼￥缂佺偓鍎抽妶鎼佸蓟閺囷紕鐤€闁哄洨鍊姀銏㈢＜妞ゆ劑鍨绘晥濠殿喖锕ㄥ▍锝夊礌閺嶎厼鍗抽柣鏂挎啞缁额剟姊绘担渚劸妞ゆ垵妫濋獮鎰板箹娴ｆ祴鍋撻弮鍫濈妞ゆ柨妲堣閺屾盯鍩勯崘鐐暭闂佽崵鍠嗛崝鎴濐潖閾忓湱鐭欓柛鏍ゅ墲閺侀箖姊虹拠鈥虫灈闁稿﹥鎮傞幃楣冩倻閽樺娼婇梺鍐茬亪閺呮稒绂嶆ィ鍐╃厽闁靛繈鍨洪弳鈺呮煏閸℃韬柡灞剧〒閳ь剨缍嗛崑鍛焊閻㈠憡鐓欓柛娆忣槹鐏忥妇鈧娲滈崰鏍€佸Δ鍛＜婵°倓鐒﹀▍鏍磽閸屾艾鈧悂宕愰幖浣哥９闁告縿鍎抽惌鎾垛偓瑙勬礀濞层劑鎯岄崱妞尖偓鎺戭潩閿濆懍澹曢梻浣筋嚃閸ｏ絿绮婚弽顓炵畺婵犲﹤鐗婄€电姴顭跨捄铏圭劸闁哥偞妞藉缁樻媴閻戞ê娈岄梺瀹︽澘濡兼い顐㈢箺閵囨劙骞掗悙鐢碘棨闁诲骸绠嶉崕閬嶅箠婢舵劕缁╁ù鐘差儐閻撶喖鏌熼柇锕€澧紒鐙欏嫨浜滈柕澹啩妲愰梺鍝勬湰閻╊垰顕ｉ鈧獮姗€宕滄担瑙勵啌闂佽姘﹂～澶娒洪敃鍌氬瀭闁割偅娲栭弰銉╂煃瑜滈崜姘跺Φ閸曨垰绠抽柟瀛樼箥娴犻箖姊?evalModelConfig
  useEffect(() => {
    if (selectedEvaluation?.config?.model_parameters) {
      const params = selectedEvaluation.config.model_parameters;
      setEvalModelConfig({
        temperature: params.temperature ?? DEFAULT_PROMPT_CONFIG.temperature,
        top_p: resolveTopP(params.top_p),
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
    // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻橀弻锝夊箣濠垫劖缍楅梺閫炲苯澧柛濠傛健楠炴劖绻濋崘顏嗗骄闂佸啿鎼鍥╃矓椤旈敮鍋撶憴鍕８闁告梹鍨甸锝夊醇閺囩偟顓洪梺缁樼懃閹虫劙鐛姀銈嗏拻闁稿本鐟х粣鏃堟煃瑜滈崜娑㈠磻濞戙垺鍤愭い鏍ㄧ⊕濞呯娀鏌熺紒銏犳灍闁绘挻鐩幃姗€鎮欓幓鎺嗘寖闂侀潧妫欑敮锟犲蓟瀹ュ牜妾ㄩ梺鍛婃尪閸斿海妲愰悙鍝勫耿婵炴垶顭囬敍娑㈡⒑閸涘﹣绶遍柛姗€绠栧鎶芥晜闁款垰浜鹃柛蹇擃槸娴滈箖姊洪崨濠冨闁告挻鐩畷銏ゅ箹娴ｇ懓鈧敻鏌涜箛鎿冩Ц濞存粓绠栭弻锝嗘償椤栨粎校闂佸憡鎸婚惄顖炲极瀹ュ鍋勯柛婵勫劤椤旀洟鏌ｆ惔锝嗘毄妞ゎ厼鐗撻、鎾诲箻閺傘儲鏂€闂佺偨鍎村▍鏇㈠窗濡椿娈介柣鎰皺缁犲鏌熼瑙勬珖闁归濞€閹崇娀顢楁径濠冩澑闂傚倸鍊风粈浣革耿闁秴纾块柕鍫濐槸閺勩儵鏌涢锝囩闁绘帊绮欓弻鏇熷緞閸繂濮夐梺琛″亾濞寸姴顑嗛悡鐔镐繆椤栨稒銇熼柛鐔风箻閺岋繝宕遍埡浣轰桓闂佸搫鑻粔鐑铰ㄦ笟鈧弻娑㈠箻鐎靛憡鍣伴悗瑙勬处閸ㄦ娊骞戦崟顖毼╃憸搴ㄦ晬韫囨稒鍋℃繝濠傚椤ュ牏鈧鍠栭…鐑藉箖閵忋垹鏋堥弶鍫涘妽濞呮捇姊绘担铏瑰笡闁圭鎽滈懞閬嶅醇閺囩偟锛涢梺瑙勫礃椤曆呯不閻熸噴褰掓晲閸ャ劌娈屾繛瀵稿Т閵堢顫忛搹鍦＜婵☆垵娅ｆ导鍥р攽閳藉棗浜滈悗姘煎墴瀵偊顢氶埀顒€顫忕紒妯诲缂佸瀵уВ鎰版⒑閸︻厸鎷￠柛瀣工閻ｇ兘骞囬悧鍫濅画闂侀€涚祷濞呮洟鎮楀ú顏呪拺缂侇垱娲栨晶鑼磼鐎ｎ偄娴柛鈺傜洴楠炲鏁傞悾灞藉箞闂傚鍋勫ú锔剧矙閹烘鏅柣鏂垮悑閻撶娀鏌涢幘鐟扮处闂侇収鍨堕弻锛勪沪閸撗€濮囬梺璇″灡濡啯鎱ㄩ埀顒勬煟濮楀棗浜濋柣蹇撴濮?prompts 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愮儤鍋嬮柣妯荤湽閳ь兛绶氬鎾閻橀潧骞堟繝娈垮枟閿曗晠宕㈡禒瀣︽繝闈涙閺€浠嬫⒔閸ヮ剙鏄ラ柡宓苯娈梺鍛婃处閸樻悂宕戦幘缁樻櫜閹煎瓨绻勯懗鍝勨攽閳ュ啿绾ч柛鏃€鐟ラ～蹇曠磼濡偐鎳濋梺閫炲苯澧い顓炴穿椤﹁泛顭胯缁诲牆顫忓ú顏勪紶闁告洦鍓欏▍銈夋⒑閻戔晜娅撻柛銊ョ埣閻涱喛绠涘☉妯碱吅闂佹寧妫佸Λ鍕濠婂牊鐓熼煫鍥ㄦ尵缁狅綁鏌ｉ幒鐐电暤鐎殿噮鍓熼崺鈧い鎺戝閳锋帒霉閿濆牊顏犻悽顖涚洴閺屻劌顫濋幍浣镐壕婵炲牆鐏濋弸锕傛煕閳哄倻澧い鏇樺劦瀹曠喖顢涘槌栨Ч婵＄偑鍊栭悧妤冪矙閹捐鍌ㄩ柟闂寸劍閳锋垿鏌涘☉姗堝姛闁活厼妫涚槐鎺楀焵椤掍焦濯撮悷娆忓閻濈兘姊洪崷顓℃闁哥姵顨婇幃鈥斥槈閵忊€斥偓鍫曟煟閹邦厼绲婚柍閿嬫⒐缁绘盯骞撻幒鏃€鎲奸梺闈涙搐鐎氱増鎱ㄩ埀顒勬煃閳轰礁鏆熸い锔垮嵆濮婅櫣鎷犻垾铏亐闂佸搫鎳愭繛鈧鐐诧躬閹晛煤缂佹ɑ娅堥梺鑽ゅУ娴滀粙宕濇惔銊︽櫖闁绘棁娅ｇ壕浠嬫煕鐏炴崘澹橀柍褜鍓氶幃鍌氱暦閹版澘绠瑰ù锝呮憸閿涙瑩姊鸿ぐ鎺擄紵闁绘帪绠撳畷鎴犫偓锝庡枟閻撴瑩姊洪銊х暠妤犵偞蓱閵囧嫰鍩℃担鍝ラ獓闂侀潧娲ょ€氫即鐛幒妤€绠ｆ繝鍨姃閻ヮ亪姊绘担渚劸濡ょ姵鎮傝棟濞村吋娼欐闂佸憡娲﹂崰姘舵偪閳ь剟姊虹憴鍕婵炲鐩崺娑㈠醇閵夛腹鎷洪柡澶屽仦婢瑰棝藝閿旂晫绠鹃悘鐐插€告慨鍌涱殽閻愬樊妲虹紒顔界懃閳诲酣骞嗚閸婎垰鈹戦悩顔肩伇婵炲鐩弫鍐Χ婢跺﹤鎯為梺纭呮彧闂勫嫰鍩涢幋鐘电＝濞达綀鍋傞幋锔藉亗闁靛鏅滈悡娆撴煠閹帒鍔ら柣顓炵灱缁辨帡顢欓崜褍绗￠梺闈涚墳缂嶄礁鐣峰鈧崺锟犲礃閵娿儳顓肩紓鍌氬€搁崐鎼佸磹閻戣姤鍊块柨鏇炲€归弲顏嗙磽閸屾瑧鍔嶆い銊ユ閻ｆ繈骞栨担姝屾憰濠电偞鍨堕崺鍐磻閹剧粯鏅查柛鎰╁妼椤牓姊洪崨濠冪厽闁稿﹥绻堝璇差吋閸偅顎囬梻浣告啞閹歌鐣濋幖浣碘偓浣糕枎閹惧啿鍞ㄥ銈嗘尵閸嬨倕螞瀹勯偊娓婚柕鍫濇绾剧敻鏌涚€ｎ偅灏甸柍褜鍓濋～澶娒哄Ο鐓庡灊闁规崘顕х粻鏍煏韫囧鈧牠宕甸崘顔界厓閺夌偞濯介崗宀勬煏閸剛鐣甸柡宀嬬稻閹棃鏁嶉崟顓熸闂備胶顭堥柊锝嗙閹増顥ゅ┑鐐差嚟婵挳顢栭崨鏉戝嚑濞达絿纭堕弨浠嬫煟濡搫绾у璺哄閺岋綁骞樼€靛憡鍣梺闈涙搐鐎氭澘顕ｉ崐鐕佹Ъ濡炪們鍎茬划鎾诲蓟閿熺姴閱囨い鎰╁灩閳峰姊洪幇浣风凹闁诡喖鍊搁～蹇旂節濮橆剛锛滃┑顔斤供閸忔﹢宕戦幘宕囨殝闁瑰啿锕ょ紞濠傜暦閸洦鏁嗗璺侯儐濞呮棃鏌ｉ悢鍝ョ煀缂佺粯锕㈠畷娲焵椤掍降浜滈柟鍝勭Х閸忓矂鏌嶇紒妯诲磳闁哄矉绻濆畷銊╊敊閸撗呮毉闂備礁鎲＄敮妤冩暜閹烘鐓濋幖娣妼缁犺崵鈧娲栧ù鍌炲船閻戞绡€鐎典即鏀卞姗€鍩€椤掍焦宕岄柟顔惧仱閺佸啴鍩€椤掑嫬鐓濈€广儱顦悙濠勬喐濠婂啨鈧帗绻濆顓犲帾闂佸壊鍋呯换鍐夊鍐ｆ斀妞ゆ梻鍘ч埀顒€娼″璇测槈濞嗘垹鐦堥梺鍛婂姦娴滄粓鍩涘畝鍕拺闁圭娴风粻姗€鏌涚€ｃ劌鈧洟顢氶敐澶婄妞ゆ棁妫勬禍婊堟⒑閹呯婵犫偓閸楃倣锝夊炊椤掍讲鎷婚梺绋挎湰閼归箖鍩€椤掍焦鍊愰柟顔ㄥ嫮绡€闁告劦浜為幊婵嗏攽鎺抽崐鏇㈠箠鎼达絽顥氶柛褎顨嗛悡娆撴煙濞堝灝鏋涙い锝呫偢閺岋綁骞樼€涙顦伴梺鍝勬湰濞茬喎鐣烽悡搴樻斀闁糕€崇箰娴滈箖鏌涘☉姗堝姛妞も晜褰冭灃闁挎繂鎳庨弳鐐烘煃闁垮绗掗棁澶愭煥濠靛棙宸濋柟钘夊€块弻娑㈠Χ閸℃瑦鍣紓浣介哺鐢偟妲愰幒鎳崇喖鎮滃Ο璺ㄦ闂佽姘﹂～澶娒哄鈧畷褰掑锤濡も偓缁犳牠鏌嶉崫鍕殲閻庢碍宀搁弻銈囧枈閸楃偛鈷曠紓渚€浜舵禍璺侯潖缂佹ɑ濯寸紒娑橆儐缂嶅牊绻濋姀銏″殌婵☆偅鐟╁鑼崉娴ｆ洘妫冨畷銊╊敇閻欏懐骞㈤梻鍌欑劍閺嬪ジ寮插☉銏犵柈闁规鍠栨慨顒勬煃瑜滈崜鐔奉潖婵犳艾纾兼慨妯哄船椤も偓濠电偞鎸荤喊宥夈€冩繝鍌滄殾闁哄洢鍨圭粻娑㈡煟濡も偓閻楀繘宕㈡禒瀣拺閻熸瑥瀚崝銈嗐亜閺囥劌骞栭悡銈夋煙缂併垹鏋熼柣鎾寸洴閹﹢鎮欓幓鎺嗘寖濠电偞褰冮顓㈠焵椤掍緡鍟忛柛鐘愁殜楠炴劙鎼归锝呭伎闂侀€炲苯澧撮柡灞界Ч閸┾剝鎷呴崨濠冾啋闂備浇妗ㄧ欢鈩冪椤忓嫷娼栫紓浣股戞刊瀵哥磼濞戞﹩鍎忔繛鍫幘缁辨挻鎷呴搹鐟扮闁汇埄鍨遍〃鍫ュ箲閵忕姭妲堥柕蹇曞Х閸旓箑顪冮妶鍡楃瑨閻庢凹鍙冮幃鈥斥槈閵忊€斥偓鍫曟煟閹邦厼绲婚柍閿嬫閺屽秹鎸婃径妯烩枅闂佸搫鑻粔鍫曞箯閻樿鐭楀璺猴攻閺侇亞绱撻崒娆掑厡濠殿喚鏁婚幆鍕敍濮樼厧娈ㄩ梺鍦檸閸犳宕戦幋锔界厓鐟滄粓宕滈悢椋庢殾妞ゆ牗澹曢崑鎾绘晲鎼粹剝鐏嶉梺鎶芥敱鐢帡婀侀梺鎸庣箓閹冲繘宕悙鐑樼厵妞ゆ牗姘ㄦ晶锕傛煛鐏炶鈧洜鍙呴柣鐘叉穿鐏忔瑦绂掗幖浣光拺閻犲洠鈧磭浠╅梺鍝勭墱閸撶喖鐛箛娑樺窛閻庢稒蓱閸庮亪姊绘笟鍥т簼缂佸鎹囬幃宄扳攽閸モ晝鐦堥梺姹囧灲濞佳勭閿曞倹鐓曟い顓熷灥閻忥妇鈧娲栫紞濠傜暦閻戠瓔鏁囬柣妯夸含閻熸繈姊绘担鍝勫付妞ゎ偅娲熷畷鎰板箛閺夎法锛涢梺瑙勫礃閸╂牠宕伴崱娑欑厱闁哄洢鍔屾晶鐗堛亜閿斿搫鍔氶柍瑙勫灴閹瑩鎳犻浣稿瑎闂備胶顭堥敃銉ф崲閸儱绠栧ù鍏兼儗閺佸鏌嶈閸撴瑩鎮鹃柨瀣檮缂佸顕抽妸鈺傜叆闁哄啫娴傚鎰版倵濮樿櫕顥夐柍瑙勫灴閹瑩鎳滈棃娑欓敪缂傚倷娴囧鎾跺垝濞嗘挾宓佸鑸靛姈閺呮悂鏌ｅΟ鍨毢闁伙綁绠栧娲礈閹绘帊绨撮梺绋垮閻擄繝骞冮敓鐘插嵆闁绘劏鏅滈弬鈧梻浣虹帛钃辩憸鏉垮暣閸┾偓妞ゆ巻鍋撶紓宥咃工閻ｇ兘顢涢悙鏉戔偓鐑芥煟閹寸儐鐒介柛姗€娼ч—鍐Χ閸℃瑥顫х紓浣割儐鐢繝骞冮敓鐘参ㄩ柨鏃囨〃缁ㄨ顪冮妶鍡樺鞍缂侇喖鏈幈銊╁磼濠ф儳浜鹃悷娆忓绾炬悂鏌涢弮鈧崹鍧楀Υ娴ｅ壊娼╅悹鍝勬惈缁愭稑顪冮妶鍡樼叆濠⒀傜矙閸?
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
      cacheEvents.hasPendingUpdates('promptGroups') ||
      cacheEvents.hasPendingUpdates('models') ||
      cacheEvents.hasPendingUpdates('providers') ||
      cacheEvents.hasPendingUpdates('evaluations');

    if (shouldInvalidateListCache) {
      cacheEvents.consumePendingUpdates('promptGroups');
      cacheEvents.consumePendingUpdates('models');
      cacheEvents.consumePendingUpdates('providers');
      cacheEvents.consumePendingUpdates('evaluations');
      listCache = null;
    }

    // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻娑樷槈濮楀牊鏁鹃梺鍛婄懃缁绘﹢寮婚敐澶婄婵犲灚鍔栫紞妤呮⒑闁偛鑻晶顕€鏌涙繝鍌涜础缂侇喖顑夐獮鎺楀棘閸濆嫪澹曢梺鎸庣箓缁ㄨ偐鑺辨禒瀣厱闁哄啯鎸鹃悾杈ㄣ亜椤忓嫬鏆ｅ┑鈥崇埣瀹曞崬螖閳ь剙顭囬幋锔解拺缂佸顑欓崕鎰版煙閻熺増鍠樼€殿喛顕ч埥澶愬閳ュ厖绨婚梻鍌欑閻忔繈顢栭崨顔绢浄闁圭虎鍠楅埛鎴犵磼椤栨稒绀冮柡澶婄秺閺屾稓鈧綆鍋呯亸顓熴亜椤忓嫬鏆ｅ┑鈥崇埣瀹曞崬螖閳ь剙顭囬幋锔解拺缂佸顑欓崕鎰版煙缁嬪灝鈷旀俊鍙夊姍楠炴﹢骞囨担鍛婂€梻浣告啞缁矂宕幎钘夎Е妞ゆ劏鎳￠弮鍫熷亹闂傚牊绋愮划鍫曟⒑閸濄儱娅忛柛瀣樀閹﹢骞掑Δ浣哄幗闂佺粯锚瀵墎绮氶崸妤佸€堕煫鍥ㄦ⒒閹冲懐绱掗鍡欑М闁诡喗鐟╅幃婊兾熼柨瀣伖闂佽崵鍠愮划搴㈡櫠濡ゅ啯鏆滈柟鐑樻尵椤╂彃霉閻撳海鎽犻柣鎾存礋閺岀喖骞嗚閸ょ喖鏌熼崘鍙夊枠闁哄瞼鍠栭、姘跺焵椤掆偓椤洩顦堕柣蹇斿浮濮婃椽鎮℃惔顔界稐闂佺锕ラ〃濠囧箚娓氣偓瀹曞ジ濡烽敂瑙勫闂傚倸鍊搁悧濠囨儎椤栫偞鍋樻繝濠傛噽绾惧ジ鏌熺紒妯虹瑨闁抽攱姊圭换娑㈠箣濠靛牅绮甸梺闈涚墳缂嶄礁鐣峰鈧崺锟犲礃閵娿儳顔戞繝纰夌磿閸嬫垿宕愰弽褜鍟呭┑鐘宠壘绾惧鏌熼崜褏甯涢柣鎾存礃閹便劌顫滈崱妤€鈷掗梺绋块缁绘垿濡甸崟顖氬嵆婵☆垰鎼慨锕傛倵鐟欏嫭绀堥柛鐘崇墵閵嗕礁鈽夊鍡樺兊婵℃彃鏈悧妤佹櫏濠电姷顣槐鏇㈠磻閹达箑纾归柡宥庡幗閸嬪淇婇妶鍛殶闁活厽鐟╅弻鐔告綇閸撗呮殸闂佺粯甯掗悘姘跺Φ閸曨垰绠抽柛鈩冦仦婢规洟姊绘担绛嬪殭缂佺粯鍨甸～婵嬪Ω閳轰胶顔夐梺闈涚箳婵厼危閸儲鐓忛煫鍥ㄦ礀鍟稿銈嗘尰濡炶棄顫忛搹鍦＜婵☆垰鎼～宀勬⒑鐠囪尙绠茬€光偓缁嬭法鏆﹂柣銏㈩焾绾惧ジ鏌ｉ幇顔克夐柟鐤缁辨挻鎷呴崜鎻掑壉闁诲海鐟抽崨顖滅効闁诲函缍嗛崰妤呮偂閺囥垺鐓欓柟顖嗗苯娈堕梺闈涙鐢绌辨繝鍥х煑濠㈣泛锕ら～鎺懳旈悩闈涗沪閻㈩垽绻濋悰顔嘉熺亸鏍т壕闂傚牊绋掗幉鎼佹嚃閺嶎厽鈷掗柛灞剧懅缁愭梹绻涙担鍐叉濞咃綁姊绘担鍛婂暈濞撴碍顨婂畷褰掑础閻戝棛鍞甸梺鍝勭▉閸樹粙鍩涢幋锔藉仯闁搞儜鍐獓闂佸摜鍋涢ˇ浼村Φ閸曨垼鏁冮柕蹇婃櫆绗戦梺缁樻尪閸婃牠骞堥妸銉富閻犲洩寮撴竟鏇㈡⒒娓氣偓濞佳兾涘Δ鍛柈妞ゆ牗绮嶅畷鍙夌節闂堟侗鍎忕痪鎯у悑缁绘繃绻濋崒姘间痪濡炪倖姊瑰ú鐔奉潖缂佹ɑ濯撮柧蹇曟嚀缁楋繝姊洪崷顓х劸闁硅姤绮撻崺鈧い鎺嗗亾闁诲繑姘ㄩ弫顕€鏁撻悩鑼暫闂佽法鍠撴慨鏉戞暜闂備礁鍟块幖顐﹀磹婵犳艾鍌ㄩ梺顒€绉甸埛鎴︽偡濞嗗繐顏紒鑸靛絻椤儻顦叉繛鎾棑閸掓帒鈻庨幇顔剧槇濠殿喗锕╅崢楣冨储娴犲鐓欓柤娴嬫櫈閻︿粙鏌℃径濞夸粧闁告帗甯楃换婵嗏枔閸喗鐏堥梺鎸庢穿婵″洭宕氶幒妤婃晬闁绘劘灏欓鍡涙⒑閸涘﹣绶遍柛銊╀憾瀹曚即宕卞☉娆戝幈闂佸搫娲﹂〃鍡椻枍閸愵喗鐓欓柟缁㈠枟閺佽京绱掔紒妯肩疄闁诡喕绮欏Λ鍐ㄢ槈濡や礁鐓曢梻鍌欑閹诧繝鈥﹂崱娑樼闁告挆鍐ㄐㄩ梻鍌欒兌閸嬨劑宕曟潏鈺侇棜妞ゆ挶鍨瑰Ч鏌ユ煥閺冨倹娅曠紒鈾€鍋撻梻鍌氬€搁悧濠勭矙閹烘挸绶為柛鏇ㄥ灡閻撴洟骞栨潏鍓у埌闁哄鐩弻锛勪沪鐠囨彃顬堥梺瀹狀潐閸ㄥ灝鐣烽崡鐑嗘建闁割偁鍨婚ˇ顖氣攽閻樺灚鏆╅柛瀣█瀹曟垿骞囬弶璺ㄧ崶闂佸搫璇炵仦鍓х▉婵犵數鍋涘Ο濠冪濠婂懐涓嶅ù鍏兼綑缁犺绻涢敐搴″闁绘帞鍎ゆ穱濠囶敃閵忕姵娈诲┑顔硷功閸庛倕顭囬鍫濈妞ゆ棁娉曢悰銉╂⒒娓氣偓濞艰崵绱為崶鈺佺筏濞寸姴顑嗛崑?
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
      // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柟缁㈠枟閸庡顭块懜闈涘缂佺嫏鍥х閻庢稒蓱鐏忣厼霉濠婂懎浜惧ǎ鍥э躬婵″爼宕熼鐐差瀴闂備礁鎲￠悷銉ф崲濮椻偓瀵鏁愭径濠勵吅闂佹寧绻傚Λ顓炍涢崟顓犵＜闁绘劦鍓欓崝銈嗐亜椤撶姴鍘寸€殿喖顭烽弫鎰緞婵犲嫮鏉告俊鐐€栫敮濠囨倿閿曞倸纾块柟鎯у绾惧ジ鏌ｉ幇闈涘闁告柣鍊濋弻锝堢疀閺冨倻鐤勯梺绯曟櫇閸嬨倝鐛€ｎ喗鏅濋柍褜鍓涙竟鏇㈠礂閼测晝顔曢梺鐟邦嚟閸嬬喖骞婇崘顭嬪綊鎮╅锝嗙彋濠殿喖锕ュ浠嬪蓟閸涘瓨鍊烽柤鑹版硾椤忣參姊洪崨濞掝亪骞楀鍛潟闁圭儤顨嗛崵瀣⒒閸喓鈽夐柟鐣屾暬濮婅櫣绱掑Ο鍦箒闂佸摜濮靛畝鎼佸春閳ь剚銇勯幒鎴姛缂佸鏁婚弻娑㈡偐閹颁焦鐤侀悗娈垮枟瑜板啴鍩為幋鐘亾閿濆骸浜為柛妯绘崌閹嘲顭ㄩ崟顓犵厜閻庤娲樼划宀勫煡婢跺娼╂い鎺嗗亾闁诲繐锕娲礈閹绘帊绨介梺鍝ュТ濞村嘲鈻庨姀銈嗗€烽柣鎴烆焽閸樼敻姊绘笟鍥у伎缂佺姵鍨块悰顔碱潨閳ь剟寮诲☉妯滅喖骞愭惔顔筋棄闂備礁鐤囬～澶愬垂閸ф鏄ラ柕澶嗘櫅楠炪垺淇婇妶鍛殨闁告牗鐗犲缁樻媴閸涘﹤鏆堝銈庡幖濡繂鐣烽幆閭︽Ь濡炪倧瀵岄崳锝夊蓟閿濆棙鍎熸い鏍ㄧ矌鏍￠梻浣告啞閹歌崵绮欓幘瀵哥彾闁哄洢鍨洪崑鍌涱殽閻愰潧鏋庣紓宥咃躬瀵偊骞囬弶鍨獩濡炪倖鎸鹃崯姗€鍩￠崨顔尖偓鐢告偡濞嗗繐顏悘蹇ｅ幗娣囧﹪顢曢敐鍥╃杽閻庢鍠栭…鐑藉垂閹呮殾闁搞儯鍔嶉悾鐑芥⒒娓氣偓閳ь剛鍋涢懟顖涙櫠鐎电硶鍋撶憴鍕；闁告濞婇悰顔嘉熼崗鐓庣彴闂佽偐鈷堥崜娑樼暦鐠鸿　鏀介柣妯虹仛閺嗏晛鈹戦鑲╂憼閻庨潧銈搁弫鎰緞鐎ｎ亙绨婚梻浣告啞缁嬫垿鏁冮妶澶涚稏闁跨喓濮甸埛鎴︽煕濠靛棗顏存俊鑼额潐閵囧嫰骞嬮悙鍨櫑闁捐崵鍋炵换婵囩節閸屾粌顤€闂佹娊鏀辩敮锟犲蓟濞戞矮娌柟瑙勫姇椤ユ繈姊洪柅鐐茶嫰婢у瓨銇勯妷锔藉暗闁告帗甯″畷濂告偄閾忚鍤岄梻渚€鈧偛鑻晶鎾煟濞戝崬娅嶇€殿喕绮欓、妯款槼闁哄懏绻堝娲箰鎼淬埄姊垮┑鈽嗗亜鐎氼厾绮嬪澶嬬劶鐎广儱妫岄幏铏圭磽娓氬洤鐏℃繛鍙夌墬閺呭爼寮婚妷锔惧弰闂佸搫鍊归娆撳磿閺冨倵鍋撶憴鍕闁绘牕鍚嬫穱濠囧箹娴ｈ倽銊︺亜閺傚灝鎮戞い鏃€鎹囧濠氬磼濞嗘埈妲梺鍦拡閸嬪﹨妫熸繛鏉戝悑濞兼瑩宕归崒鐐寸厾缂佸娉曟禒娑氱磽瀹ュ懏鍠橀柡灞剧洴椤㈡洟鎮╅幓鎺戭潥闂備焦濞婇弨閬嶅垂閸︻厽顫曢柟鎯х摠婵挳鏌ゅù瀣⒉闁搞劌娼″畷鍝勨槈閵忕姷顔婂┑掳鍊撻懗鍫曞储閸楃偐鏀介柍钘夋閻忥絽鈹戦鑺ュ唉妤犵偛锕獮鍥敇閻橆偅鐏?
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

      // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻鐔兼⒒鐎靛壊妲紒鐐劤濞硷繝寮婚悢琛″亾閻㈡鐒剧€涙繄绱撴担鐣屽牚闁稿﹥绻堝濠氭晝閳ь剝鐏掓繛鎾村嚬閸ㄩ亶鏁嶉崱妞绘斀闁绘劕寮堕埢鏇灻瑰鍕疄鐎殿喗褰冮…銊╁醇閻斿搫骞楅梻渚€鈧稑宓嗘繛浣冲嫭娅犳い鏇楀亾妤犵偞鐗犲鍫曞箣椤栨繂鎯堟繝娈垮枛閿曘劌鈻嶉敐鍥у灊婵炲棙鍨跺畷澶愭煏婵炑冨€荤粈鍐⒒閸屾瑨鍏屾い顓炵墦椤㈡牠宕堕鈧壕濠氭煏閸繃鍣介柡鍡畵閺岀喐娼忛崜褏鏆犻柛銉ョ摠缁绘繈濮€閿濆棛銆愬銈嗗灥濞差厼鐣烽姀銈庢晜闁告侗鍨抽惁鍫ユ⒑濮瑰洤鐏叉繛浣冲嫮顩风憸鏃堝蓟濞戞埃鍋撻敐搴′簼閻忓浚鍙冮弻宥囨嫚閼碱儷褏鈧娲忛崝鎴︺€佸☉姗嗙叆闁告粌鍟版惔濠囨⒒閸屾瑧绐旈柍褜鍓涢崑娑㈡嚐椤栨稒娅犻悗鐢电《閸嬫挾鎲撮崟顒傤槬閻庤娲﹂崜鐔煎春閵夛箑绶炲┑鐐靛亾閻庡姊洪悷鎵憼缂佽鍊荤划濠氬Ψ閵夈垺鏂€闂佺粯锚閻忔岸寮抽埡鍛厱閻庯綆鍋嗗ú鎾煙椤斻劌娲ら獮銏＄箾閹寸偟鎳冮柍褜鍓濋崺鏍崲濠靛顥堟繛鎴濆船閸撲即姊洪崨濠傜仼濠电偐鍋撻梺鍝勬湰濞茬喎鐣烽悡搴樻斀闁搞儜灞稿亾濞戙垺鈷戠紓浣股戦悡銉︿繆椤愶絿绠炴鐐插暢閵囨劙骞掗幋婊呯倞闂備礁鎲″ú锕傚礈濮樿泛纾块柟鐐墯濞撳鏌曢崼婵囧櫤缂佸倸顑夐弻娑樷枎韫囨挻娈婚悗?
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

  // Poll evaluation import job progress (if any)
  useEffect(() => {
    if (!importJobId) {
      if (importPollerRef.current) {
        clearInterval(importPollerRef.current);
        importPollerRef.current = null;
      }
      return;
    }

    let canceled = false;
    let polling = false;

    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const job = await evaluationImportsApi.getJob(importJobId);
        if (canceled) return;
        setImportJob(job);

        if (job.status === 'completed' || job.status === 'failed') {
          if (importPollerRef.current) {
            clearInterval(importPollerRef.current);
            importPollerRef.current = null;
          }
          setImportJobId(null);

          if (job.status === 'completed' && job.resultEvaluationId) {
            evaluationCache.delete(job.resultEvaluationId);
            try {
              const detail = await evaluationsApi.getById(job.resultEvaluationId);
              setEvaluations((prev) => {
                const exists = prev.some((e) => e.id === detail.id);
                const next = exists
                  ? prev.map((e) => (e.id === detail.id ? (detail as EvaluationWithRelations) : e))
                  : [detail as EvaluationWithRelations, ...prev];
                updateListCache({ evaluations: next });
                return next;
              });
              setListMode('mine');
              selectEvaluation(detail as EvaluationWithRelations);
            } catch (e) {
              console.error('Failed to refresh evaluation after import:', e);
            }
            showToast('success', t('importCompleted'));
          } else if (job.status === 'failed') {
            showToast('error', t('importFailedWithReason', { reason: job.errorMessage || t('unknownError') }));
          }
        }
      } catch (error) {
        if (!canceled) {
          console.error('Failed to poll import job:', error);
        }
      } finally {
        polling = false;
      }
    };

    if (importPollerRef.current) {
      clearInterval(importPollerRef.current);
    }
    importPollerRef.current = setInterval(poll, 1000);
    void poll();

    return () => {
      canceled = true;
      if (importPollerRef.current) {
        clearInterval(importPollerRef.current);
        importPollerRef.current = null;
      }
    };
  }, [importJobId, selectEvaluation, showToast, t]);

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愮儤鍋嬮柣妯荤湽閳ь兛绶氬鎾閻橀潧骞堟繝娈垮枟閿曗晠宕㈡禒瀣︽繝闈涙閺€浠嬫⒔閸ヮ剙鏄ラ柡宓苯娈梺鍛婃处閸樻悂宕戦幘缁樻櫜閹煎瓨绻勯懗鍝勨攽閳ュ啿绾ч柛鏃€鐟ラ～蹇曠磼濡偐鎳濋梺閫炲苯澧い顓炴穿椤﹁泛顭胯缁诲牆顫忓ú顏勪紶闁告洦鍓欏▍銈夋⒑閻戔晜娅撻柛銊ョ埣閻涱喛绠涘☉妯碱吅闂佹寧妫佸Λ鍕濠婂牊鐓熼煫鍥ㄦ尵缁狅綁鏌ｉ幒鐐电暤鐎殿噮鍓熼崺鈧い鎺戝閳锋帒霉閿濆牊顏犻悽顖涚洴閹锋垶娼忛埡鍌氭瀾闂佸搫顦悘婵嬪汲閿濆棎浜滈柕蹇婂墲椤ュ牊銇勯姀鈩冪濠碘€崇埣瀹曞爼鈥﹂幒鏃傤攨闂傚倸鍊风粈渚€骞夐敓鐘冲仭闁挎繂顦壕鍧楁煙閹澘袚闁稿孩顨嗙换娑㈠幢濡闉嶉梺缁樻尰缁嬫捇鍩€椤掆偓閸樻粓宕戦幘缁樼厓鐟滄粓宕滈悢椋庢殾濞村吋娼欓崘鈧銈嗘尵婵绮婇敃鍌涒拺缂侇垱娲栨晶鏌ユ煕閹寸姵鍤€閸楀崬螖閿濆懎鏆為柍閿嬪灴閺岀喓绮欓幐搴㈠闯闂佸疇妫勯ˇ杈╂閹烘挸绶炲┑鐘插妤旈柣搴㈩問閸犳牠鈥﹂悜钘夌畺闁靛繈鍊曠粈鍌炴煟閹惧磭鍑归柟顕嗙秮濮婅櫣鎷犻懠顒傤唺闂佺顑囨慨楣冦€傛ィ鍐┾拺闁告繂瀚烽崕蹇涙煙閾忣個顏堬綖韫囨拋娲敂閸曨亞鐐婇梻浣告啞濞诧箓宕㈡ィ鍐ㄧ闁革富鍘剧壕浠嬫煕鐏炵偓鐨戠亸蹇涙⒑缂佹ê閲滈梻鍕缁碍娼忛妸褏鐦堥梺鎼炲劀閸滀礁鏅ｆ繝鐢靛仩閹活亞绱為埀顒勬煕婵犱胶鐭欏┑鈩冩倐閸╋繝宕掑鍐ㄥ婵犵數濮伴崹濂稿春閺嶎厽鏅梻浣告惈椤戝棝鎮疯濡叉劙骞掗幘瀵哥Ф闂侀潧顭粻鎴﹀汲濡ゅ啰纾藉ù锝勭矙閸濇椽鏌熼悷鐗堟悙闁伙絿鍏橀獮鎺楀箣閺冣偓閻庡姊虹憴鍕剹闁告ê鈧啿鍙烘繝鐢靛Х閺佸憡鎱ㄩ銏犵闁告劦鍠栫粈鍐┿亜閺冨倸甯堕柛娆忥躬閺岋絾鎯旈妶搴㈢秷濠电偛寮堕崹鍨暦閿熺姴绀冪€瑰壊鍠栧▓銊╂⒑缁嬪尅鍔熼柛锝冨劚鍗卞Δ锝呭暞閳锋垿鏌涘┑鍡楊仾闁挎稒妫冨濠氬礋椤愩埄浼€闂佺懓绠嶉崹褰掑煘閹寸姭鍋撻敐搴′航婵☆偄鍟埞鎴︽倷閺夋垹浠撮悗瑙勬处閸撶喎鐣峰鍕嚤閻庢稒菤閹疯櫣绱撻崒娆戝妽閽冮亶鎮樿箛鏂款棆缂佽鲸甯為埀顒婄秵閸嬪嫰鎮樼€涙绡€闁逞屽墯缁楃喖鍩€椤掆偓椤繐煤椤忓嫮顔囬柟鑹版彧缁插潡鎮鹃悽鍛娾拺闁荤喐婢橀弳杈╃磼缂佹◤顏堟偩閻戠瓔鏁嶉柣鎰綑閳ь剛鍏橀弻锝夊箣閻戝棛鍔烽梺鍛娒肩划娆忣潖濞差亜绠伴幖娣焺濮婂潡姊虹粙娆惧剱闁告梹顨堥崚鎺楀籍閸偅鏅╅梺鍏间航閸庡崬顕?
  const updateEvaluationCache = (evaluationId: string, updates: Partial<EvaluationCacheData>) => {
    const cached = evaluationCache.get(evaluationId);
    if (cached) {
      evaluationCache.set(evaluationId, { ...cached, ...updates });
    }
  };

  const clearEvaluationCache = (evaluationId: string) => {
    evaluationCache.delete(evaluationId);
  };

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愮儤鍋嬮柣妯荤湽閳ь兛绶氬鎾閻橀潧骞堟繝娈垮枟閿曗晠宕㈡禒瀣︽繝闈涙閺€浠嬫⒔閸ヮ剙鏄ラ柡宓苯娈梺鍛婃处閸樻悂宕戦幘缁樻櫜閹煎瓨绻勯懗鍝勨攽閳ュ啿绾ч柛鏃€鐟ラ～蹇曠磼濡偐鎳濋梺閫炲苯澧い顓炴穿椤﹁泛顭胯缁诲牆顫忓ú顏勪紶闁告洦鍓欏▍銈夋⒑閻戔晜娅撻柛銊ョ埣閻涱喛绠涘☉妯碱吅闂佹寧妫佸Λ鍕濠婂牊鐓熼煫鍥ㄦ尵缁狅綁鏌ｉ幒鐐电暤鐎殿噮鍓熼崺鈧い鎺戝閳锋帒霉閿濆牊顏犻悽顖涚洴閺屻劌顫濋幍浣镐壕婵炲牆鐏濋弸娑㈡煟閺嵮佸仮闁绘侗鍣ｅ浠嬵敇閻愮數鏉告俊鐐€栭弻銊︽櫠娴犲鏅繝濠傜墛閳锋垿姊洪銈呬粶闁兼椿鍨遍弲鍓佲偓鐢电《閸嬫挾鎲撮崟顒傤槬閻庤娲﹂崜婵嬫倶閹烘鈷戦梻鍫氭櫅閻︽粓鏌涘鈧粻鏍箖閻愵兙鍋呴柛鎰ㄦ杹閹风粯绻涢幘鏉戠劰闁稿鎸荤换娑欐媴閸愬弶澶勯柛瀣儔閺屾盯鍩勯崘顏佹缂備胶濮锋繛鈧鐐寸墵楠炴牠顢橀悩鎻掑紬闂備浇妗ㄧ粈渚€宕愰崸妤€钃熼柡鍥╁枎缁剁偤鏌涢埄鍏╂垿鎮甸弴銏♀拺缂備焦蓱鐏忣參鏌涢悢璺哄祮妤犵偛顦辩划娆忊枎閸撗冨汲闂備礁澹婇崑鍛崲閸曨垁鍥敇閻愨晜鏂€闂佺粯鍔曞鍫曀夐悙鐑樼厵闁告稑锕ラ崐鎰版煙椤斿吋鍋ユい銏″哺閸┾偓妞ゆ帒瀚拑鐔兼煟閺傝法娈遍柡瀣閺屾盯鈥﹂幋婵囩亶闂佽绻愮粔鎾€旈崘顔嘉ч幖绮光偓鑼嚬婵犵數鍋犵亸娆撳窗閺嵮屽殨濠电姵纰嶉崑鍕煟閹捐櫕鎹ｆい鏂款樀濮婃椽鏌呭☉妯虹ギ濠电偘鍖犻崘锝嗙亖濡炪倖鎸炬慨椋庡閽樺褰掓晲閸涱喗鍎撻梻澶婎儔閹鎲撮崟顒傤槶闂佽桨绀侀…宄扮暦濞差亜鐒垫い鎺嶉檷娴滄粓鏌熼悜妯虹仴闁哄鍊栫换娑㈠礂閻撳骸顫嶇紓浣虹帛閻╊垰鐣烽敐鍡楃窞閻忕偠袙閸氬倿姊虹紒妯诲蔼闁稿﹥绻堝濠氬Ω閳轰礁宓嗛梺缁樺姈缁佹挳宕戦幘璇蹭紶闁靛／鍌滅憹?
  const updateListCache = (updates: Partial<ListCache>) => {
    if (listCache) {
      listCache = { ...listCache, ...updates };
    }
  };

  const handleRefreshPromptOptions = async () => {
    if (refreshingPromptOptions) return;
    setRefreshingPromptOptions(true);
    try {
      const [promptsData, promptGroupsData] = await Promise.all([
        promptsApi.list(),
        promptGroupsApi.list(),
      ]);

      const latestPrompts = (promptsData || []) as Prompt[];
      const latestPromptGroups = (promptGroupsData || []) as PromptGroup[];

      setPrompts(latestPrompts);
      setPromptGroups(latestPromptGroups);
      updateListCache({ prompts: latestPrompts, promptGroups: latestPromptGroups });
    } catch (error) {
      console.error('Failed to refresh prompt options:', error);
      showToast('error', t('updateFailed'));
    } finally {
      setRefreshingPromptOptions(false);
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

  const toAnalysisPromptContext = (
    snapshot: PromptSnapshot | null,
    meta: { promptId?: string | null; promptName?: string | null; promptVersion?: number | null }
  ): AnalysisPromptContext | null => {
    if (!snapshot) return null;
    const template = getPromptTemplate(snapshot);
    const messages = Array.isArray(snapshot.messages)
      ? snapshot.messages.map((item) => ({
          role: item.role,
          content: item.content,
        }))
      : [];
    return {
      promptId: meta.promptId ?? null,
      promptName: meta.promptName ?? null,
      promptVersion: typeof meta.promptVersion === 'number' ? meta.promptVersion : null,
      template,
      messages,
      config: snapshot.config ? (snapshot.config as Record<string, unknown>) : null,
    };
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
    top_p: resolveTopP(config?.top_p),
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
      return {
        ...config.model_parameters,
        top_p: resolveTopP(config.model_parameters.top_p),
      };
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

  const openImportModal = () => {
    const defaultTarget =
      selectedEvaluation && currentUserId && selectedEvaluation.userId === currentUserId
        ? selectedEvaluation.id
        : evaluations.find((e) => currentUserId && e.userId === currentUserId)?.id || '';

    setImportMode('create');
    setImportTargetEvaluationId(defaultTarget);
    setImportZipFile(null);
    setImportJobId(null);
    setImportJob(null);
    setShowImportEval(true);
  };

  const handleDownloadImportTemplate = async () => {
    setImportTemplateDownloading(true);
    try {
      const blob = await evaluationImportsApi.downloadTemplateZip({ lang: i18n.language || 'en' });
      downloadBlobFile('evaluation_import_template.zip', blob);
      showToast('success', t('importTemplateDownloaded'));
    } catch (e) {
      showToast('error', t('importTemplateDownloadFailed', { error: getErrorMessage(e) }));
    } finally {
      setImportTemplateDownloading(false);
    }
  };

  const handleExportEvaluationSet = async () => {
    if (!selectedEvaluation) return;

    setExportEvaluationSetLoading(true);
    try {
      const blob = await evaluationImportsApi.exportEvaluationZip(selectedEvaluation.id, {
        includeAttachments: true,
        lang: i18n.language || 'en',
      });
      const safeEvalName = sanitizeFilenamePart(selectedEvaluation.name, 'evaluation');
      const exportTimestamp = formatTimestampForFilename(new Date());
      downloadBlobFile(`${safeEvalName}_import_export_${exportTimestamp}.zip`, blob);
      showToast('success', t('exportEvaluationSetSuccess'));
    } catch (e) {
      showToast('error', t('exportEvaluationSetFailed', { error: getErrorMessage(e) }));
    } finally {
      setExportEvaluationSetLoading(false);
    }
  };

  const handleStartZipImport = async () => {
    if (!importZipFile) {
      showToast('error', t('importZipRequired'));
      return;
    }

    if (importMode !== 'create' && !importTargetEvaluationId) {
      showToast('error', t('importTargetRequired'));
      return;
    }

    setImportSubmitting(true);
    try {
      const { jobId } = await evaluationImportsApi.createZip(importZipFile, {
        mode: importMode,
        targetEvaluationId: importMode === 'create' ? undefined : importTargetEvaluationId,
      });
      setImportJobId(jobId);
      setImportJob(null);
      showToast('success', t('importSubmitted'));
    } catch (e) {
      showToast('error', t('importStartFailed', { error: getErrorMessage(e) }));
    } finally {
      setImportSubmitting(false);
    }
  };

  const handleAddTestCase = async (): Promise<TestCase | null> => {
    if (!selectedEvaluation) return null;

    try {
      // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕閵堝懎顏柡灞剧洴椤㈡洟鏁愰崱娆欑穿闂備線鈧偛鑻晶鍓х磼閻樿櫕灏柣锝夋敱缁虹晫绮欏▎鐐秱闂備胶鍋ㄩ崕閬嶅疮鐠恒劏濮抽柕澶嗘櫆閳锋帒霉閿濆洨鎽傛繛鍏煎姇椤潡鎮烽悧鍫！闂佸搫鎳撳▔娑滅亙闂佸憡渚楅崢楣冩晬濞戙垺鐓熼幖鎼灣缁夌敻鏌涢悩鎰佹疁闁诡喒鈧枼鏋庨柟鎯ь嚟閸橀潧鈹戦悙鑼闁诲繑绻堝绋库槈濞嗗秳绨婚梺鎸庣箓閹冲矂宕戦姀銈嗙厸閻忕偛澧介埊鏇㈡煙椤栨稒顥堥柡浣哥Ч瀹曠喖骞婂畡鐗堝闁绘挻绋撻埀顒€鍘滈崑鎾绘倵閿濆骸澧扮悮锕傛煟鎼淬埄鍟忛柛锝庡櫍瀹曟粓鎮㈡搴㈡閻熸粎澧楃敮鈺呭极婵犲洦鐓㈡俊顖欒濡叉挳鏌涚€ｎ偅宕屾い銏＄洴閹瑧鍒掔憴鍕伖?API 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎悗骞垮劚椤︻垳绮堢€ｎ偁浜滈柟鍝勭Ф閸斿秵銇勯弬鎸庡缂佺粯绻傞銉╂煥鐎ｎ偆鍑￠梺閫炲苯澧繛鑼枎閻ｇ兘顢涘☉姗嗗殼闁诲孩绋掗敋闁告挾鎳撻埞鎴︽倷閸欏妫￠梺鍦焾椤兘骞冮垾鏂ユ瀻闁圭偓娼欓埀顒傛暬閺岋綁濮€閳藉棗鏅遍梺缁樺浮缁犳牕鐣烽鐐蹭紶闁靛／鍜冪床闂備浇顕栭崹搴ㄥ礃椤忓棌妫ㄧ紓鍌氬€风欢锟犲窗濡ゅ懏鍋￠柍杞扮贰閸ゆ洖鈹戦悩宕囶暡闁稿瀚伴弻锝夊箻閾忣偅宕冲銈嗘煥椤﹂潧顫忔ウ瑁や汗闁圭儤鍨抽崰濠囨⒑閸濄儱鏆遍柡鍛洴閳ワ箓濡搁埡渚€鍞堕梺缁樻煥閹碱偊鐛崼銉︹拻濞达絿鎳撻婊勪繆椤愶紕绐旀い銏′亢椤﹀綊鏌ｅ☉鍗炴珝妤犵偛娲幃褔宕奸姀鐘茬疄闂備浇顕ч崙鐣岀礊閸℃稑纾婚柛娑卞幘閺嗭妇鈧厜鍋撻柛鏇ㄥ墰閸樺憡绻涙潏鍓ф偧闁硅櫕鎸婚幈銊╁醇閵夛妇鍘靛銈嗙墬缁嬫帡藟閸儲鐓曢柕濠忕畱閸斻倝鏌ｉ敐鍥у幋鐎规洖澧庨幑鍕倻濡崵褰ｅ┑鐘垫暩婵兘寮崨濠冨弿闁绘垵顫曢埀顒€鍊圭粋鎺斺偓锝庝簽閸旓箑顪冮妶鍡楀潑闁稿鎹囬弻娑㈡偄缂佹銆婇梺姹囧労娴滐綁藝瑜版帗鐓涚€光偓閳ь剟宕伴弽顓溾偓浣糕枎閹炬潙浜楅柟鐓庣摠閿氬ù婊堢畺閺屾盯鈥﹂幋婵囩彯闂佹悶鍊栧ú鏍煘閹达附鍋愮€规洖娴傞弳锟犳⒑閸濆嫭鍣虹憸鏉垮暣閳ワ箓宕稿Δ浣告疂闂佹眹鍨婚崑锝夊焵椤掍礁绗х紒杈ㄥ笧閳ь剨缍嗘禍鐐电不閻楀牄浜滄い蹇撳閺嗭絽鈹戦垾宕囧煟鐎规洖宕灃闁逞屽墮椤洭骞嬮敂瑙ｆ嫼缂備礁顑嗛娆撳磿閹扮増鐓欓柛娑橈攻閸婃劙鏌涢埡鍐ㄤ槐妤犵偛顑夐弫鍌滅驳鐎Ｑ冧壕闁归偊鍏橀弨浠嬫煟閹邦剙绾ч悗姘噽缁辨帡骞撻幒鏂捐檸闁?
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

    // 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚敐澶婄闁挎繂鎲涢幘缁樼厱濠电姴鍊归崑銉╂煛鐏炶濮傜€殿喗鎸抽幃娆徝圭€ｎ亙澹曢梺褰掓？閻掞妇鈧艾鎳橀弻锝夊棘閸喗鍊梺缁樻尭缁绘劙鍩為幋锔藉€烽梻鍫熺◥婢规洖鈹戦悙鍙夊櫤闁圭懓娲濠氬焺閸愨晛顎撶紓浣割儐椤戞瑦瀵奸崘顔解拺闁告繂瀚﹢鎵磼鐎ｎ偄鐏撮柛鈹垮劜瀵板嫰骞囬鍌ゆ敤闂備胶绮崝妯间焊濞嗘搩鏁婇柟鐑橆殕閳锋帒霉閿濆懏鍟為柟顖氱墛娣囧﹪顢曢姀銈呭及閻庤娲橀崝鏇㈠煘閹寸姭鍋撻敐搴濇捣闁硅姤娲栭埞鎴︽倷閺夋垹浠ч梺鎼炲妼缂嶅﹪骞冮悙瑁佹椽顢旈崨顖氬箞闂備礁缍婇崑濠囧礈濞嗘挸鐓曢柡鍐ㄧ墛閻撴洟鏌￠崘銊モ偓鎼佸储鐎涙ɑ鍙忓┑鐘插€归幆鍫ユ煟閿濆洤鍘寸€规洖鐖兼俊鎼佸Ψ閿旂偓娈紓鍌氬€搁崐椋庣矆娓氣偓钘濋梺顒€绉撮弸渚€鏌熼梻瀵割槮缂佺姵鐓￠弻鏇＄疀閺囩倫娑㈡煛閳ь剚绂掔€ｎ偄鈧敻鏌ㄥ┑鍡涱€楀ù婊嗗Г娣囧﹪顢曢姀鐘虫闂佸疇顫夐崹鍧楀箖濞嗘挸绾ч柟瀵稿С濡楁捇姊绘担钘夊惞闁革絻鍎靛畷褰掑箯瀹€鈧禍閬嶆⒒娓氣偓濞佳囨偋閸℃蛋鍥ㄥ閺夋垹鍘遍梺纭呮彧闂勫嫰鎮￠弴銏＄叆闁哄啫娴傞崵娆愵殽閻愭惌娈曠紒缁樼洴瀹曘劑顢欓悾宀婃К闂備礁鐤囬～澶愬垂閸ф绠栨繛鍡樻尭閻撴稑霉閿濆懎妲绘い銉﹀哺濮婂宕掑顑藉亾妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇㈡晝閳ь剛鈧艾顦伴妵鍕箳閹存繍浠鹃梺绋块鐎涒晠濡甸崟顖氬唨妞ゆ劦婢€閹寸兘鎮楃憴鍕矮缂佽埖宀稿濠氭偄閸忕厧鈧粯鎱ㄥΔ鈧Λ娆撴偩鐠鸿　鏀介柍钘夋娴滄繈鎷戞潏鈺冪＜缂備焦顭囧ú瀵糕偓瑙勬礀瀹曨剟鍩㈡惔銈囩杸閹肩补妲呭Λ婊冣攽閻樻剚鍟忛柛锝庡灣瀵板﹥绂掔€ｅ骸娲Λ鍐ㄢ槈鏉堛劎绋佺紓鍌氬€烽悞锕佹懌婵犳鍨遍幐鎶藉蓟濞戞ǚ妲堟慨妤€鐗婇弫楣冩⒑缁嬪灝顒㈤柟鍛婃倐閸╃偤骞嬮敃鈧悡锟犳煕閳╁啨浠︾紒銊ャ偢濮婃椽鎮滈埡鍌涚彟闂佹悶鍔嬮崡鎶藉箖妤ｅ啯鐓ラ悗锝庝憾閸ゃ倝姊洪崫鍕垫Ч闁搞劎鏁诲畷顒勫Ω閵夘喗瀵岄梺闈涚墕濡瑧浜搁棃娑掓斀妞ゆ梻鈷堥崵鐔虹磼椤旂》韬柡浣稿暣瀹曟帒鈽夐幒鎾愁伖缂傚倷鑳堕搹搴ㄥ储婵傜绠犻煫鍥ㄥ搸娴滃湱鎲搁弮鍫濈畺婵°倕鎳忛ˉ鍫熺箾閹寸偞鐨戦柛鏃戝灦閹鈻撻崹顔界彯闂佺顑呴幊鎰板箲閵忕姭鏀介悗锝庝簽閸婄偤姊洪棃娴ゆ盯宕橀妸褜鍟嬪┑鐘垫暩婵兘寮幖浣哥；闁绘劕妯婇悞鑺ョ箾閸℃ɑ鎯勯柡浣稿閺屾盯鍩勯崘锔跨捕闂佸搫顑呯粔褰掑蓟濞戙垹鐒洪柛鎰典簴婵洭姊?
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

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕閵堝懎顏柡灞剧洴椤㈡洟鏁愰崱娆欑穿闂備線鈧偛鑻晶鍓х磼閻樿櫕灏柣锝夋敱缁虹晫绮欏▎鐐秱闂備胶鍋ㄩ崕閬嶅疮鐠恒劏濮抽柕澶嗘櫆閳锋帒霉閿濆洨鎽傛繛鍏煎姇椤潡鎮烽悧鍫！闂佸搫鎳撳▔娑滅亙闂佸憡渚楅崢楣冩晬濞戙垺鐓熼幖鎼灣缁夌敻鏌涢悩鎰佹疁闁诡喒鈧枼鏋庨柟鎯ь嚟閸橀潧鈹戦悙鑼闁诲繑绻堝绋库槈濞嗗秳绨婚梺鎸庣箓閹冲矂宕戦姀銈嗙厸閻忕偛澧介埊鏇㈡煙椤栨稒顥堥柡浣哥Ч瀹曠喖骞婂畡鐗堝闁绘挻绋撻埀顒€鍘滈崑鎾绘倵閿濆骸澧扮悮锕傛煟鎼淬埄鍟忛柛锝庡櫍瀹曟粓鎮㈡搴㈡閻熸粎澧楃敮鈺呭极婵犲洦鐓㈡俊顖欒濡叉挳鏌涚€ｎ偅宕屾い銏＄洴閹瑧鍒掔憴鍕伖?API 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎悗骞垮劚椤︻垳绮堢€ｎ偁浜滈柟鍝勭Ф閸斿秵銇勯弬鎸庡枠婵﹦绮幏鍛存惞閻熸壆顐奸梻浣告啞濮婄懓煤閻旂鈧礁顫濇０婵囨櫍闂佺粯锚閸氣偓缂佹顦版穱濠囧Χ韫囨洖鍩岄梺鍝ュ櫏閸ㄥ爼骞冮敓鐘茬妞ゅ繐鎳庨弸鎴濃攽閻樿宸ラ柣妤€妫涚划鍫ュ醇閻旂寮垮┑鈽嗗灠濞硷繝宕搹鍏夊亾?
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
      // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕閵堝懎顏柡灞剧洴椤㈡洟鏁愰崱娆欑穿闂備線鈧偛鑻晶鍓х磼閻樿櫕灏柣锝夋敱缁虹晫绮欏▎鐐秱闂備胶鍋ㄩ崕閬嶅疮鐠恒劏濮抽柕澶嗘櫆閳锋帒霉閿濆洨鎽傛繛鍏煎姇椤潡鎮烽悧鍫！闂佸搫鎳撳▔娑滅亙闂佸憡渚楅崢楣冩晬濞戙垺鐓熼幖鎼灣缁夌敻鏌涢悩鎰佹疁闁诡喒鈧枼鏋庨柟鎯ь嚟閸橀潧鈹戦悙鑼闁诲繑绻堝绋库槈濞嗗秳绨婚梺鎸庣箓閹冲矂宕戦姀銈嗙厸閻忕偛澧介埊鏇㈡煙椤栨稒顥堥柡浣哥Ч瀹曠喖骞婂畡鐗堝闁绘挻绋撻埀顒€鍘滈崑鎾绘倵閿濆骸澧扮悮锕傛煟鎼淬埄鍟忛柛锝庡櫍瀹曟粓鎮㈡搴㈡閻熸粎澧楃敮鈺呭极婵犲洦鐓㈡俊顖欒濡叉挳鏌涚€ｎ偅宕屾い銏＄洴閹瑧鍒掔憴鍕伖?API 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎悗骞垮劚椤︻垳绮堢€ｎ偁浜滈柟鍝勭Ф閸斿秵銇勯弬鎸庡缂佺粯绻傞銉╂煥鐎ｎ偆鍑￠梺閫炲苯澧繛鑼枎閻ｇ兘顢涘☉姗嗗殼闁诲孩绋掗敋闁告挾鎳撻埞鎴︽倷閸欏妫￠梺鍦焾椤兘骞冮垾鏂ユ瀻闁圭偓娼欓埀顒傛暬閺岋綁濮€閳藉棗鏅遍梺缁樺浮缁犳牕鐣烽鐐蹭紶闁靛／鍜冪床闂備浇顕栭崹搴ㄥ礃椤忓棌妫ㄧ紓鍌氬€风欢锟犲窗濡ゅ懏鍋￠柍杞扮贰閸ゆ洖鈹戦悩宕囶暡闁稿瀚伴弻锝夊箻閾忣偅宕冲銈嗘煥椤﹂潧顫忔ウ瑁や汗闁圭儤鍨抽崰濠囨⒑閸涘﹥灏伴柣鈺婂灠閻ｇ兘濮€閵堝孩鏅濋梺鎸庢⒒閺咁偊宕㈡禒瀣厵闁稿繗鍋愰弳姗€鏌涢妸銉吋闁靛棗鍊块幊鐘活敄閽樺澹曢梺绋跨箰椤︻垱绂嶆ィ鍐┾拺鐟滅増甯楅敍鐔虹磼閳ь剚绗熼埀顒勫箯閹达附鍋勯柛婵勫劤椤旀洟姊洪悷鎵憼闁荤喆鍎甸幃姗€鍩￠崨顔惧幈濠德板€撶粈渚€鍩㈤弴銏＄厸閻忕偟鍋撶粈鍐磼缂佹娲寸€规洖缍婇、娆撴偂鎼搭喗缍撴繝纰夌磿閸嬫垿宕愰妶澶婄；闁圭儤顨呯壕璇测攽閻樻彃浜炴繛鍏肩墬缁绘稑顔忛鑽ゅ嚬濡炪們鍎遍悧濠勬崲濞戙垹绠ｉ柣鎰硾椤ユ繂顪冮妶鍐ㄢ偓鎰板磻閹剧粯鈷掗柛灞剧懆閸忓矂鏌熼搹顐ｅ磳妤犵偛顦甸崺鍕礃椤忓棭鍟庡┑鐘垫暩婵挳宕戦崱娑樺惞闁哄洨鍋愰弨浠嬫煟濡櫣鏋冨瑙勶耿閺岋綀绠涢弬搴撴灆闂佸搫鐬奸崰鎰版晬閹邦厽濯村〒姘煎灡琚﹂梻鍌欐祰椤曟牠宕板Δ鍛瀭闁割煈鍣鏍ㄧ箾瀹割喕绨荤€瑰憡绻傞埞鎴︽偐鏉堫偄鍘＄紓浣筋唺缁舵艾顫忓ú顏勪紶闁靛鍎涢敐鍡愪簻闁靛鍎婚煬顒勬煟濞戝崬娅嶇€规洘锕㈡俊鎼佸閿涘嫧鍋撴繝姘拺闁荤喐婢橀埛鏃堟偠濞戞牕鍔︽?
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

    // 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚敐澶婄闁挎繂鎲涢幘缁樼厱濠电姴鍊归崑銉╂煛鐏炶濮傜€殿喗鎸抽幃娆徝圭€ｎ亙澹曢梺褰掓？閻掞妇鈧艾鎳橀弻锝夊棘閸喗鍊梺缁樻尭缁绘劙鍩為幋锔藉€烽梻鍫熺◥婢规洖鈹戦悙鍙夊櫤闁圭懓娲濠氬焺閸愨晛顎撶紓浣割儐椤戞瑦瀵奸崘顔解拺闁告繂瀚﹢鎵磼鐎ｎ偄鐏撮柛鈹垮劜瀵板嫰骞囬鍌ゆ敤闂備胶绮崝妯间焊濞嗘搩鏁婇柟鐑橆殕閳锋帒霉閿濆懏鍟為柟顖氱墛娣囧﹪顢曢姀銈呭及閻庤娲橀崝鏇㈠煘閹寸姭鍋撻敐搴濇捣闁硅姤娲栭埞鎴︽倷閺夋垹浠ч梺鎼炲妼缂嶅﹪骞冮悙瑁佹椽顢旈崨顖氬箞闂備礁缍婇崑濠囧礈濞嗘挸鐓曢柡鍐ㄧ墛閻撴洟鏌￠崘銊モ偓鎼佸储鐎涙ɑ鍙忓┑鐘插€归幆鍫ユ煟閿濆洤鍘寸€规洖鐖兼俊鎼佸Ψ閿旂偓娈紓鍌氬€搁崐椋庣矆娓氣偓钘濋梺顒€绉撮弸渚€鏌熼梻瀵割槮缂佺姵鐓￠弻鏇＄疀閺囩倫娑㈡煛閳ь剚绂掔€ｎ偄鈧敻鏌ㄥ┑鍡涱€楀ù婊嗗Г娣囧﹪顢曢姀鐘虫闂佸疇顫夐崹鍧楀箖濞嗘挸绾ч柟瀵稿С濡楁捇姊绘担钘夊惞闁革絻鍎靛畷褰掑箯瀹€鈧禍閬嶆⒒娓氣偓濞佳囨偋閸℃蛋鍥ㄥ閺夋垹鍘遍梺纭呮彧闂勫嫰鎮￠弴銏＄叆闁哄啫娴傞崵娆愵殽閻愭惌娈曠紒缁樼洴瀹曘劑顢欓悾宀婃К闂備礁鐤囬～澶愬垂閸ф绠栨繛鍡樻尭閻撴稑霉閿濆懎妲绘い銉﹀哺濮婂宕掑顑藉亾妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇㈡晝閳ь剛鈧艾顦伴妵鍕箳閹存繍浠鹃梺绋块鐎涒晠濡甸崟顖氬唨妞ゆ劦婢€閹寸兘鎮楃憴鍕矮缂佽埖宀稿濠氭偄閸忕厧鈧粯鎱ㄥΔ鈧Λ娆撴偩鐠鸿　鏀介柍钘夋娴滄繈鎷戞潏鈺冪＜缂備焦顭囧ú瀵糕偓瑙勬礀瀹曨剟鍩㈡惔銈囩杸閹肩补妲呭Λ婊冣攽閻樻剚鍟忛柛锝庡灣瀵板﹥绂掔€ｅ骸娲Λ鍐ㄢ槈鏉堛劎绋佺紓鍌氬€烽悞锕佹懌婵犳鍨遍幐鎶藉蓟濞戞ǚ妲堟慨妤€鐗婇弫楣冩⒑缁嬪灝顒㈤柟鍛婃倐閸╃偤骞嬮敃鈧悡锟犳煕閳╁啨浠︾紒銊ャ偢濮婃椽鎮滈埡鍌涚彟闂佹悶鍔嬮崡鎶藉箖妤ｅ啯鐓ラ悗锝庝憾閸ゃ倝姊洪崫鍕垫Ч闁搞劎鏁诲畷顒勫Ω閵夘喗瀵岄梺闈涚墕濡瑧浜搁棃娑掓斀妞ゆ梻鈷堥崵鐔虹磼椤旂》韬柡浣稿暣瀹曟帒鈽夐幒鎾愁伖缂傚倷鑳堕搹搴ㄥ储婵傜绠犻煫鍥ㄥ搸娴滃湱鎲搁弮鍫濈畺婵°倕鎳忛ˉ鍫熺箾閹寸偞鐨戦柛鏃戝灦閹鈻撻崹顔界彯闂佺顑呴幊鎰板箲閵忕姭鏀介悗锝庝簽閸婄偤姊洪棃娴ゆ盯宕橀妸褜鍟嬪┑鐘垫暩婵兘寮幖浣哥；闁绘劕妯婇悞鑺ョ箾閸℃ɑ鎯勯柡浣稿閺屾盯鍩勯崘锔跨捕闂佸搫顑呯粔褰掑蓟濞戙垹鐒洪柛鎰典簴婵洭姊?
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

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕閵堝懎顏柡灞剧洴椤㈡洟鏁愰崱娆欑穿闂備線鈧偛鑻晶鍓х磼閻樿櫕灏柣锝夋敱缁虹晫绮欏▎鐐秱闂備胶鍋ㄩ崕閬嶅疮鐠恒劏濮抽柕澶嗘櫆閳锋帒霉閿濆洨鎽傛繛鍏煎姇椤潡鎮烽悧鍫！闂佸搫鎳撳▔娑滅亙闂佸憡渚楅崢楣冩晬濞戙垺鐓熼幖鎼灣缁夌敻鏌涢悩鎰佹疁闁诡喒鈧枼鏋庨柟鎯ь嚟閸橀潧鈹戦悙鑼闁诲繑绻堝绋库槈濞嗗秳绨婚梺鎸庣箓閹冲矂宕戦姀銈嗙厸閻忕偛澧介埊鏇㈡煙椤栨稒顥堥柡浣哥Ч瀹曠喖骞婂畡鐗堝闁绘挻绋撻埀顒€鍘滈崑鎾绘倵閿濆骸澧扮悮锕傛煟鎼淬埄鍟忛柛锝庡櫍瀹曟粓鎮㈡搴㈡閻熸粎澧楃敮鈺呭极婵犲洦鐓㈡俊顖欒濡叉挳鏌涚€ｎ偅宕屾い銏＄洴閹瑧鍒掔憴鍕伖?API 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎悗骞垮劚椤︻垳绮堢€ｎ偁浜滈柟鍝勭Ф閸斿秵銇勯弬鎸庡枠婵﹦绮幏鍛存惞閻熸壆顐奸梻浣告啞濮婄懓煤閻旂鈧礁顫濇０婵囨櫍闂佺粯锚閸氣偓缂佹顦版穱濠囧Χ韫囨洖鍩岄梺鍝ュ櫏閸ㄥ爼骞冮敓鐘茬妞ゅ繐鎳庨弸鎴濃攽閻樿宸ラ柣妤€妫涚划鍫ュ醇閻旂寮垮┑鈽嗗灠濞硷繝宕搹鍏夊亾?
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

  const getRunDisplayTitle = useCallback((run: EvaluationRun | null | undefined): string => {
    if (!run) return '';
    const customTitle = run.title?.trim();
    if (customTitle) return customTitle;
    return formatDateTime(run.startedAt ?? run.createdAt);
  }, []);

  const handleUpdateRunTitle = async (runId: string, title: string | null) => {
    if (!selectedEvaluation) return;
    if (updatingRunTitleId) return;

    setUpdatingRunTitleId(runId);
    try {
      const updatedRun = await runsApi.update(runId, { title });
      setRuns((prev) => {
        const next = prev.map((run) => (run.id === runId ? updatedRun : run));
        const cached = evaluationCache.get(selectedEvaluation.id);
        if (cached) {
          evaluationCache.set(selectedEvaluation.id, { ...cached, runs: next });
        }
        return next;
      });
      setSelectedRun((prev) => (prev?.id === runId ? updatedRun : prev));
    } catch (error) {
      showToast('error', getErrorMessage(error));
      throw error;
    } finally {
      setUpdatingRunTitleId((prev) => (prev === runId ? null : prev));
    }
  };

  useEffect(() => {
    const routeRunId = evaluationRouteState.runId;
    if (!routeRunId || !selectedEvaluation) return;
    const targetRun = runs.find((run) => run.id === routeRunId);
    if (!targetRun) return;
    if (selectedRun?.id === targetRun.id) return;

    let canceled = false;
    (async () => {
      try {
        const resultsData = await runsApi.getResults(targetRun.id);
        if (canceled) return;
        setSelectedRun(targetRun);
        setResults(resultsData);
        updateEvaluationCache(selectedEvaluation.id, { results: resultsData, selectedRunId: targetRun.id });
        setActiveTab('results');
      } catch (error) {
        console.error('Failed to locate run by route:', error);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [evaluationRouteState.runId, selectedEvaluation, runs, selectedRun?.id, updateEvaluationCache]);

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

  const resolveEvaluationModelRelation = useCallback((modelId: string | null | undefined) => {
    if (!modelId) return null;
    const model = models.find((item) => item.id === modelId);
    if (!model) return null;
    const provider = providers.find((item) => item.id === model.providerId);
    return {
      id: model.id,
      name: model.name,
      modelId: model.modelId,
      provider: provider ? { type: provider.type } : undefined,
    };
  }, [models, providers]);

  const selectedEvaluationModel = useMemo(() => {
    if (!selectedEvaluation) return null;
    return resolveEvaluationModelRelation(selectedEvaluation.modelId) ?? selectedEvaluation.model ?? null;
  }, [resolveEvaluationModelRelation, selectedEvaluation]);

  const selectedEvaluationJudgeModel = useMemo(() => {
    if (!selectedEvaluation) return null;
    return resolveEvaluationModelRelation(selectedEvaluation.judgeModelId) ?? selectedEvaluation.judgeModel ?? null;
  }, [resolveEvaluationModelRelation, selectedEvaluation]);

  const selectedEvaluationPassThreshold = selectedEvaluation?.config.pass_threshold ?? 0.6;

  const resolveRunExportMeta = (run: EvaluationRun) => {
    const runConfig = run.runConfig as RunConfig | null;
    const promptName =
      runConfig?.promptName ?? selectedEvaluation?.prompt?.name ?? selectedEvaluation?.promptId ?? '';
    const promptVersion =
      runConfig?.promptVersion ?? selectedEvaluation?.prompt?.currentVersion ?? '';
    const modelName =
      runConfig?.modelName ??
      selectedEvaluationModel?.name ??
      selectedEvaluationModel?.modelId ??
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

  const downloadBlobFile = (filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportExecutionRecord = async (targetRun?: EvaluationRun) => {
    const runToExport = targetRun ?? selectedRun;
    if (!selectedEvaluation || !runToExport) {
      showToast('error', t('exportNoResults'));
      return;
    }
    if (exportingRunId) return;

    setExportingRunId(runToExport.id);
    setExporting(true);
    try {
      const runResults = await runsApi.getResults(runToExport.id);
      if (runResults.length === 0) {
        showToast('error', t('exportNoResults'));
        return;
      }

      const testCaseMap = buildTestCaseMap();
      const rows = buildExecutionExportRows(runToExport, runResults, testCaseMap);
      if (rows.length === 0) {
        showToast('error', t('exportNoResults'));
        return;
      }

      const { modelName } = resolveRunExportMeta(runToExport);
      const runTimestamp = formatTimestampForFilename(
        runToExport.startedAt ?? runToExport.createdAt ?? runToExport.completedAt
      );
      const safeModelName = sanitizeFilenamePart(modelName, 'model');
      downloadCsvFile(`${safeModelName}_${runTimestamp}.csv`, exportColumns, rows);
    } catch (error) {
      console.error('Failed to export execution record:', error);
      showToast('error', t('exportFailed'));
    } finally {
      setExporting(false);
      setExportingRunId((prev) => (prev === runToExport.id ? null : prev));
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

  const downloadMarkdownFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const buildAnalysisTitle = useCallback(
    (scope: EvaluationAnalysisScope, runLabel: string): string => {
      if (scope === 'single') return t('analysisAutoTitleSingle', { label: runLabel });
      return t('analysisAutoTitleMulti', { label: runLabel });
    },
    [t]
  );

  const buildAnalysisPayload = (draft: AnalysisDraftContext, deepMode: boolean): Record<string, unknown> => {
    const baseData = draft.analysisData as unknown as Record<string, unknown>;
    if (!deepMode || !draft.deepAnalysisContext) {
      return baseData;
    }
    return {
      ...baseData,
      deepAnalysisContext: draft.deepAnalysisContext,
    };
  };

  const openAnalysisForRuns = async (targetRuns: EvaluationRun[]) => {
    if (!selectedEvaluation) return;
    if (targetRuns.length === 0) {
      showToast('error', t('noExecutionRecords'));
      return;
    }
    if (targetRuns.length > 20) {
      showToast('error', t('analysisSelectionLimitReached', { max: 20 }));
      return;
    }

    const scope: EvaluationAnalysisScope = targetRuns.length === 1 ? 'single' : 'multi';
    const uniqueRuns = Array.from(new Map(targetRuns.map((run) => [run.id, run])).values());
    const runIds = uniqueRuns.map((run) => run.id);
    const runLabel = uniqueRuns.length === 1
      ? getRunDisplayTitle(uniqueRuns[0])
      : t('analysisRunCount', { count: uniqueRuns.length });

    setAnalysisPreparing(true);
    try {
      const runResultsById: Record<string, TestCaseResult[]> = {};
      await Promise.all(
        uniqueRuns.map(async (run) => {
          if (selectedRun?.id === run.id && results.length > 0) {
            runResultsById[run.id] = results;
            return;
          }
          runResultsById[run.id] = await runsApi.getResults(run.id);
        })
      );

      const analysisData =
        scope === 'single'
          ? analyzeSingleRun({
              run: uniqueRuns[0],
              runs: uniqueRuns,
              runResultsById,
              testCases,
              criteria,
              language: i18n.language || 'en',
            })
          : analyzeMultipleRuns({
              runs: uniqueRuns,
              runResultsById,
              testCases,
              criteria,
              language: i18n.language || 'en',
            });

      const promptContextByKey = new Map<string, AnalysisPromptContext | null>();
      await Promise.all(
        uniqueRuns.map(async (run) => {
          const runConfig = (run.runConfig as RunConfig | null) ?? null;
          const runPromptId = runConfig?.promptId || selectedEvaluation.promptId || null;
          const runPromptVersion = runConfig?.promptVersion ?? null;
          const key = `${runPromptId || ''}::${runPromptVersion || ''}`;
          if (promptContextByKey.has(key)) return;
          const snapshot = await getPromptSnapshotForRun(run.runConfig, selectedEvaluation.promptId);
          const promptContext = toAnalysisPromptContext(snapshot, {
            promptId: runPromptId,
            promptName: runConfig?.promptName || selectedPrompt?.name || null,
            promptVersion: runPromptVersion,
          });
          promptContextByKey.set(key, promptContext);
        })
      );

      const promptContext = toAnalysisPromptContext(
        await ensurePromptDetail(selectedEvaluation.promptId),
        {
          promptId: selectedEvaluation.promptId ?? null,
          promptName: selectedPrompt?.name || null,
          promptVersion: selectedPrompt?.currentVersion ?? null,
        }
      );

      const testCaseById = new Map(testCases.map((testCase) => [testCase.id, testCase]));
      const deepRuns: DeepAnalysisRunDetail[] = uniqueRuns.map((run) => {
        const runConfig = (run.runConfig as RunConfig | null) ?? null;
        const runPromptId = runConfig?.promptId || selectedEvaluation.promptId || null;
        const runPromptVersion = runConfig?.promptVersion ?? null;
        const promptKey = `${runPromptId || ''}::${runPromptVersion || ''}`;
        const runPromptContext = promptContextByKey.get(promptKey) ?? null;
        const runResults = runResultsById[run.id] || [];
        const runResultByCaseId = new Map(runResults.map((result) => [result.testCaseId, result]));
        const caseIds = Array.from(
          new Set([...testCases.map((testCase) => testCase.id), ...runResults.map((result) => result.testCaseId)])
        );

        const cases: DeepAnalysisCaseDetail[] = caseIds.map((testCaseId) => {
          const testCase = testCaseById.get(testCaseId);
          const result = runResultByCaseId.get(testCaseId);
          return {
            testCaseId,
            testCaseName: testCase?.name || testCaseId,
            executed: !!result,
            inputText: testCase?.inputText ?? null,
            inputVariables: testCase?.inputVariables ?? {},
            expectedOutput: testCase?.expectedOutput ?? null,
            notes: testCase?.notes ?? null,
            passed: !!result?.passed,
            errorMessage: result?.errorMessage ?? null,
            modelOutput: result?.modelOutput ?? null,
            scores: result?.scores ?? {},
            aiFeedback: result?.aiFeedback ?? {},
            latencyMs: result?.latencyMs ?? 0,
            ocrLatencyMs: result?.ocrLatencyMs ?? 0,
            tokensInput: result?.tokensInput ?? 0,
            tokensOutput: result?.tokensOutput ?? 0,
            tokensTotal: (result?.tokensInput ?? 0) + (result?.tokensOutput ?? 0),
          };
        });

        return {
          runId: run.id,
          runTitle: run.title?.trim() || null,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          modelName: runConfig?.modelName ?? null,
          judgeModelName: runConfig?.judgeModelName ?? null,
          promptName: runConfig?.promptName ?? null,
          promptVersion: runConfig?.promptVersion ?? null,
          promptContext: runPromptContext,
          cases,
        };
      });

      const deepAnalysisContext: DeepAnalysisContext = {
        mode: 'full_case_feedback',
        generatedAt: new Date().toISOString(),
        evaluation: {
          evaluationId: selectedEvaluation.id,
          evaluationName: selectedEvaluation.name,
        },
        promptContext,
        runPromptContexts: Array.from(promptContextByKey.values()).filter(
          (context): context is AnalysisPromptContext => !!context
        ),
        criteria: criteria.map((criterion) => ({
          id: criterion.id,
          name: criterion.name,
          description: criterion.description ?? null,
          prompt: criterion.prompt ?? null,
          weight: criterion.weight,
          enabled: criterion.enabled,
        })),
        runs: deepRuns,
      };

      const defaultModelId =
        selectedEvaluation.judgeModelId ||
        selectedEvaluation.modelId ||
        models[0]?.id ||
        '';

      setAnalysisDraft({
        scope,
        runIds,
        runLabel,
        analysisData,
        deepAnalysisContext,
      });
      setAnalysisDeepMode(true);
      setAnalysisModelId(defaultModelId);
      setAnalysisPrompt(buildDefaultAnalysisPrompt(i18n.language || 'en', scope));
      setAnalysisPreviewCopied(false);
      setAnalysisModalOpen(true);
    } catch (error) {
      console.error('Failed to prepare analysis:', error);
      showToast('error', t('analysisPrepareFailed'));
    } finally {
      setAnalysisPreparing(false);
    }
  };

  const closeAnalysisModal = () => {
    if (analysisPreparing) return;
    if (analysisRunning) {
      setAnalysisModalOpen(false);
      setGlobalAnalysisTaskCollapsed(true);
      showToast('info', t('analysisRunningInBackground'));
      return;
    }
    setAnalysisModalOpen(false);
    setAnalysisDraft(null);
    setAnalysisPreviewCopied(false);
  };

  const moveAnalysisToBackground = () => {
    if (!analysisRunning) {
      closeAnalysisModal();
      return;
    }
    setAnalysisModalOpen(false);
    setGlobalAnalysisTaskCollapsed(true);
    showToast('info', t('analysisRunningInBackground'));
  };

  const handleAbortAnalysis = () => {
    if (analysisRunPhase === 'saving') return;
    const controller = analysisAbortControllerRef.current;
    if (!controller) return;
    controller.abort();
  };

  const handleOpenSingleRunAnalysis = async () => {
    const runForAnalysis = selectedRun ?? runs[0] ?? null;
    if (!runForAnalysis) {
      showToast('error', t('noExecutionRecords'));
      return;
    }
    await openAnalysisForRuns([runForAnalysis]);
  };

  const handleOpenMultiRunAnalysisFromHistory = async (selectedRuns: EvaluationRun[]) => {
    await openAnalysisForRuns(selectedRuns);
    setActiveTab('analysis');
  };

  const handleOpenAnalysisEntry = () => {
    if (analysisPreparing) return;
    if (runs.length === 0) {
      showToast('error', t('noExecutionRecords'));
      return;
    }
    setAnalysisEntryModalOpen(true);
  };

  const handleStartSingleAnalysisFromEntry = async () => {
    setAnalysisEntryModalOpen(false);
    await handleOpenSingleRunAnalysis();
  };

  const handleStartMultiAnalysisFromEntry = () => {
    setAnalysisEntryModalOpen(false);
    setActiveTab('history');
    setRunHistoryAnalyzeSelectionTrigger((prev) => prev + 1);
  };

  const handleViewExecutionHistoryFromEntry = () => {
    setAnalysisEntryModalOpen(false);
    setActiveTab('history');
  };

  const handleRunAiAnalysis = async () => {
    if (!selectedEvaluation || !analysisDraft) return;
    if (analysisRunning) return;
    if (!analysisModelId) {
      showToast('error', t('selectAnalyzeModelFirst'));
      return;
    }
    if (!analysisPrompt.trim()) {
      showToast('error', t('analysisPromptRequired'));
      return;
    }

    setAnalysisRunning(true);
    setAnalysisRunPhase('generating');
    setAnalysisTaskMeta({
      scope: analysisDraft.scope,
      runLabel: analysisDraft.runLabel,
      evaluationId: selectedEvaluation.id,
    });
    startGlobalAnalysisTask({
      scope: analysisDraft.scope,
      runLabel: analysisDraft.runLabel,
      evaluationId: selectedEvaluation.id,
      runIds: analysisDraft.runIds,
    });
    const targetEvaluationId = selectedEvaluation.id;
    const targetScope = analysisDraft.scope;
    const targetRunIds = [...analysisDraft.runIds];
    const targetPrompt = analysisPrompt;
    const targetRunLabel = analysisDraft.runLabel;
    const targetModelId = analysisModelId;
    const targetLocale = i18n.language || null;
    const analysisPayload = buildAnalysisPayload(analysisDraft, analysisDeepMode);
    const abortController = chatApi.createAbortController();
    analysisAbortControllerRef.current = abortController;
    try {
      const aiResponse = await chatApi.complete({
        modelId: targetModelId,
        messages: [
          {
            role: 'user',
            content: buildAnalysisInputMessage(targetPrompt, analysisPayload, i18n.language || 'en'),
          },
        ],
        saveTrace: false,
        isEvalCase: true,
      }, abortController.signal);

      if (abortController.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      setAnalysisRunPhase('saving');
      setGlobalAnalysisPhase('saving');
      const sanitizedSummaryMarkdown = sanitizeAnalysisMarkdown(aiResponse.content);

      const report = await evaluationAnalysisReportsApi.create(targetEvaluationId, {
        scope: targetScope,
        runIds: targetRunIds,
        analysisModelId: targetModelId,
        prompt: targetPrompt,
        analysisData: analysisPayload,
        summaryMarkdown: sanitizedSummaryMarkdown,
        title: buildAnalysisTitle(targetScope, targetRunLabel),
        locale: targetLocale,
      });

      if (selectedEvaluationIdRef.current === targetEvaluationId) {
        setAnalysisReports((prev) => [report, ...prev]);
        setSelectedAnalysisReportId(report.id);
        setActiveTab('analysis');
      }

      setAnalysisModalOpen(false);
      setAnalysisDraft(null);
      completeGlobalAnalysisTask({ reportId: report.id });
      showToast('success', t('analysisSaved'));
    } catch (error) {
      if (isAbortError(error)) {
        abortGlobalAnalysisTask();
        showToast('info', t('analysisAborted'));
        return;
      }
      console.error('Failed to run analysis:', error);
      failGlobalAnalysisTask(getErrorMessage(error));
      showToast('error', getErrorMessage(error));
    } finally {
      analysisAbortControllerRef.current = null;
      setAnalysisRunning(false);
      setAnalysisRunPhase('idle');
      setAnalysisTaskMeta(null);
    }
  };

  const handleExportAnalysisReport = (report: EvaluationAnalysisReport) => {
    if (!selectedEvaluation) return;
    const markdown = buildEvaluationAnalysisMarkdown(report, selectedEvaluation.name);
    const timestamp = formatTimestampForFilename(report.createdAt);
    const safeEvalName = sanitizeFilenamePart(selectedEvaluation.name, 'evaluation');
    downloadMarkdownFile(`${safeEvalName}_analysis_${timestamp}.md`, markdown);
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

  const handleRetryErroredCases = async () => {
    if (!selectedEvaluation || !selectedRun) return;
    if (selectedRun.status === 'pending' || selectedRun.status === 'running') {
      showToast('info', t('runStillRunning', { defaultValue: 'Current run is still in progress' }));
      return;
    }
    if (!selectedEvaluation.modelId) {
      showToast('error', t('selectModelFirst'));
      return;
    }

    const sourceRunId = selectedRun.id;
    if (retryingErroredCasesRunId === sourceRunId) return;

    const model = models.find((item) => item.id === selectedEvaluation.modelId);
    const provider = providers.find((item) => item.id === model?.providerId);
    if (!model || !provider) {
      showToast('error', t('modelOrProviderNotFound'));
      return;
    }

    setRetryingErroredCasesRunId(sourceRunId);
    try {
      const latestResults = await runsApi.getResults(sourceRunId);
      const erroredCaseCount = Array.from(
        new Set(
          latestResults
            .filter((result) => typeof result.errorMessage === 'string' && result.errorMessage.trim().length > 0)
            .map((result) => result.testCaseId)
        )
      ).length;
      if (erroredCaseCount === 0) {
        showToast('info', t('noErroredCasesToRetry', { defaultValue: 'No errored cases to retry in this run' }));
        return;
      }

      showToast(
        'info',
        t('retryErroredCasesStarted', {
          count: erroredCaseCount,
          defaultValue: `Retrying ${erroredCaseCount} errored case(s)...`,
        })
      );
      // Switch to history so users can immediately perceive in-place retry progress.
      setActiveTab('history');

      const queuedRun = await runsApi.retryErroredCases(sourceRunId);
      const evaluationId = selectedEvaluation.id;

      setRuns((prev) => {
        const next = prev.map((run) => (run.id === sourceRunId ? queuedRun : run));
        updateEvaluationCache(evaluationId, { runs: next, selectedRunId: sourceRunId });
        return next;
      });
      setSelectedRun((prev) => (prev?.id === sourceRunId ? queuedRun : prev));

      setSelectedEvaluation((prev) =>
        prev?.id === evaluationId
          ? { ...prev, status: queuedRun.status, completedAt: queuedRun.completedAt ?? null }
          : prev
      );
      setEvaluations((prev) => {
        const next = prev.map((evaluation) =>
          evaluation.id === evaluationId
            ? { ...evaluation, status: queuedRun.status, completedAt: queuedRun.completedAt ?? null }
            : evaluation
        );
        updateListCache({ evaluations: next });
        return next;
      });
    } catch (error) {
      console.error('Retry errored cases failed:', error);
      showToast('error', t('retryErroredCasesFailed', { defaultValue: 'Failed to retry errored cases' }));
    } finally {
      setRetryingErroredCasesRunId((current) => (current === sourceRunId ? null : current));
    }
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
    if (enabledCriteria.length === 0) return true;
    const weightSum = enabledCriteria.reduce((sum, c) => sum + (c.weight || 0), 0) || 1;
    const weighted = enabledCriteria.reduce((sum, criterion) => {
      return sum + (scores[criterion.name] || 0) * (criterion.weight || 1);
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
      // Retry output should follow the latest evaluation settings first, then fallback to run snapshot.
      const fileProcessing = evalConfig.file_processing ||
        (runConfig?.fileProcessing as EvaluationConfig['file_processing']) ||
        'auto';
      const retryOcrProvider = evalConfig.ocr_provider ||
        (runConfig?.ocrProvider as EvaluationConfig['ocr_provider']) ||
        (runConfig?.ocrProviderResolved as EvaluationConfig['ocr_provider']);
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
        ocrProvider: retryOcrProvider,
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

      // Keep the selected run's OCR snapshot in sync with the latest retry settings so OCR panel queries the new provider.
      const nextRunConfig: RunConfig = { ...((selectedRun.runConfig as RunConfig | null) || {}) };
      nextRunConfig.fileProcessing = fileProcessing;
      if (retryOcrProvider) {
        nextRunConfig.ocrProvider = retryOcrProvider;
      } else {
        delete nextRunConfig.ocrProvider;
      }
      const resolvedRetryOcrProvider = aiResponse.ocrProvider || retryOcrProvider;
      if (resolvedRetryOcrProvider) {
        nextRunConfig.ocrProviderResolved = resolvedRetryOcrProvider;
      } else {
        delete nextRunConfig.ocrProviderResolved;
      }
      setRuns((prev) => {
        const nextRuns = prev.map((run) =>
          run.id === selectedRun.id ? { ...run, runConfig: nextRunConfig } : run
        );
        updateEvaluationCache(selectedEvaluation.id, { runs: nextRuns, selectedRunId: selectedRun.id });
        return nextRuns;
      });
      setSelectedRun((prev) =>
        prev?.id === selectedRun.id ? { ...prev, runConfig: nextRunConfig } : prev
      );

      let nextResults: TestCaseResult[] = [];
      setResults((prev) => {
        nextResults = prev.some((r) => r.testCaseId === saved.testCaseId)
          ? prev.map((r) => (r.testCaseId === saved.testCaseId ? saved : r))
          : [...prev, saved];
        updateEvaluationCache(selectedEvaluation.id, { results: nextResults, selectedRunId: selectedRun.id });
        return nextResults;
      });

      await recomputeAndPersistRunResults(nextResults);
      setRetryOutputRefreshTick((prev) => prev + 1);
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

        const parsed = parseJudgeEvaluationResponse(evalResponse.content, t('evaluationFailed'));
        scores[criterion.name] = parsed.score;
        aiFeedback[criterion.name] = parsed.reason;
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        console.error('AI evaluation error:', error);
        scores[criterion.name] = 0;
        aiFeedback[criterion.name] = t('evaluationFailed');
      }
    }

    const passed = computeWeightedPass(scores, enabledCriteria, selectedEvaluation.config?.pass_threshold ?? 0.6);
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
    const evaluationId = selectedEvaluation.id;
    const runId = selectedRun.id;
    if (retryingAllScoresByRunId[runId]) {
      showToast('info', t('retryScoresRunning', { defaultValue: '评分重试正在后台执行，请稍后查看。' }));
      return;
    }
    if (selectedRun.status === 'pending' || selectedRun.status === 'running') {
      showToast('info', t('runStillRunning', { defaultValue: '当前执行记录仍在运行中。' }));
      return;
    }

    setRetryingAllScoresByRunId((prev) => ({ ...prev, [runId]: true }));
    retryAllScoresStatusRef.current.set(runId, selectedRun.status);
    let enqueueSucceeded = false;
    try {
      const queuedRun = await runsApi.retryScores(runId);
      retryAllScoresStatusRef.current.set(runId, queuedRun.status);

      setRuns((prev) => {
        const next = prev.map((run) => (run.id === runId ? queuedRun : run));
        updateEvaluationCache(evaluationId, { runs: next, selectedRunId: runId });
        return next;
      });
      setSelectedRun((prev) => (prev?.id === runId ? queuedRun : prev));
      setSelectedEvaluation((prev) =>
        prev?.id === evaluationId
          ? { ...prev, status: queuedRun.status, completedAt: queuedRun.completedAt ?? null }
          : prev
      );
      setEvaluations((prev) => {
        const next = prev.map((evaluation) =>
          evaluation.id === evaluationId
            ? { ...evaluation, status: queuedRun.status, completedAt: queuedRun.completedAt ?? null }
            : evaluation
        );
        updateListCache({ evaluations: next });
        return next;
      });

      enqueueSucceeded = true;
      showToast('success', t('retryScoresQueued', { defaultValue: '评分重试任务已提交，正在后台执行' }));
    } catch (e) {
      console.error('Retry scores failed:', e);
      showToast('error', t('retryScoresFailed'));
    } finally {
      if (!enqueueSucceeded) {
        setRetryingAllScoresByRunId((prev) => {
          if (!prev[runId]) return prev;
          const next = { ...prev };
          delete next[runId];
          return next;
        });
        retryAllScoresStatusRef.current.delete(runId);
      }
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

      // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愮儤鍋嬮柣妯荤湽閳ь兛绶氬鎾閻橀潧骞堟繝娈垮枟閿曗晠宕㈡禒瀣︽繝闈涙閺€浠嬫⒔閸ヮ剙鏄ラ柡宓苯娈梺鍛婃处閸樻悂宕戦幘缁樻櫜閹煎瓨绻勯懗鍝勨攽閳ュ啿绾ч柛鏃€鐟ラ～蹇曠磼濡偐鎳濋梺閫炲苯澧い顓炴穿椤﹁泛顭胯缁诲牆顫忓ú顏勪紶闁告洦鍓欏▍銈夋⒑閻戔晜娅撻柛銊ョ埣閻涱喛绠涘☉妯碱吅闂佹寧妫佸Λ鍕濠婂牊鐓熼煫鍥ㄦ尵缁狅綁鏌ｉ幒鐐电暤鐎殿噮鍓熼崺鈧い鎺戝閳锋帒霉閿濆牊顏犻悽顖涚洴閹锋垶娼忛埡鍌氭瀾闂佸搫顦悘婵嬪汲閿濆棎浜滈柕蹇婂墲椤ュ牊銇勯姀鈩冪濠碘€崇埣瀹曞爼鈥﹂幒鏃傤攨闂傚倸鍊风粈渚€骞夐敓鐘冲仭闁挎繂顦壕鍧楁煙閹澘袚闁稿孩顨嗙换娑㈠幢濡闉嶉梺缁樻尰缁嬫捇鍩€椤掆偓閸樻粓宕戦幘缁樼厓鐟滄粓宕滈悢椋庢殾濞村吋娼欓崘鈧銈嗘尵婵绮婇敃鍌涒拺缂侇垱娲栨晶鏌ユ煕閹寸姵鍤€閸楀崬螖閿濆懎鏆為柍閿嬪灴閺岀喓绮欓幐搴㈠闯闂佸疇妫勯ˇ杈╂閹烘挸绶炲┑鐘插妤旈柣?
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

      // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻橀弻锝夊箣閿濆棭妫勯梺鍝勵儎缁舵岸寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ゆい顓犲厴瀵鏁愭径濠勭杸濡炪倖甯婇悞锕傚磿閹惧墎纾藉ù锝呮惈灏忛梺鍛婎殕婵炲﹤顕ｆ繝姘亜闁稿繐鐨烽幏濠氭煟鎼淬劍娑у鐟帮工鍗辨い鏂垮⒔绾捐棄霉閿濆懏鎯堥崯鍛婄節濞堝灝鏋涢柣蹇旀皑缁碍娼忛妸褏鐦堥梺鎼炲劥閸╂牠寮查鈧埞鎴︽偐缂佹ɑ閿柣搴㈢殰閸パ咃紱闂佽宕橀褔鎮為崹顐犱簻闁圭儤鍨甸顏堟煟閹惧娲撮柟顔筋殜閺佹劖鎯斿┑鍫熸櫦闂佽桨绀侀悧鍡氱亙闂佺粯锕㈠褎绂掗敃鍌涚厽婵°倓绶″▓鏃€銇勯鐐寸┛缂佺姵绋戦埥澶娢熺喊杈ㄐら梺鑽ゅ枑缁矂鏌婇敐鍛殾闁硅揪缍嗗Σ鍓х磽娴ｄ粙鍝洪悽顖ょ節閻涱噣宕卞鍏夹╃紓鍌氬€哥粔鐢告偋濠婂懏顫曢柟鐑橆殢閺佸﹪鏌ｉ敐鍛拱闁革絼鍗抽幃妤€鈻撻崹顔界亪濡炪値鍘鹃崗姗€鐛崘顔碱潊闁靛牆妫楁禍妤呮煙閼圭増褰х紒鎻掓健瀵櫕瀵肩€涙鍘介梺缁樻煥閹芥粓鎯屾繝鍕＜缂備焦锕懓璺ㄢ偓娈垮櫘閸嬪嫰顢樻總绋挎そ濞达絽鎲￠崐顖氣攽閻橆喖鐏辨繛澶嬬洴椤㈡牠宕堕鈧崒?
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
    const evaluationId = selectedEvaluation.id;
    const patchEvaluation = (evaluation: EvaluationWithRelations): EvaluationWithRelations => {
      const next = { ...evaluation, [field]: value } as EvaluationWithRelations;
      if (field === 'modelId') {
        next.model = resolveEvaluationModelRelation(value);
      } else if (field === 'judgeModelId') {
        next.judgeModel = resolveEvaluationModelRelation(value);
      }
      return next;
    };
    setSelectedEvaluation((prev) =>
      prev?.id === evaluationId ? patchEvaluation(prev) : prev
    );
    setEvaluations((prev) => {
      const next = prev.map((e) =>
        e.id === evaluationId ? patchEvaluation(e) : e
      );
      updateListCache({ evaluations: next });
      return next;
    });
    try {
      await evaluationsApi.update(evaluationId, { [field]: value });
    } catch (e) {
      console.error('Failed to save evaluation:', e);
      showToast('error', t('updateFailed'));
    }
  };

  const handleUpdateExpectedOutputFromResults = async (testCaseId: string, expectedOutput: string | null) => {
    if (!selectedEvaluation) return;

    const previousTestCases = testCases;
    const nextTestCases = testCases.map((testCase) =>
      testCase.id === testCaseId
        ? { ...testCase, expectedOutput }
        : testCase
    );

    setTestCases(nextTestCases);
    updateEvaluationCache(selectedEvaluation.id, { testCases: nextTestCases });

    try {
      await testCasesApi.update(testCaseId, {
        expectedOutput: expectedOutput ?? undefined,
      });
    } catch (error) {
      setTestCases(previousTestCases);
      updateEvaluationCache(selectedEvaluation.id, { testCases: previousTestCases });
      throw error;
    }
  };
  const applyConfigPatch = (
    baseConfig: EvaluationConfig | undefined,
    patch: Partial<EvaluationConfig>,
  ): EvaluationConfig => {
    const next = { ...(baseConfig || {}) } as EvaluationConfig;
    for (const key of Object.keys(patch) as Array<keyof EvaluationConfig>) {
      const patchValue = patch[key];
      if (patchValue === undefined) {
        delete (next as Record<string, unknown>)[key as string];
      } else {
        (next as Record<string, unknown>)[key as string] = patchValue as unknown;
      }
    }
    return next;
  };
  const handleUpdateConfigPatch = async (patch: Partial<EvaluationConfig>) => {
    if (!selectedEvaluation) return;
    const evaluationId = selectedEvaluation.id;
    const requestConfig = applyConfigPatch(selectedEvaluation.config, patch);
    setSelectedEvaluation((prev) =>
      prev?.id === evaluationId
        ? ({ ...prev, config: applyConfigPatch(prev.config, patch) } as EvaluationWithRelations)
        : prev
    );
    setEvaluations((prev) => {
      const next = prev.map((e) =>
        e.id === evaluationId
          ? ({ ...e, config: applyConfigPatch(e.config, patch) } as EvaluationWithRelations)
          : e
      );
      updateListCache({ evaluations: next });
      return next;
    });
    try {
      await evaluationsApi.update(evaluationId, { config: requestConfig });
    } catch (e) {
      console.error('Failed to save evaluation config:', e);
      showToast('error', t('updateFailed'));
    }
  };
  const handleUpdateConfig = async <K extends keyof EvaluationConfig>(key: K, value: EvaluationConfig[K]) => {
    await handleUpdateConfigPatch({ [key]: value } as Partial<EvaluationConfig>);
  };

  useEffect(() => {
    if (!selectedEvaluation) return;
    const configuredProvider = selectedEvaluation.config.ocr_provider;
    if (!configuredProvider) return;
    if (enabledOcrProviders.includes(configuredProvider)) return;
    handleUpdateConfig('ocr_provider', undefined).catch(() => {});
  }, [enabledOcrProviders, selectedEvaluation]);

  // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻娑樷槈濮楀牊鏁鹃梺鍛婄懃缁绘劙婀侀梺绋跨箰閸氬绱為幋锔界厱闁靛鍎遍埀顒€娼″濠氭晲婢跺﹦顔掗悗瑙勬礀濞层倝宕ú顏呪拺闁告繂瀚烽崕鎰版煟濡や緡娈橀柟骞垮灩閳藉濮€閻樻鍚呴梻浣虹帛閸旀浜稿▎鎾崇濞寸厧鐡ㄩ埛鎴犵磼鐎ｎ偒鍎ラ柛搴㈠姍閺岀喖宕ㄦ繝鍐ㄢ偓鎰版煥濠靛牆浠滈柍瑙勫灩閳ь剨缍嗛崑鍕濡ゅ懏鐓欓柛蹇氬亹閺嗘﹢鏌涢妸锔筋潡闁靛洦鍔栭幆鏃堬綖椤撶姷鐣鹃梻渚€娼ч悧鍡椕洪妶鍛瘎闂傚倷鑳堕…鍫ヮ敄閸℃稒鍎庢い鏍ㄦ皑閺嗭附銇勯弽顐㈠壉闁轰礁绉电换婵囩節閸屾凹浠奸柟鍏兼綑閿曘倝鍩為幋锔藉亹缂備焦蓱闁款厼顪冮妶鍡楃仴闁硅櫕鍔栫粩鐔煎即閻旇櫣鐦堝┑顔斤供閸橀箖宕㈡禒瀣拺闁圭娴风粻鎾绘煙閾忣偅灏甸柍褜鍓氶惌顕€宕￠幎钘夎摕闁挎稑瀚ч崑鎾绘晲鎼粹€茬敖濠电偛寮堕幐鎶藉蓟閿涘嫪娌柛鎾楀嫬鍨卞┑鐘殿暯閸撴繈骞冮崒鐐叉瀬闁告劦鍠栭悞鍨亜閹烘垵顏╃紒鈧径鎰厪闁割偅绻嶅Σ褰掓煟閹捐泛鏋涢柡灞诲妼閳规垿宕卞Ο缁樺€烽梻浣告啞閿氭い鏇ㄥ弮閸┾偓妞ゆ帒鍠氬鎰箾閸欏澧甸柟顔哄劜缁虹晫绮欓幐搴ｂ偓顒勬⒑閸︻厼顣兼繝銏∶蹇撯攽閸ャ儰绨婚梺鐟版惈濡绂嶉幆褜娓婚柕鍫濆暙閸旀粎鈧厜鍋撶紒瀣儥濞兼牜绱撴担鑲℃垶鍒婇幘顔界叄闊洦娲橀崵鈧紓浣诡殣缁绘繂顫忓ú顏勭闁绘劖褰冮‖瀣⒑閸涘鐒奸柛鈩冪懁缂冩洟姊婚崒娆戭槮闁规祴鈧秮娲晝閸屾艾鐎梻渚囧墮缁夊澹曢幐搴濈箚闁靛牆瀚ˇ椋庣磼鐠囧弶顥㈤柡灞炬礋瀹曠厧鈹戦崶褎顏￠梻渚€娼荤徊鎯ь渻娴犲钃熼柨婵嗩槸缁犲鎮楀☉娆樼劷妞わ缚鍗冲铏规嫚閳ヨ櫕鐏嶉梺鎸庢磸閸ㄤ粙鐛崘銊㈡瀻闁规儳纾宀勬⒑閻熺増鎯堟俊顐ｇ懅閳ь剙鐏氶悧鐘差潖缂佹ɑ濯撮柣鐔告緲椤亪姊洪幖鐐插鐎规洦鍓涢崣鍛攽閳藉棗鐏犻柛姘儏閻ｇ兘宕ｆ径宀€顔曢梺鐟扮摠閻熴儵鎮橀埡鍛拺闁告鍋炴径鍕磼缂佹绠炴俊顐㈠暙閳藉顫濋澶嬫瘒闂傚倷鑳剁划顖炲箰妤ｅ啫绐楅柡宓本缍庡┑鐐叉▕娴滄粍瀵奸悩缁樼厱闁哄洢鍔屾晶顖炴煙閻ゎ垯鍚紒杈ㄦ尰閹峰懘宕滈幓鎺戝闂備焦鎮堕崝灞筋焽閳ュ磭鏆︽繛宸簻椤懘鏌嶉埡浣告殭闁告柨鎳樺娲濞戣京鍔搁梺绋垮婵炲﹪骞冮悙顑惧亝闁告劏鏂侀幏娲⒑闂堚晛鐦滈柛娆忛叄閹偤骞嗛‖顒佹閹晠鎼归鈶╁亾閹扮増鐓欐い鏃€鏋婚懓鍨攽閿涘嫬鍘撮柛鈺嬬節瀹曟帒顫濋銈嗘?
  const handleModelParametersChange = async (newConfig: PromptConfig) => {
    const normalizedConfig: PromptConfig = {
      ...newConfig,
      top_p: resolveTopP(newConfig.top_p),
    };
    setEvalModelConfig(normalizedConfig);
    const modelParams: ModelParameters = {
      temperature: normalizedConfig.temperature,
      top_p: normalizedConfig.top_p,
      frequency_penalty: normalizedConfig.frequency_penalty,
      presence_penalty: normalizedConfig.presence_penalty,
      max_tokens: normalizedConfig.max_tokens,
    };
    await handleUpdateConfigPatch({
      model_parameters: modelParams,
      inherited_from_prompt: false,
    });
  };

  // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻娑樷槈濮楀牊鏁鹃梺鍛婄懃缁绘劙婀侀梺绋跨箰閸氬绱為幋锔界厱闁靛鍎遍埀顒€娼″濠氭晲婢跺﹦顔掗悗瑙勬礀濞层倝宕ú顏呪拺闁告繂瀚烽崕鎰版煟濡や緡娈橀柟骞垮灩閳藉濮€閻樻鍚呴梻浣虹帛閸旀浜稿▎鎾崇濞寸厧鐡ㄩ埛鎴犵磼鐎ｎ偒鍎ラ柛搴㈠姍閺岀喖宕ㄦ繝鍐ㄢ偓鎰版煥濠靛牆浠滈柍瑙勫灩閳ь剨缍嗛崑鍕濡ゅ懏鐓欓柛蹇氬亹閺嗘﹢鏌涢妸锔筋潡闁靛洦鍔栭幆鏃堬綖椤撶姷鐣鹃梻渚€娼ч悧鍡椕洪妶鍛瘎闂傚倷鑳堕…鍫ヮ敄閸℃稒鍎庢い鏍ㄦ皑閺嗭附銇勯弽顐㈠壉闁轰礁绉电换婵囩節閸屾凹浠奸柟鍏兼綑閿曘倝鍩為幋锔藉亹缂備焦蓱闁款厼顪冮妶鍡楃仴闁硅櫕锕㈤獮鍐ㄢ枎閹邦喚鐦堥梺鍛婃处閸撴瑩寮搁幋锔筋棅妞ゆ劑鍨烘径鍕煣閺傛鍎旂€规洖鐖奸、鏂款吋閸″繑鐎搁梻鍌氬€风粈渚€骞栭锔藉剹濠㈣泛鑻欢銈呂旈敐鍛殭缂佺姵宀搁弻锟犲礃閵娧冾暫闂佺粯甯楀浠嬪蓟濞戙垹绠涢梻鍫熺☉缁犺顪冮妶鍐ㄧ仼闁瑰啿閰ｉ崺鐐哄箣閿旇棄浜归梺褰掝暒缁€渚€寮查柆宥嗏拺闁告縿鍎辨牎闂佺粯顨嗙划宥囩博閻旂厧鍗抽柕蹇婃櫆閺咃綁姊洪棃娑氱濠殿喚鍏樿棟?Prompt 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎梺鐟板⒔缁垶宕戦幇鐗堢厱闁归偊鍨扮槐锕傛煟閵忕媭鐓兼慨濠勭帛閹峰懘鎮烽柇锕€娈濇繝鐢靛仜瀵爼宕归崸妤€绠栭柣鎰劋閺呮繈鏌涚仦鐐殤闁汇倕娲弻锝堢疀閺囩偘绮舵繝鈷€鍛珪鐎殿啫鍥х劦妞ゆ帒瀚埛鎴炴叏閻熺増鎼愰柣蹇撳级缁绘稒鎷呴崘鎻掝伀妞も晝鍏橀弻銊╁籍閸屾矮澹曢梺鍝ュУ閸旀瑩寮婚埄鍐ㄧ窞濠电姴瀚搹搴ㄦ⒑閸濆嫭顥為柣鐕傜畵婵＄敻宕熼锝嗘櫍闂佺粯鍔栧娆撳几閻樼粯鈷戦柟鑲╁仜婵倻绱掗悩宕囧⒌闁绘侗鍣ｅ畷鍫曞Ω閿曗偓椤庢捇姊洪崨濠勨槈妞ゎ収鍓熷畷銉モ枎韫囧﹥鏂€闂佹寧绋戠€氼剚绂嶆總鍛婄厱濠电姴鍟版晶顏堟偂閵堝洠鍋撻獮鍨姎妞わ富鍨虫竟鏇熺節濮橆厾鍘甸梺璇″瀻閸涱剟鍋楅梻浣侯焾椤戝棝骞愭ィ鍐ㄧ疅闁圭虎鍠栫粈瀣亜閹烘垵浜炴俊鍙夊缁辨捇宕掑▎鎴ｇ獥闂佸摜濮甸悧婊呭垝閺冨洢浜归柟鐑樻煥缁侊箓妫呴銏″缂佸鍨甸蹇撯攽鐎ｎ偄鈧灚绻涢幋鐑嗕痪妞ゅ繐鎳愰々閿嬨亜閹惧崬鐏柍閿嬪灴閹嘲鈻庤箛鎿冧紝闂佸摜鍠庣换姗€寮诲☉銏″亹鐎规洖娲ら埛宀勬⒑缂佹ü绶遍柛锝忕到閻ｉ攱绺界粙璇俱劑鏌ㄩ弮鍥舵綈閻庢矮绮欏缁樻媴娓氼垳鍔搁梺鍝勭墱閸撶喖骞冮悿顖ｆ▌闁芥ɑ绻堥弻銊╁棘閸喒鎸冪紒鎯у⒔閺咁偊鍩€椤掆偓缁犲秹宕曢柆宥呯闁瑰瓨绻嶉崯鍛存煏婢舵稖绀嬪ù婊勭矋閵囧嫰骞樼捄杞版勃缂備礁鏈€笛囧Φ閸曨垱鏅濋柍褜鍓涚槐鐐寸節閸パ嗘憰闂佺粯姊婚埛鍫ュ极婵犲洦鐓熸い鎾楀啩鑸繛瀛樼矤娴滎亜鐣峰ú顏呭€烽柛婵嗗椤撴椽姊洪幐搴㈢５闁稿鎸婚〃銉╂倷椤忓嫮浼堥梺鍝勮嫰缁夐潧顭囬鍫濈妞ゆ梻鍘ч‖澶嬩繆閻愵亜鈧牠骞愰懡銈傚亾缁楁稑瀚埞宥呪攽閻樺弶澶勯柛濠囨敱閵囧嫯绠涢幘鎰佷槐闂佺顑嗛幑鍥ь嚕娴犲鏁冮柨婵嗘椤斿洭姊绘担鍛婅础闁稿簺鍊濆濠氭晸閻樿尙锛涢梺鍦亾閸撴艾顭囬埡鍛厽闁圭偓濞婇妤呮煃瀹勯偊鍎旈柟?
  const handlePromptChange = async (promptId: string | null) => {
    await handleUpdateEvaluation('promptId', promptId);
    if (!promptId) {
      await handleUpdateConfigPatch({ inherited_from_prompt: false });
      return;
    }
    if (promptId) {
      const prompt = await ensurePromptDetail(promptId);
      if (prompt?.config) {
        const newConfig = buildPromptConfigWithDefaults(prompt.config);
        setEvalModelConfig(newConfig);
        const modelParams = buildModelParamsFromPrompt(prompt.config);
        await handleUpdateConfigPatch({
          model_parameters: modelParams,
          inherited_from_prompt: true,
        });
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
  const privateShareEvaluationUrl = useMemo(() => {
    if (!privateShareLink) return '';
    const url = new URL(`/share/e/${privateShareLink.token}`, window.location.origin);
    return url.toString();
  }, [privateShareLink]);
  useEffect(() => {
    const evaluationId = selectedEvaluation?.id;
    if (!evaluationId) {
      setPrivateShareLink(null);
      setHasPrivateShareLink(false);
      return;
    }

    let active = true;
    void (async () => {
      try {
        const result = await shareApi.listLinks({
          resourceType: 'evaluation',
          resourceId: evaluationId,
          includeRevoked: false,
          page: 1,
          pageSize: 1,
        });
        if (!active) return;
        const link = result.data[0] ?? null;
        setPrivateShareLink(link);
        setHasPrivateShareLink(link !== null);
      } catch {
        if (!active) return;
        setPrivateShareLink(null);
        setHasPrivateShareLink(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [selectedEvaluation?.id]);
  const publishModalHasAttachments = useMemo(() => {
    if (!publishModalEvaluation) return false;
    const cases =
      publishModalEvaluation.testCases ??
      (selectedEvaluation?.id === publishModalEvaluation.id ? testCases : null);
    return !!cases?.some((tc) => (tc.attachments?.length ?? 0) > 0);
  }, [publishModalEvaluation, selectedEvaluation?.id, testCases]);
  const promptVariables = (selectedPrompt?.variables as PromptVariable[] | undefined)?.map((v) => v.name) || [];
  const selectedRunConfig = selectedRun?.runConfig as RunConfig | null;
  const selectedRunModelId = selectedRunConfig?.modelId ?? selectedEvaluation?.modelId ?? null;
  const selectedRunModel = selectedRunModelId ? (models.find((model) => model.id === selectedRunModelId) ?? null) : null;
  const retryingSelectedRunScores = selectedRun ? !!retryingAllScoresByRunId[selectedRun.id] : false;
  const retryingSelectedRunErroredCases = selectedRun ? retryingErroredCasesRunId === selectedRun.id : false;
  const selectedRunErroredCaseIds = useMemo(() => {
    if (!selectedRun) return [];
    return Array.from(
      new Set(
        results
          .filter((result) => result.runId === selectedRun.id)
          .filter((result) => typeof result.errorMessage === 'string' && result.errorMessage.trim().length > 0)
          .map((result) => result.testCaseId)
      )
    );
  }, [results, selectedRun]);
  const selectedRunPricing = selectedRunModel
    ? { inputPricePerM: selectedRunModel.inputPricePerM, outputPricePerM: selectedRunModel.outputPricePerM }
    : null;
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
    const aiCost = calculateAiCost(tokensInput, tokensOutput, selectedRunPricing);
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
      costInput: aiCost.inputCost,
      costOutput: aiCost.outputCost,
      costTotal: aiCost.totalCost,
      hasPricing: aiCost.hasPricing,
    };
  }, [results, selectedRunPricing]);
  const selectedRunLiveMetrics = useMemo(() => {
    if (!selectedRun || selectedRun.status !== 'completed') return null;
    if (results.length === 0) return null;

    const resultRunIds = new Set(
      results
        .map((result) => result.runId)
        .filter((runId): runId is string => typeof runId === 'string' && runId.length > 0)
    );

    if (resultRunIds.size > 1) return null;
    if (resultRunIds.size === 1 && !resultRunIds.has(selectedRun.id)) return null;

    return {
      runId: selectedRun.id,
      totalCases: resultsMetrics.totalCount,
      passedCases: resultsMetrics.passed,
      llmTimeMs: resultsMetrics.llmMs,
      ocrTimeMs: resultsMetrics.ocrMs,
      tokensInput: resultsMetrics.tokensInput,
      tokensOutput: resultsMetrics.tokensOutput,
      costInput: resultsMetrics.costInput,
      costOutput: resultsMetrics.costOutput,
      costTotal: resultsMetrics.costTotal,
      hasPricing: resultsMetrics.hasPricing,
    };
  }, [selectedRun, results, resultsMetrics]);
  const selectedAnalysisReport = useMemo(
    () => analysisReports.find((report) => report.id === selectedAnalysisReportId) ?? analysisReports[0] ?? null,
    [analysisReports, selectedAnalysisReportId]
  );
  const selectedAnalysisData = useMemo(
    () => parseEvaluationAnalysisData(selectedAnalysisReport?.analysisData),
    [selectedAnalysisReport?.analysisData]
  );
  const selectedAnalysisSummaryMarkdown = useMemo(
    () => sanitizeAnalysisMarkdown(selectedAnalysisReport?.summaryMarkdown ?? ''),
    [selectedAnalysisReport?.summaryMarkdown]
  );
  const comparisonTabs = useMemo<AnalysisCompareTabKey[]>(
    () => ['models', 'prompts', 'ocrProviders', 'judgeModels'],
    []
  );
  const selectedAnalysisComparisonItems = useMemo(
    () => (selectedAnalysisData ? getComparisonItems(selectedAnalysisData, analysisCompareTab, t) : []),
    [selectedAnalysisData, analysisCompareTab, t]
  );
  const selectedAnalysisComparisonMixed = useMemo(
    () => (selectedAnalysisData ? hasMixedComparison(selectedAnalysisData, analysisCompareTab) : false),
    [selectedAnalysisData, analysisCompareTab]
  );
  const selectedAnalysisJudgeSummary = selectedAnalysisData?.judgeEvaluationSummary ?? null;
  const selectedAnalysisRecommended = selectedAnalysisData?.recommendedSetup ?? null;
  const selectedAnalysisComparabilityWarnings = useMemo(
    () =>
      selectedAnalysisData && selectedAnalysisData.scope === 'multi'
        ? selectedAnalysisData.comparabilityWarnings || []
        : [],
    [selectedAnalysisData]
  );
  const selectedAnalysisTopStats = useMemo(() => {
    if (!selectedAnalysisData) return [] as Array<{ key: string; label: string; value: string }>;

    if (selectedAnalysisData.scope === 'single') {
      return [
        {
          key: 'totalCases',
          label: t('analysisTotalCases'),
          value: String(selectedAnalysisData.run.totalCases),
        },
        {
          key: 'passRate',
          label: t('passRate'),
          value: formatPercent(selectedAnalysisData.run.passRate),
        },
        {
          key: 'tokens',
          label: t('tokenConsumption'),
          value: selectedAnalysisData.run.tokensTotal.toLocaleString(),
        },
        {
          key: 'duration',
          label: t('duration'),
          value: formatMsAsSeconds(selectedAnalysisData.run.avgTotalTimeMs),
        },
      ];
    }

    return [
      {
        key: 'totalRuns',
        label: t('analysisTotalRuns'),
        value: String(selectedAnalysisData.runCount),
      },
      {
        key: 'totalCases',
        label: t('analysisTotalCases'),
        value: String(selectedAnalysisData.aggregate.totalCases),
      },
      {
        key: 'passRate',
        label: t('passRate'),
        value: formatPercent(selectedAnalysisData.aggregate.passRate),
      },
      {
        key: 'duration',
        label: t('duration'),
        value: formatMsAsSeconds(selectedAnalysisData.aggregate.totalTimeMs),
      },
    ];
  }, [selectedAnalysisData, t]);
  const selectedAnalysisScoreBuckets = useMemo(() => {
    if (!selectedAnalysisJudgeSummary) return [] as Array<{ key: string; label: string; value: number; color: string }>;
    return [
      {
        key: 'excellent',
        label: t('analysisScoreBucketExcellent'),
        value: selectedAnalysisJudgeSummary.scoreBuckets.excellent,
        color: '#10b981',
      },
      {
        key: 'good',
        label: t('analysisScoreBucketGood'),
        value: selectedAnalysisJudgeSummary.scoreBuckets.good,
        color: '#22c55e',
      },
      {
        key: 'fair',
        label: t('analysisScoreBucketFair'),
        value: selectedAnalysisJudgeSummary.scoreBuckets.fair,
        color: '#f59e0b',
      },
      {
        key: 'poor',
        label: t('analysisScoreBucketPoor'),
        value: selectedAnalysisJudgeSummary.scoreBuckets.poor,
        color: '#ef4444',
      },
      {
        key: 'unknown',
        label: t('analysisScoreBucketUnknown'),
        value: selectedAnalysisJudgeSummary.scoreBuckets.unknown,
        color: '#64748b',
      },
    ];
  }, [selectedAnalysisJudgeSummary, t]);
  const selectedAnalysisScoreRingStyle = useMemo<CSSProperties>(() => {
    const total = selectedAnalysisScoreBuckets.reduce((sum, item) => sum + item.value, 0);
    if (total <= 0) {
      return { background: '#334155' };
    }

    let cursor = 0;
    const stops: string[] = [];
    for (const item of selectedAnalysisScoreBuckets) {
      if (!item.value) continue;
      const start = (cursor / total) * 360;
      cursor += item.value;
      const end = (cursor / total) * 360;
      stops.push(`${item.color} ${start}deg ${end}deg`);
    }

    if (stops.length === 0) {
      return { background: '#334155' };
    }

    return { background: `conic-gradient(${stops.join(', ')})` };
  }, [selectedAnalysisScoreBuckets]);
  useEffect(() => {
    setAnalysisCompareTab('models');
  }, [selectedAnalysisReport?.id]);
  const analysisPayloadPreview = useMemo(
    () => (analysisDraft ? buildAnalysisPayload(analysisDraft, analysisDeepMode) : null),
    [analysisDraft, analysisDeepMode]
  );
  const analysisPayloadPreviewText = useMemo(
    () => (analysisPayloadPreview ? JSON.stringify(analysisPayloadPreview, null, 2) : ''),
    [analysisPayloadPreview]
  );
  const handleCopyAnalysisPreview = useCallback(async () => {
    if (!analysisPayloadPreviewText) return;
    try {
      await navigator.clipboard.writeText(analysisPayloadPreviewText);
      setAnalysisPreviewCopied(true);
      showToast('success', tCommon('copied'));
      window.setTimeout(() => setAnalysisPreviewCopied(false), 1600);
    } catch (error) {
      showToast('error', getErrorMessage(error));
    }
  }, [analysisPayloadPreviewText, showToast, tCommon]);
  const getAnalysisReportTitle = useCallback(
    (report: EvaluationAnalysisReport) => {
      const defaultTitle = report.scope === 'single' ? t('singleRunAnalysis') : t('multiRunAnalysis');
      if (!report.title) return defaultTitle;

      const trimmedTitle = report.title.trim();
      if (!trimmedTitle) return defaultTitle;

      // Backward-compatible: localize legacy auto-generated titles from older formats.
      const singleMatch = /^(?:Single Run)\s*[:：]\s*(.+)$/i.exec(trimmedTitle);
      if (singleMatch) {
        const label = singleMatch[1]?.trim();
        if (!label) return defaultTitle;
        return t('analysisAutoTitleSingle', { label });
      }

      const multiMatch = /^(?:Multi Run)\s*[:：]\s*(.+)$/i.exec(trimmedTitle);
      if (multiMatch) {
        const rawLabel = multiMatch[1]?.trim();
        const legacyCountMatch = rawLabel ? /^(\d+)\s*(?:runs?)?$/i.exec(rawLabel) : null;
        const label = legacyCountMatch
          ? t('analysisRunCount', { count: Number(legacyCountMatch[1]) })
          : rawLabel || t('analysisRunCount', { count: Math.max(report.runIds.length, 2) });
        return t('analysisAutoTitleMulti', { label });
      }

      if (trimmedTitle === 'analysisAutoTitleSingle' || ['Single-Run Analysis'].includes(trimmedTitle)) {
        return t('analysisAutoTitleSingle', { label: defaultTitle });
      }

      if (trimmedTitle === 'analysisAutoTitleMulti' || ['Multi-Run Analysis'].includes(trimmedTitle)) {
        return t('analysisAutoTitleMulti', {
          label: t('analysisRunCount', { count: Math.max(report.runIds.length, 2) }),
        });
      }

      return report.title;
    },
    [t]
  );

  const openRenameAnalysisModal = () => {
    if (!selectedAnalysisReport || !isSelectedEvaluationOwner) return;
    setRenameAnalysisTitle(selectedAnalysisReport.title || '');
    setRenameAnalysisModalOpen(true);
  };

  const closeRenameAnalysisModal = () => {
    if (analysisReportMutating) return;
    setRenameAnalysisModalOpen(false);
    setRenameAnalysisTitle('');
  };

  const handleRenameAnalysisReport = async () => {
    if (!selectedEvaluation || !selectedAnalysisReport) return;

    setAnalysisReportMutating(true);
    try {
      const updated = await evaluationAnalysisReportsApi.updateTitle(selectedEvaluation.id, selectedAnalysisReport.id, {
        title: renameAnalysisTitle.trim() || null,
      });
      setAnalysisReports((prev) => prev.map((report) => (report.id === updated.id ? updated : report)));
      setSelectedAnalysisReportId(updated.id);
      setRenameAnalysisModalOpen(false);
      setRenameAnalysisTitle('');
      showToast('success', t('analysisUpdated'));
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setAnalysisReportMutating(false);
    }
  };

  const handleDeleteAnalysisReport = async (report: EvaluationAnalysisReport) => {
    if (!selectedEvaluation) return;
    if (!confirm(t('analysisDeleteConfirm'))) return;

    setAnalysisReportMutating(true);
    try {
      await evaluationAnalysisReportsApi.delete(selectedEvaluation.id, report.id);
      setAnalysisReports((prev) => {
        const next = prev.filter((item) => item.id !== report.id);
        setSelectedAnalysisReportId((current) => (current === report.id ? (next[0]?.id ?? null) : current));
        return next;
      });
      setRenameAnalysisModalOpen(false);
      setRenameAnalysisTitle('');
      showToast('success', t('analysisDeleted'));
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setAnalysisReportMutating(false);
    }
  };

  const openPublishModal = (options?: { fromShareModal?: boolean }) => {
    if (!selectedEvaluation || selectedEvaluation.isPublic) return;
    setReturnToShareAfterPublishModalClose(!!options?.fromShareModal);
    setPublishShareAttachments(!!selectedEvaluation.shareAttachments);
    setPublishModal({ evaluationId: selectedEvaluation.id, step: 'confirm' });
  };

  const closePublishModal = () => {
    if (publishing) return;
    const shouldReturnToShare =
      returnToShareAfterPublishModalClose && publishModal?.step === 'confirm';
    setPublishModal(null);
    setPublishShareAttachments(false);
    setReturnToShareAfterPublishModalClose(false);
    if (shouldReturnToShare) {
      void openPrivateShareModal();
    }
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

  const openPrivateShareModal = async () => {
    if (!selectedEvaluation) return;
    setPrivateShareModalOpen(true);
    setPrivateShareLoading(true);
    setPrivateSharePassword('');
    try {
      const result = await shareApi.listLinks({
        resourceType: 'evaluation',
        resourceId: selectedEvaluation.id,
        includeRevoked: false,
        page: 1,
        pageSize: 1,
      });
      const link = result.data[0] ?? null;
      setPrivateShareLink(link);
      setHasPrivateShareLink(link !== null);
      setPrivateShareExpirePreset(link ? getShareExpirePreset(link.expiresAt) : '30d');
      setPrivateSharePasswordMode(link?.hasPassword ? 'custom' : 'none');
    } catch (error) {
      showToast('error', getErrorMessage(error));
      setPrivateShareLink(null);
      setHasPrivateShareLink(false);
      setPrivateShareExpirePreset('30d');
      setPrivateSharePasswordMode('none');
    } finally {
      setPrivateShareLoading(false);
    }
  };

  const closePrivateShareModal = (options?: { force?: boolean }) => {
    if (privateShareSaving && !options?.force) return;
    setPrivateShareModalOpen(false);
    setPrivateShareLink(null);
    setPrivateShareExpirePreset('30d');
    setPrivateSharePasswordMode('none');
    setPrivateSharePassword('');
  };

  const handleCreatePrivateShareLink = async () => {
    if (!selectedEvaluation) return;

    if (privateSharePasswordMode === 'custom' && !privateSharePassword.trim() && !privateShareLink?.hasPassword) {
      showToast('error', tCommon('privateSharePasswordRequired'));
      return;
    }

    let shouldCloseModal = false;
    setPrivateShareSaving(true);
    try {
      const expiresAt = buildExpiresAtByPreset(privateShareExpirePreset);
      const password = privateSharePassword.trim();
      const updated = privateShareLink
        ? await shareApi.updateLink(privateShareLink.id, {
            allowCopy: true,
            expiresAt,
            ...(privateSharePasswordMode === 'none' ? { clearPassword: true } : {}),
            ...(privateSharePasswordMode !== 'none' && password ? { password } : {}),
          })
        : await shareApi.createLink({
            resourceType: 'evaluation',
            resourceId: selectedEvaluation.id,
            allowCopy: true,
            expiresAt,
            ...(privateSharePasswordMode !== 'none' && password ? { password } : {}),
          });

      setPrivateShareLink(updated);
      setHasPrivateShareLink(true);
      setPrivateShareExpirePreset(getShareExpirePreset(updated.expiresAt));
      setPrivateSharePasswordMode(updated.hasPassword ? 'custom' : 'none');
      setPrivateSharePassword('');

      const shareUrl = new URL(`/share/e/${updated.token}`, window.location.origin).toString();
      await navigator.clipboard.writeText(shareUrl);
      showToast('success', tCommon('privateShareCreatedAndCopied'));
      shouldCloseModal = true;
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setPrivateShareSaving(false);
      if (shouldCloseModal) {
        closePrivateShareModal({ force: true });
      }
    }
  };

  const handleCopyPrivateEvaluationShareUrl = async () => {
    if (!privateShareEvaluationUrl) return;
    try {
      await navigator.clipboard.writeText(privateShareEvaluationUrl);
      showToast('success', tCommon('linkCopied'));
    } catch {
      showToast('error', t('copyFailed'));
    }
  };

  const handleDisablePrivateShareLink = async () => {
    if (!privateShareLink || privateShareSaving) return;
    let shouldCloseModal = false;
    setPrivateShareSaving(true);
    try {
      await shareApi.revokeLink(privateShareLink.id);
      setPrivateShareLink(null);
      setHasPrivateShareLink(false);
      setPrivateShareExpirePreset('30d');
      setPrivateSharePasswordMode('none');
      setPrivateSharePassword('');
      showToast('success', tCommon('linkShareDisabled', { defaultValue: '已关闭链接分享' }));
      shouldCloseModal = true;
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setPrivateShareSaving(false);
      if (shouldCloseModal) {
        closePrivateShareModal({ force: true });
      }
    }
  };

  const shareChoiceButtonClass = (active: boolean) =>
    `px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
      active
        ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200 shadow-sm light:border-cyan-300 light:bg-cyan-50 light:text-cyan-700'
        : 'border-slate-700/70 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:bg-slate-800 light:border-slate-200 light:bg-white light:text-slate-600 light:hover:border-slate-300 light:hover:bg-slate-50'
    }`;

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
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 light:text-slate-400" />
                <input
                  type="text"
                  value={evaluationQuery}
                  onChange={(e) => setEvaluationQuery(e.target.value)}
                  placeholder={t('searchEvaluations')}
                  aria-label={t('searchEvaluations')}
                  className="w-full h-8 pl-7 pr-2 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-md text-xs text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <select
                value={evaluationStatusFilter}
                onChange={(e) => setEvaluationStatusFilter(e.target.value as EvaluationStatus | 'all')}
                aria-label={t('status')}
                className="shrink-0 h-8 min-w-[90px] px-2 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-md text-xs text-slate-200 light:text-slate-800 focus:outline-none focus:border-cyan-500"
              >
                <option value="all">{tCommon('all')}</option>
                <option value="pending">{t('pending')}</option>
                <option value="running">{t('running')}</option>
                <option value="completed">{t('completed')}</option>
                <option value="failed">{t('failed')}</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" className="h-8 w-full" onClick={openImportModal}>
                <Upload className="w-4 h-4" />
                <span>{tCommon('import')}</span>
              </Button>
              <Button size="sm" className="h-8 w-full" onClick={() => setShowNewEval(true)}>
                <Plus className="w-4 h-4" />
                <span>{t('newEvaluation')}</span>
              </Button>
            </div>
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
            <div className="flex-shrink-0 p-5 pb-0 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl font-semibold text-white light:text-slate-900">
                        {selectedEvaluation.name}
                      </h2>
                      {isSelectedEvaluationOwner ? (
                        <>
                          <button
                            onClick={startEditingName}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/70 light:border-slate-200 bg-slate-900/50 light:bg-white text-slate-400 light:text-slate-500 hover:text-cyan-300 light:hover:text-cyan-600 hover:border-cyan-500/40 light:hover:border-cyan-300 transition-colors"
                            title={tCommon('edit')}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        </>
                      ) : null}
                      {isSelectedEvaluationOwner ? (
                        <button
                          type="button"
                          onClick={() => void openPrivateShareModal()}
                          disabled={submittingNewVersion}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700/60 light:border-slate-200 bg-slate-900/50 light:bg-slate-50 px-2 py-1 transition-colors hover:border-cyan-400/50 hover:bg-slate-800/80 light:hover:border-cyan-300 light:hover:bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                              selectedEvaluation.isPublic
                                ? 'bg-emerald-500/20 text-emerald-200 light:bg-emerald-100 light:text-emerald-700'
                                : 'bg-cyan-500/20 text-cyan-200 light:bg-cyan-100 light:text-cyan-700'
                            }`}
                          >
                            {selectedEvaluation.isPublic ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      <span>{selectedEvaluation.isPublic ? t('public') : tCommon('onlyMeVisible', { defaultValue: '仅我可见' })}</span>
                          </span>
                          {hasPrivateShareLink && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-200 light:bg-amber-100 light:text-amber-700">
                              <Link className="w-3.5 h-3.5" />
                              <span>{tCommon('linkAccessEnabled', { defaultValue: '已开启链接分享' })}</span>
                            </span>
                          )}
                        </button>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700/60 light:border-slate-200 bg-slate-900/50 light:bg-slate-50 px-2 py-1">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                              selectedEvaluation.isPublic
                                ? 'bg-emerald-500/20 text-emerald-200 light:bg-emerald-100 light:text-emerald-700'
                                : 'bg-cyan-500/20 text-cyan-200 light:bg-cyan-100 light:text-cyan-700'
                            }`}
                          >
                            {selectedEvaluation.isPublic ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      <span>{selectedEvaluation.isPublic ? t('public') : tCommon('onlyMeVisible', { defaultValue: '仅我可见' })}</span>
                          </span>
                          {hasPrivateShareLink && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-200 light:bg-amber-100 light:text-amber-700">
                              <Link className="w-3.5 h-3.5" />
                              <span>{tCommon('linkAccessEnabled', { defaultValue: '已开启链接分享' })}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-sm text-slate-500 light:text-slate-400 mt-1">
                    {t('createdAt')} {formatDateTime(selectedEvaluation.createdAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
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

                  {isSelectedEvaluationOwner && (
                    <Button
                      variant="secondary"
                      onClick={() => void handleExportEvaluationSet()}
                      loading={exportEvaluationSetLoading}
                      disabled={submittingNewVersion}
                    >
                      <Download className="w-4 h-4" />
                      <span>{t('exportEvaluationSet')}</span>
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

              <Collapsible
                title={t('evaluationConfig')}
                defaultOpen={true}
                className="!overflow-visible"
                action={
                  <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 light:text-slate-600">
                    {selectedPrompt && (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        {selectedPrompt.name} <span className="text-cyan-500 light:text-cyan-600">v{selectedPrompt.currentVersion}</span>
                      </span>
                    )}
                    {selectedEvaluationModel && (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        {selectedEvaluationModel.modelId}
                      </span>
                    )}
                    {selectedEvaluationJudgeModel && (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        {selectedEvaluationJudgeModel.modelId}
                      </span>
                    )}
                    <span className="inline-flex items-center whitespace-nowrap">
                      {t(`threshold${String(selectedEvaluationPassThreshold * 10)}`)}
                    </span>
                  </div>
                }
                contentClassName="!p-0"
              >
                <div className="p-2.5">
                  <div className="rounded-lg border border-slate-700/60 light:border-slate-200 bg-slate-800/20 light:bg-slate-50/60">
                    <div className="grid grid-cols-1 xl:grid-cols-5 divide-y xl:divide-y-0 xl:divide-x divide-slate-700/50 light:divide-slate-200">
                      <div className="p-3.5">
                        <p className="text-xs text-slate-500 light:text-slate-600 mb-1.5">{t('linkedPrompt')}</p>
                        <PromptCascader
                          value={selectedEvaluation.promptId || null}
                          onChange={(promptId) => void handlePromptChange(promptId)}
                          prompts={prompts}
                          groups={promptGroups}
                          onRefresh={handleRefreshPromptOptions}
                          refreshing={refreshingPromptOptions}
                          disabled={!isSelectedEvaluationOwner}
                          allowClear
                          clearLabel={t('noLinkedPrompt')}
                        />
                        {selectedPrompt && (
                          <p className="text-xs text-cyan-400 light:text-cyan-600 mt-1.5">
                            {t('currentVersion')}: v{selectedPrompt.currentVersion}
                          </p>
                        )}
                      </div>
                      <div className="p-3.5">
                        <div className="flex items-center justify-between mb-1.5">
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
                        {selectedEvaluationModel && (
                          <p className="text-xs text-slate-500 light:text-slate-600 mt-1.5">
                            {t('reproducibleModel')}: {selectedEvaluationModel.provider?.type ? `${selectedEvaluationModel.provider.type}/` : ''}{selectedEvaluationModel.modelId}
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
                        {!!selectedEvaluation.promptId && selectedEvaluation.config.inherited_from_prompt && (
                          <p className="text-xs text-cyan-400 light:text-cyan-600 mt-1">
                            {t('inheritedFromPrompt')}
                          </p>
                        )}
                      </div>
                      <div className="p-3.5">
                        <p className="text-xs text-slate-500 light:text-slate-600 mb-1.5">{t('judgeModel')}</p>
                        <ModelSelector
                          models={models}
                          providers={providers}
                          selectedModelId={selectedEvaluation.judgeModelId || ''}
                          onSelect={(modelId) => handleUpdateEvaluation('judgeModelId', modelId || null)}
                          disabled={!isSelectedEvaluationOwner}
                          placeholder={t('noJudgeModel')}
                        />
                        {selectedEvaluationJudgeModel && (
                          <p className="text-xs text-slate-500 light:text-slate-600 mt-1.5">
                            {t('reproducibleJudgeModel')}: {selectedEvaluationJudgeModel.provider?.type ? `${selectedEvaluationJudgeModel.provider.type}/` : ''}{selectedEvaluationJudgeModel.modelId}
                          </p>
                        )}
                      </div>
                      <div className="p-3.5">
                        <p className="text-xs text-slate-500 light:text-slate-600 mb-1.5">{t('passThreshold')}</p>
                        <Select
                          value={String(selectedEvaluationPassThreshold * 10)}
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
                      <div className="p-3.5">
                        <p className="text-xs text-slate-500 light:text-slate-600 mb-1.5">{t('fileProcessing')}</p>
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
                          <div className="mt-1.5">
                            <Select
                              value={selectedEvaluation.config.ocr_provider || ''}
                              onChange={(e) => handleUpdateConfig('ocr_provider', (e.target.value ? (e.target.value as EvaluationConfig['ocr_provider']) : undefined))}
                              options={evaluationOcrProviderOptions}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Collapsible>

              <div className="border-b border-slate-700 light:border-slate-200">
                <nav className="flex gap-4">
                  <button
                    onClick={() => setActiveTab('testcases')}
                    className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
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
                    className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
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
                    className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
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
                    className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                      activeTab === 'results'
                        ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
                        : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
                    }`}
                  >
                    <BarChart3 className="w-4 h-4" />
                    {t('results')}
                  </button>
                  <button
                    onClick={() => setActiveTab('analysis')}
                    className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                      activeTab === 'analysis'
                        ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
                        : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
                    }`}
                  >
                    <BarChart3 className="w-4 h-4" />
                    {t('analysisReports')}
                  </button>
                </nav>
              </div>
            </div>

            {/* Content - scrollable */}
            <div className="flex-1 overflow-y-auto p-5 pt-2 flex flex-col min-h-0">
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
                    models={models}
                    selectedRunId={selectedRun?.id || null}
                    selectedRunLiveMetrics={selectedRunLiveMetrics}
                    onSelectRun={handleSelectRun}
                    onExportRun={isSelectedEvaluationOwner ? (run) => void handleExportExecutionRecord(run) : undefined}
                    exportingRunId={exportingRunId}
                    onDeleteRun={isSelectedEvaluationOwner ? handleDeleteRun : undefined}
                    onAbortRun={isSelectedEvaluationOwner ? handleAbortRun : undefined}
                    onBatchExport={isSelectedEvaluationOwner ? handleBatchExportExecutionRecords : undefined}
                    batchExporting={batchExporting}
                    onAnalyzeRuns={isSelectedEvaluationOwner ? (selectedRuns) => void handleOpenMultiRunAnalysisFromHistory(selectedRuns) : undefined}
                    onUpdateRunTitle={isSelectedEvaluationOwner ? (runId, title) => handleUpdateRunTitle(runId, title) : undefined}
                    onAnalyzeSelectionLimitReached={(max) => showToast('error', t('analysisSelectionLimitReached', { max }))}
                    maxAnalyzeSelection={20}
                    analyzeSelectionTrigger={runHistoryAnalyzeSelectionTrigger}
                  />
                )}

                {activeTab === 'results' && (
                  <div className="flex-1 min-h-0 flex flex-col gap-3">
                    {results.length > 0 && selectedRun ? (
                      <div className="flex-1 min-h-0 flex flex-col gap-3">
                        <div className="flex flex-wrap lg:flex-nowrap items-center gap-3 p-3 bg-slate-800/30 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
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
                                <span className="text-base font-semibold text-amber-300 light:text-amber-700">
                                  {formatUsdCost(resultsMetrics.costTotal)}
                                </span>
                    <span className="text-xs text-slate-500 light:text-slate-600">{t('cost', { defaultValue: '费用' })}</span>
                              </div>
                              <div className="text-[10px] leading-tight text-slate-500 light:text-slate-600">
                                {formatUsdCostFormula(resultsMetrics.costTotal, resultsMetrics.costInput, resultsMetrics.costOutput)}
                                {!resultsMetrics.hasPricing ? ` · ${t('modelPriceNotConfigured', { defaultValue: '模型价格未配置' })}` : ''}
                              </div>
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
                            {isSelectedEvaluationOwner && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => void handleOpenSingleRunAnalysis()}
                              loading={analysisPreparing}
                            >
                              <BarChart3 className="w-4 h-4" />
                              <span>{t('analyzeCurrentRun')}</span>
                            </Button>
                            )}
                            {isSelectedEvaluationOwner && selectedEvaluation.judgeModelId && criteria.some((c) => c.enabled) && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleRetryAllScores}
                                disabled={
                                  retryingOutputTestCaseId !== null ||
                                  retryingAiEvaluationTestCaseId !== null
                                }
                              >
                                {retryingSelectedRunScores ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Scale className="w-4 h-4" />
                                )}
                                <span>
                                  {retryingSelectedRunScores
                                    ? t('retryScoresRunning', { defaultValue: '重试中...' })
                                    : t('retryScores')}
                                </span>
                              </Button>
                            )}
                            {isSelectedEvaluationOwner &&
                              selectedRun &&
                              selectedRun.status !== 'pending' &&
                              selectedRun.status !== 'running' &&
                              selectedRunErroredCaseIds.length > 0 && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => void handleRetryErroredCases()}
                                  disabled={
                                    retryingOutputTestCaseId !== null ||
                                    retryingAiEvaluationTestCaseId !== null ||
                                    retryingSelectedRunScores
                                  }
                                >
                                  {retryingSelectedRunErroredCases ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <RotateCcw className="w-4 h-4" />
                                  )}
                                  <span>
                                    {retryingSelectedRunErroredCases
                                      ? t('retryErroredCasesRunning', { defaultValue: 'Retrying...' })
                                      : t('retryErroredCases', {
                                        count: selectedRunErroredCaseIds.length,
                                        defaultValue: 'Retry errored cases ({{count}})',
                                      })}
                                  </span>
                                </Button>
                              )}
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => void handleExportExecutionRecord()}
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
                            pricing={selectedRunPricing}
                            ocrProvider={selectedRunOcrProvider}
                            downloadAttachmentBlob={downloadAttachmentBlob}
                            canViewOcrResults={isSelectedEvaluationOwner}
                            onRetryOutput={isSelectedEvaluationOwner ? handleRetryOutput : undefined}
                            onRunAiEvaluation={isSelectedEvaluationOwner && selectedEvaluation.judgeModelId && criteria.some((c) => c.enabled) ? handleRunAiEvaluation : undefined}
                            onUpdateExpectedOutput={isSelectedEvaluationOwner ? handleUpdateExpectedOutputFromResults : undefined}
                            onAbortRetryOutput={isSelectedEvaluationOwner ? handleAbortRetryOutput : undefined}
                            onAbortAiEvaluation={isSelectedEvaluationOwner ? handleAbortAiEvaluation : undefined}
                            retryingOutputTestCaseId={retryingOutputTestCaseId}
                            retryingAiEvaluationTestCaseId={retryingAiEvaluationTestCaseId}
                            retryOutputRefreshTick={retryOutputRefreshTick}
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
                    )}
                  </div>
                )}

                {activeTab === 'analysis' && (
                  <div className="flex-1 min-h-0 flex flex-col gap-3">
                    {analysisRunning && (
                      <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5 light:bg-cyan-50/70">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-cyan-200 light:text-cyan-800 flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>{t('analysisRunningBannerTitle')}</span>
                          </div>
                          <div className="text-xs text-slate-400 light:text-slate-600 mt-1 truncate">
                            {analysisTaskMeta
                              ? t('analysisRunningBannerMeta', {
                                  scope: analysisTaskMeta.scope === 'single' ? t('singleRunAnalysis') : t('multiRunAnalysis'),
                                  label: analysisTaskMeta.runLabel,
                                })
                              : '-'}
                          </div>
                          <div className="text-xs text-slate-500 light:text-slate-600 mt-0.5">
                            {analysisRunPhase === 'saving' ? t('analysisRunningSaving') : t('analysisRunningGenerating')}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!analysisModalOpen && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setAnalysisModalOpen(true)}
                            >
                              <span>{t('analysisOpenTask')}</span>
                            </Button>
                          )}
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={handleAbortAnalysis}
                            disabled={analysisRunPhase === 'saving' || !analysisAbortControllerRef.current}
                            title={analysisRunPhase === 'saving' ? t('analysisAbortDisabledWhileSaving') : undefined}
                          >
                            <StopIndicator label={t('abort')} />
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="flex-1 min-h-0 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                      <div className="flex flex-col gap-3 rounded-xl border border-slate-700/60 light:border-slate-200 bg-slate-900/30 light:bg-white p-3 shadow-sm min-h-0">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">
                            {t('analysisReports')} ({analysisReports.length})
                          </h3>
                          {isSelectedEvaluationOwner && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={handleOpenAnalysisEntry}
                              loading={analysisPreparing}
                              disabled={runs.length === 0}
                            >
                              <BarChart3 className="w-4 h-4" />
                              <span>{t('newAnalysisReport')}</span>
                            </Button>
                          )}
                        </div>

                        {analysisReportsLoading ? (
                          <div className="flex-1 flex items-center justify-center text-slate-500 light:text-slate-600 text-sm">
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            {tCommon('loading')}
                          </div>
                        ) : analysisReports.length === 0 ? (
                          <div className="flex-1 flex items-center justify-center text-slate-500 light:text-slate-600 text-sm border border-dashed border-slate-700 light:border-slate-300 rounded-lg">
                            {t('noAnalysisReports')}
                          </div>
                        ) : (
                          <div className="space-y-2 overflow-y-auto pr-1 min-h-0">
                            {analysisReports.map((report) => {
                              const isActive = selectedAnalysisReport?.id === report.id;
                              return (
                                <button
                                  key={report.id}
                                  type="button"
                                  onClick={() => setSelectedAnalysisReportId(report.id)}
                                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                                    isActive
                                      ? 'border-cyan-500/50 bg-cyan-500/10'
                                      : 'border-slate-700 light:border-slate-200 bg-slate-800/40 light:bg-white hover:bg-slate-800/60 light:hover:bg-slate-50'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs text-slate-300 light:text-slate-700 font-medium truncate">
                                      {getAnalysisReportTitle(report)}
                                    </span>
                                    <Badge variant={report.scope === 'single' ? 'info' : 'warning'}>
                                      {report.scope === 'single' ? t('singleRunAnalysis') : t('multiRunAnalysis')}
                                    </Badge>
                                  </div>
                                  <p className="text-[11px] text-slate-500 light:text-slate-600 mt-1">
                                    {formatDateTime(report.createdAt)}
                                  </p>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-3 rounded-xl border border-slate-700/60 light:border-slate-200 bg-slate-900/30 light:bg-white p-3 shadow-sm min-h-0">
                        {selectedAnalysisReport ? (
                          <>
                            <div className="flex items-center justify-between gap-3 pb-2 border-b border-slate-700/60 light:border-slate-200">
                              <div>
                                <div className="text-sm text-slate-200 light:text-slate-800 font-medium">
                                  {getAnalysisReportTitle(selectedAnalysisReport)}
                                </div>
                                <div className="text-xs text-slate-500 light:text-slate-600 mt-1">
                                  {t('analyzeModel')}: {selectedAnalysisReport.analysisModelName || selectedAnalysisReport.analysisModelId}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {isSelectedEvaluationOwner && (
                                  <>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={openRenameAnalysisModal}
                                      disabled={analysisReportMutating}
                                    >
                                      <Pencil className="w-4 h-4" />
                                      <span>{t('analysisRename')}</span>
                                    </Button>
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      onClick={() => void handleDeleteAnalysisReport(selectedAnalysisReport)}
                                      disabled={analysisReportMutating}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                      <span>{tCommon('delete')}</span>
                                    </Button>
                                  </>
                                )}
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => handleExportAnalysisReport(selectedAnalysisReport)}
                                >
                                  <Download className="w-4 h-4" />
                                  <span>{t('exportMarkdown')}</span>
                                </Button>
                              </div>
                            </div>

                            {/* Data source bar */}
                            <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/40 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg text-xs flex-wrap">
                              <span className="text-slate-500 light:text-slate-600 whitespace-nowrap">{t('analysisDataSource')}:</span>
                              {selectedAnalysisReport.runIds.map((runId) => {
                                const run = runs.find((r) => r.id === runId);
                                return (
                                  <span key={runId} className="font-mono text-slate-400 light:text-slate-600 px-1.5 py-0.5 bg-slate-900/50 light:bg-white border border-slate-700 light:border-slate-200 rounded">
                                    {run ? getRunDisplayTitle(run) : runId.slice(0, 8)}
                                  </span>
                                );
                              })}
                              <span className="text-slate-500 light:text-slate-600">路</span>
                              <span className="text-slate-400 light:text-slate-600">
                                {selectedAnalysisReport.runIds.length === 1 ? t('singleRunAnalysis') : t('multiRunAnalysis')}
                              </span>
                              {selectedAnalysisReport.runIds.length === 1 && runs.some((r) => r.id === selectedAnalysisReport.runIds[0]) && (
                                <button
                                  onClick={() => {
                                    const targetRun = runs.find((r) => r.id === selectedAnalysisReport.runIds[0]);
                                    if (targetRun) {
                                      setSelectedRun(targetRun);
                                      setActiveTab('results');
                                    }
                                  }}
                                  className="ml-auto text-cyan-400 light:text-cyan-600 hover:text-cyan-300 light:hover:text-cyan-700 flex items-center gap-1 whitespace-nowrap"
                                >
                                  <BarChart3 className="w-3 h-3" />
                                  {t('viewRunResults')}
                                </button>
                              )}
                            </div>

                            <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
                              {selectedAnalysisData && (
                                <>
                                  <section className="space-y-3">
                                    <h4 className="text-xs font-semibold tracking-wide text-slate-400 light:text-slate-600 uppercase">
                                      {t('analysisVisualOverview')}
                                    </h4>
                                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                      {selectedAnalysisTopStats.map((stat) => (
                                        <div
                                          key={stat.key}
                                          className="rounded-lg border border-slate-700/70 light:border-slate-200 bg-slate-800/40 light:bg-slate-50/70 px-3 py-2"
                                        >
                                          <div className="text-[11px] text-slate-500 light:text-slate-600">
                                            {stat.label}
                                          </div>
                                          <div className="text-sm font-semibold text-slate-100 light:text-slate-900 mt-1">
                                            {stat.value}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </section>

                                  <section className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
                                    <div className="rounded-lg border border-slate-700/70 light:border-slate-200 bg-slate-900/20 light:bg-white p-3 space-y-3">
                                      <div className="flex items-center justify-between gap-2">
                                        <h4 className="text-sm font-medium text-slate-200 light:text-slate-800">
                                          {t('analysisComparisonTitle')}
                                        </h4>
                                        {selectedAnalysisComparisonMixed && (
                                          <Badge variant="warning">{t('analysisComparisonMixedHint')}</Badge>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        {comparisonTabs.map((tab) => (
                                          <button
                                            key={tab}
                                            type="button"
                                            onClick={() => setAnalysisCompareTab(tab)}
                                            className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                                              analysisCompareTab === tab
                                                ? 'border-cyan-500/70 bg-cyan-500/15 text-cyan-200 light:text-cyan-700'
                                                : 'border-slate-700 light:border-slate-200 text-slate-400 light:text-slate-600 hover:text-slate-200 light:hover:text-slate-800'
                                            }`}
                                          >
                                            {getCompareTabLabel(tab, t)}
                                          </button>
                                        ))}
                                      </div>
                                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                                        {selectedAnalysisComparisonItems.length === 0 ? (
                                          <div className="text-xs text-slate-500 light:text-slate-600 border border-dashed border-slate-700 light:border-slate-300 rounded-md p-3">
                                            {tCommon('noData')}
                                          </div>
                                        ) : (
                                          selectedAnalysisComparisonItems.map((item) => (
                                            <div
                                              key={item.key}
                                              className="rounded-md border border-slate-700/70 light:border-slate-200 bg-slate-800/40 light:bg-slate-50/60 p-2.5 space-y-2"
                                            >
                                              <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                  <div className="text-sm text-slate-100 light:text-slate-900 font-medium truncate">
                                                    {item.label}
                                                  </div>
                                                  {item.secondaryLabel && (
                                                    <div className="text-[11px] text-slate-500 light:text-slate-600 truncate mt-0.5">
                                                      {item.secondaryLabel}
                                                    </div>
                                                  )}
                                                </div>
                                                <Badge variant="info">{t('analysisRunCount', { count: item.runCount })}</Badge>
                                              </div>
                                              <div className="grid grid-cols-3 gap-2 text-[11px]">
                                                <div className="rounded bg-slate-900/60 light:bg-white/80 px-2 py-1 border border-slate-700/60 light:border-slate-200">
                                                  <div className="text-slate-500 light:text-slate-600">{t('passRate')}</div>
                                                  <div className="text-slate-200 light:text-slate-900 font-medium mt-0.5">
                                                    {formatPercent(item.passRate)}
                                                  </div>
                                                </div>
                                                <div className="rounded bg-slate-900/60 light:bg-white/80 px-2 py-1 border border-slate-700/60 light:border-slate-200">
                                                  <div className="text-slate-500 light:text-slate-600">{t('analysisAvgScoreNormalized')}</div>
                                                  <div className="text-slate-200 light:text-slate-900 font-medium mt-0.5">
                                                    {item.avgScoreNormalized === null ? '-' : formatPercent(item.avgScoreNormalized)}
                                                  </div>
                                                </div>
                                                <div className="rounded bg-slate-900/60 light:bg-white/80 px-2 py-1 border border-slate-700/60 light:border-slate-200">
                                                  <div className="text-slate-500 light:text-slate-600">{t('duration')}</div>
                                                  <div className="text-slate-200 light:text-slate-900 font-medium mt-0.5">
                                                    {formatMsAsSeconds(item.avgTotalTimeMs)}
                                                  </div>
                                                </div>
                                              </div>
                                              <div className="space-y-1.5">
                                                <div className="flex items-center justify-between text-[10px] text-slate-500 light:text-slate-600">
                                                  <span>{t('passRate')}</span>
                                                  <span>{formatPercent(item.passRate)}</span>
                                                </div>
                                                <div className="h-1.5 rounded-full bg-slate-700/70 light:bg-slate-200 overflow-hidden">
                                                  <div
                                                    className="h-full rounded-full bg-cyan-500"
                                                    style={{ width: `${clampPercent(item.passRate)}%` }}
                                                  />
                                                </div>
                                                <div className="flex items-center justify-between text-[10px] text-slate-500 light:text-slate-600">
                                                  <span>{t('analysisAvgScoreNormalized')}</span>
                                                  <span>
                                                    {item.avgScoreNormalized === null ? '-' : formatPercent(item.avgScoreNormalized)}
                                                  </span>
                                                </div>
                                                <div className="h-1.5 rounded-full bg-slate-700/70 light:bg-slate-200 overflow-hidden">
                                                  <div
                                                    className="h-full rounded-full bg-emerald-500"
                                                    style={{ width: `${clampPercent(item.avgScoreNormalized)}%` }}
                                                  />
                                                </div>
                                              </div>
                                            </div>
                                          ))
                                        )}
                                      </div>
                                      <div className="text-xs text-slate-500 light:text-slate-600 border-t border-slate-700/70 light:border-slate-200 pt-2">
                                        {t('analysisRecommendedForTab', {
                                          tab: getCompareTabLabel(analysisCompareTab, t),
                                          value: getRecommendedValue(analysisCompareTab, selectedAnalysisRecommended, t),
                                        })}
                                      </div>
                                    </div>

                                    <div className="rounded-lg border border-slate-700/70 light:border-slate-200 bg-slate-900/20 light:bg-white p-3 space-y-3">
                                      <h4 className="text-sm font-medium text-slate-200 light:text-slate-800">
                                        {t('analysisJudgeSummaryTitle')}
                                      </h4>
                                      {selectedAnalysisJudgeSummary ? (
                                        <>
                                          <div className="flex items-center gap-3">
                                            <div className="relative w-24 h-24 rounded-full" style={selectedAnalysisScoreRingStyle}>
                                              <div className="absolute inset-2 rounded-full bg-slate-900 light:bg-white border border-slate-700/60 light:border-slate-200 flex items-center justify-center text-center">
                                                <div>
                                                  <div className="text-[10px] text-slate-500 light:text-slate-600">{t('score')}</div>
                                                  <div className="text-sm font-semibold text-slate-100 light:text-slate-900">
                                                    {selectedAnalysisJudgeSummary.averageScoreNormalized === null
                                                      ? '-'
                                                      : formatPercent(selectedAnalysisJudgeSummary.averageScoreNormalized)}
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                            <div className="flex-1 space-y-1.5">
                                              {selectedAnalysisScoreBuckets.map((bucket) => (
                                                <div key={bucket.key} className="flex items-center justify-between text-xs">
                                                  <span className="flex items-center gap-1.5 text-slate-400 light:text-slate-700">
                                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: bucket.color }} />
                                                    {bucket.label}
                                                  </span>
                                                  <span className="text-slate-200 light:text-slate-900 font-medium">
                                                    {bucket.value}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                          <div className="grid grid-cols-2 gap-2 text-xs">
                                            <div className="rounded border border-slate-700/70 light:border-slate-200 p-2">
                                              <div className="text-slate-500 light:text-slate-600">{t('analysisEvaluatedCases')}</div>
                                              <div className="text-slate-100 light:text-slate-900 font-medium mt-1">
                                                {selectedAnalysisJudgeSummary.evaluatedCases}
                                              </div>
                                            </div>
                                            <div className="rounded border border-slate-700/70 light:border-slate-200 p-2">
                                              <div className="text-slate-500 light:text-slate-600">{t('analysisUnevaluatedCases')}</div>
                                              <div className="text-slate-100 light:text-slate-900 font-medium mt-1">
                                                {selectedAnalysisJudgeSummary.unevaluatedCases}
                                              </div>
                                            </div>
                                            <div className="rounded border border-slate-700/70 light:border-slate-200 p-2">
                                              <div className="text-slate-500 light:text-slate-600">{t('analysisErrorCases')}</div>
                                              <div className="text-slate-100 light:text-slate-900 font-medium mt-1">
                                                {selectedAnalysisJudgeSummary.errorCases}
                                              </div>
                                            </div>
                                            <div className="rounded border border-slate-700/70 light:border-slate-200 p-2">
                                              <div className="text-slate-500 light:text-slate-600">{t('analysisFeedbackCoverage')}</div>
                                              <div className="text-slate-100 light:text-slate-900 font-medium mt-1">
                                                {formatPercent(selectedAnalysisJudgeSummary.feedbackCoverage)}
                                              </div>
                                            </div>
                                          </div>
                                        </>
                                      ) : (
                                        <div className="text-xs text-slate-500 light:text-slate-600 border border-dashed border-slate-700 light:border-slate-300 rounded-md p-3">
                                          {tCommon('noData')}
                                        </div>
                                      )}
                                    </div>
                                  </section>

                                  <section className="rounded-lg border border-slate-700/70 light:border-slate-200 bg-slate-900/20 light:bg-white p-3 space-y-3">
                                    <h4 className="text-sm font-medium text-slate-200 light:text-slate-800">
                                      {t('analysisRecommendedSetupTitle')}
                                    </h4>
                                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 text-xs">
                                      <div className="rounded border border-slate-700/70 light:border-slate-200 p-2">
                                        <div className="text-slate-500 light:text-slate-600">{t('targetModel')}</div>
                                        <div className="text-slate-100 light:text-slate-900 font-medium mt-1">
                                          {selectedAnalysisRecommended?.model?.modelName || selectedAnalysisRecommended?.model?.modelId || '-'}
                                        </div>
                                      </div>
                                      <div className="rounded border border-slate-700/70 light:border-slate-200 p-2">
                                        <div className="text-slate-500 light:text-slate-600">{t('linkedPrompt')}</div>
                                        <div className="text-slate-100 light:text-slate-900 font-medium mt-1">
                                          {selectedAnalysisRecommended?.prompt
                                            ? `${selectedAnalysisRecommended.prompt.promptName || selectedAnalysisRecommended.prompt.promptId || '-'}${
                                              typeof selectedAnalysisRecommended.prompt.promptVersion === 'number'
                                                ? ` v${selectedAnalysisRecommended.prompt.promptVersion}`
                                                : ''
                                            }`
                                            : '-'}
                                        </div>
                                      </div>
                                      <div className="rounded border border-slate-700/70 light:border-slate-200 p-2">
                                        <div className="text-slate-500 light:text-slate-600">{t('exportOcrProvider')}</div>
                                        <div className="text-slate-100 light:text-slate-900 font-medium mt-1">
                                          {selectedAnalysisRecommended
                                            ? getOcrProviderLabel(t, selectedAnalysisRecommended.ocrProvider?.ocrProvider ?? null)
                                            : '-'}
                                        </div>
                                      </div>
                                      <div className="rounded border border-slate-700/70 light:border-slate-200 p-2">
                                        <div className="text-slate-500 light:text-slate-600">{t('judgeModel')}</div>
                                        <div className="text-slate-100 light:text-slate-900 font-medium mt-1">
                                          {selectedAnalysisRecommended?.judgeModel?.judgeModelName ||
                                            selectedAnalysisRecommended?.judgeModel?.judgeModelId ||
                                            t('noJudgeModel')}
                                        </div>
                                      </div>
                                    </div>
                                    {selectedAnalysisRecommended ? (
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant={getRiskVariant(selectedAnalysisRecommended.strategy.riskLevel)}>
                                          {t('analysisRecommendedRisk')} {getRiskLabel(selectedAnalysisRecommended.strategy.riskLevel, t)}
                                        </Badge>
                                        {selectedAnalysisRecommended.strategy.prioritizeStability && (
                                          <Badge variant="warning">{t('analysisPrioritizeStability')}</Badge>
                                        )}
                                        {selectedAnalysisRecommended.strategy.prioritizeLatency && (
                                          <Badge variant="info">{t('analysisPrioritizeLatency')}</Badge>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="text-xs text-slate-500 light:text-slate-600">
                                        {t('analysisNoRecommendation')}
                                      </div>
                                    )}

                                    {selectedAnalysisComparabilityWarnings.length > 0 && (
                                      <div className="space-y-2">
                                        <div className="text-xs text-slate-400 light:text-slate-600">
                                          {t('analysisComparabilityWarnings')}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                          {selectedAnalysisComparabilityWarnings.map((warning) => (
                                            <Badge key={warning} variant="warning">
                                              {warning}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </section>
                                </>
                              )}

                              <div className={selectedAnalysisData ? 'border-t border-slate-700/60 light:border-slate-200 pt-3' : ''}>
                                <MarkdownRenderer content={selectedAnalysisSummaryMarkdown} />
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-slate-500 light:text-slate-600 text-sm border border-dashed border-slate-700 light:border-slate-300 rounded-lg">
                            {t('selectAnalysisReport')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
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

      <Modal
        isOpen={analysisEntryModalOpen}
        onClose={() => setAnalysisEntryModalOpen(false)}
        title={t('newAnalysisReport')}
        size="md"
      >
        <div className="space-y-3">
          <Button
            className="w-full justify-center"
            variant="secondary"
            onClick={() => void handleStartSingleAnalysisFromEntry()}
            disabled={!selectedRun && runs.length === 0}
          >
            <BarChart3 className="w-4 h-4" />
            <span>{t('analyzeCurrentRun')}</span>
          </Button>
          <Button
            className="w-full justify-center"
            onClick={handleStartMultiAnalysisFromEntry}
            disabled={runs.length < 2}
          >
            <History className="w-4 h-4" />
            <span>{t('multiRunAnalysis')}</span>
          </Button>
          <button
            type="button"
            onClick={handleViewExecutionHistoryFromEntry}
            className="text-xs text-cyan-400 light:text-cyan-600 hover:text-cyan-300 light:hover:text-cyan-700 text-center underline underline-offset-2"
          >
            {t('viewExecutionHistory')}
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={analysisModalOpen}
        onClose={closeAnalysisModal}
        title={t('runAnalysis')}
        size="xl"
      >
        {!analysisDraft ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('analysisPreparing')}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-800/30 light:bg-slate-50 p-3 text-xs text-slate-400 light:text-slate-600">
              <div>{t('analysisScope')}: {analysisDraft.scope === 'single' ? t('singleRunAnalysis') : t('multiRunAnalysis')}</div>
              <div>{t('selectedRunsCount', { count: analysisDraft.runIds.length, max: 20 })}</div>
              <div>{t('currentViewing')} {analysisDraft.runLabel}</div>
              {analysisRunning && (
                <div className="mt-1 text-cyan-300 light:text-cyan-700">
                  {analysisRunPhase === 'saving' ? t('analysisRunningSaving') : t('analysisRunningGenerating')}
                </div>
              )}
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-slate-50 px-3 py-2 text-sm text-slate-300 light:text-slate-700">
              <Checkbox
                checked={analysisDeepMode}
                onChange={(event) => setAnalysisDeepMode(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{t('deepAnalysisMode')}</span>
                <span className="block text-xs text-slate-500 light:text-slate-600 mt-0.5">
                  {t('deepAnalysisModeHint')}
                </span>
              </span>
            </label>

            <div>
              <p className="text-sm text-slate-300 light:text-slate-700 mb-2">{t('analyzeModel')}</p>
              <ModelSelector
                models={models}
                providers={providers}
                selectedModelId={analysisModelId}
                onSelect={setAnalysisModelId}
                placeholder={t('selectAnalyzeModelFirst')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
                {t('analysisPrompt')}
              </label>
              <textarea
                value={analysisPrompt}
                onChange={(event) => setAnalysisPrompt(event.target.value)}
                className="w-full h-36 px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
            </div>

            <div>
              <details className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-slate-50">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('scriptAnalysisPreview')}
                </summary>
                <div className="px-3 pb-3">
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void handleCopyAnalysisPreview();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 light:border-slate-300 px-2 py-1 text-xs text-slate-300 light:text-slate-700 hover:bg-slate-800 light:hover:bg-slate-100 transition-colors"
                    >
                      {analysisPreviewCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{analysisPreviewCopied ? tCommon('copied') : tCommon('copy')}</span>
                    </button>
                  </div>
                  <pre className="max-h-64 overflow-auto rounded-lg border border-slate-700 light:border-slate-200 bg-slate-950/60 light:bg-white p-3 text-xs text-slate-300 light:text-slate-700">
                    {analysisPayloadPreviewText}
                  </pre>
                </div>
              </details>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-slate-700 light:border-slate-200">
              {analysisRunning ? (
                <>
                  <Button variant="ghost" onClick={moveAnalysisToBackground} disabled={analysisPreparing}>
                    {t('analysisRunInBackground')}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={handleAbortAnalysis}
                    disabled={analysisRunPhase === 'saving' || !analysisAbortControllerRef.current}
                    title={analysisRunPhase === 'saving' ? t('analysisAbortDisabledWhileSaving') : undefined}
                  >
                    <StopIndicator label={t('abort')} />
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" onClick={closeAnalysisModal} disabled={analysisPreparing}>
                    {tCommon('cancel')}
                  </Button>
                  <Button onClick={() => void handleRunAiAnalysis()} loading={analysisRunning} disabled={analysisPreparing}>
                    <BarChart3 className="w-4 h-4" />
                    <span>{t('executeAnalysis')}</span>
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={renameAnalysisModalOpen}
        onClose={closeRenameAnalysisModal}
        title={t('analysisRename')}
        size="md"
      >
        <div className="space-y-4">
          <Input
            label={t('analysisTitle')}
            value={renameAnalysisTitle}
            onChange={(event) => setRenameAnalysisTitle(event.target.value)}
            placeholder={t('analysisTitlePlaceholder')}
            maxLength={200}
            autoFocus
          />
          <div className="flex justify-end gap-3 pt-2 border-t border-slate-700 light:border-slate-200">
            <Button variant="ghost" onClick={closeRenameAnalysisModal} disabled={analysisReportMutating}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={() => void handleRenameAnalysisReport()} loading={analysisReportMutating}>
              {tCommon('save')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={privateShareModalOpen}
        onClose={closePrivateShareModal}
        title={tCommon('shareSettings', { defaultValue: '分享设置' })}
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
        ) : (
          <div className="space-y-4">
            <div className="space-y-3 rounded-2xl border border-slate-700/60 light:border-slate-200 bg-gradient-to-br from-slate-900/60 to-slate-900/30 light:from-white light:to-slate-50 p-5">
              <p className="text-sm font-semibold text-slate-100 light:text-slate-900">
                {tCommon('visibilityScope', { defaultValue: '可见范围' })}
              </p>
              <div className="inline-flex items-center rounded-xl border border-slate-700/70 light:border-slate-200 bg-slate-900/50 light:bg-slate-100 p-1 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedEvaluation || selectedEvaluation.isPublic) return;
                    closePrivateShareModal();
                    openPublishModal({ fromShareModal: true });
                  }}
                  disabled={!selectedEvaluation || selectedEvaluation.isPublic || publishing || submittingNewVersion || privateShareSaving}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    selectedEvaluation?.isPublic
                      ? 'bg-emerald-500/20 text-emerald-200 light:bg-emerald-100 light:text-emerald-700'
                      : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800 light:text-slate-600 light:hover:text-slate-800 light:hover:bg-white'
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>{t('public')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedEvaluation || !selectedEvaluation.isPublic) return;
                    void handleSetEvaluationPrivate();
                  }}
                  disabled={!selectedEvaluation || !selectedEvaluation.isPublic || publishing || submittingNewVersion || privateShareSaving}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    !selectedEvaluation?.isPublic
                      ? 'bg-cyan-500/20 text-cyan-200 light:bg-cyan-100 light:text-cyan-700'
                      : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800 light:text-slate-600 light:hover:text-slate-800 light:hover:bg-white'
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>{tCommon('onlyMeVisible', { defaultValue: '仅我可见' })}</span>
                </button>
              </div>
              <p className="text-xs text-slate-500 light:text-slate-600">
                {selectedEvaluation?.isPublic
                  ? tCommon('publicVisibilityHint', { defaultValue: '公开后将进入广场，其他人可查看并复用。' })
                  : tCommon('privateVisibilityHint', { defaultValue: '仅你自己可见，不会出现在公开广场。' })}
              </p>
            </div>

            <div className="space-y-4 rounded-2xl border border-slate-700/60 light:border-slate-200 bg-gradient-to-br from-slate-900/60 to-slate-900/30 light:from-white light:to-slate-50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-100 light:text-slate-900">
                    {tCommon('linkAccess', { defaultValue: '链接访问' })}
                  </p>
                  <p className="text-xs text-slate-500 light:text-slate-600">
                    {tCommon('linkAccessHint', { defaultValue: '开启后可通过链接访问；可设置有效期和密码。' })}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                    privateShareLink
                      ? 'bg-emerald-500/20 text-emerald-200 light:bg-emerald-100 light:text-emerald-700'
                      : 'bg-slate-700/80 text-slate-200 light:bg-slate-200 light:text-slate-700'
                  }`}
                >
                  {privateShareLink
                    ? tCommon('linkAccessEnabled', { defaultValue: '已开启链接分享' })
                    : tCommon('linkAccessDisabled', { defaultValue: '未开启链接分享' })}
                </span>
              </div>

              {privateShareLink ? (
                <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                  <Input
                    label={tCommon('shareLink')}
                    value={privateShareEvaluationUrl}
                    readOnly
                    className="font-mono text-xs md:text-sm"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleCopyPrivateEvaluationShareUrl()}
                    className="h-10 px-3 shadow-sm border-slate-600/80 hover:border-cyan-400/50 light:border-slate-300 light:hover:border-cyan-300"
                  >
                    <Copy className="w-4 h-4" />
                    <span>{tCommon('copy')}</span>
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-600/70 light:border-slate-300 bg-slate-900/30 light:bg-white p-4 text-sm text-slate-300 light:text-slate-700">
                  {tCommon('linkAccessDisabledHint', { defaultValue: '当前未开启链接访问。点击下方按钮即可创建链接。' })}
                </div>
              )}

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
                      className={shareChoiceButtonClass(privateShareExpirePreset === item.key)}
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
                    className={shareChoiceButtonClass(privateSharePasswordMode === 'none')}
                  >
                    {tCommon('privateSharePasswordNone')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPrivateSharePasswordMode('random');
                      setPrivateSharePassword(generateSharePassword(4));
                    }}
                    className={shareChoiceButtonClass(privateSharePasswordMode === 'random')}
                  >
                    {tCommon('privateSharePasswordRandom')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrivateSharePasswordMode('custom')}
                    className={shareChoiceButtonClass(privateSharePasswordMode === 'custom')}
                  >
                    {tCommon('privateSharePasswordCustom')}
                  </button>
                </div>
                {privateSharePasswordMode !== 'none' && (
                  <Input
                    label={privateShareLink?.hasPassword ? tCommon('privateSharePasswordWithKeep') : tCommon('privateSharePassword')}
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

            <div className="flex justify-end gap-2 pt-1">
              {privateShareLink && (
                <Button
                  variant="secondary"
                  onClick={() => void handleDisablePrivateShareLink()}
                  disabled={privateShareSaving}
                  className="min-w-[132px] border-rose-500/40 text-rose-300 hover:bg-rose-500/15 hover:border-rose-400 light:border-rose-200 light:text-rose-600 light:hover:bg-rose-50"
                >
                  <span>{tCommon('disableLinkShare', { defaultValue: '关闭链接分享' })}</span>
                </Button>
              )}
              <Button className="min-w-[132px]" onClick={() => void handleCreatePrivateShareLink()} loading={privateShareSaving}>
                <Link className="w-4 h-4" />
                <span>
                  {privateShareLink
                    ? tCommon('saveAndCopyLink', { defaultValue: '保存并复制链接' })
                    : tCommon('enableAndCopyLink', { defaultValue: '开启并复制链接' })}
                </span>
              </Button>
            </div>
          </div>
        )}
      </Modal>

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
                    <Checkbox
                      checked={publishModalHasAttachments ? publishShareAttachments : false}
                      disabled={!publishModalHasAttachments}
                      onChange={(e) => setPublishShareAttachments(e.target.checked)}
                      className="mt-0.5"
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

      <Modal isOpen={showImportEval} onClose={() => setShowImportEval(false)} title={t('importDialogTitle')}>
        <div className="space-y-4">
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3">
            <p className="text-sm font-medium text-cyan-200 light:text-cyan-700">{t('importGuideTitle')}</p>
            <p className="mt-1 text-xs text-slate-300 light:text-slate-700">{t('importGuideDesc')}</p>
            <div className="mt-3">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleDownloadImportTemplate()}
                loading={importTemplateDownloading}
              >
                <Download className="w-4 h-4" />
                <span>{t('downloadImportTemplate')}</span>
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700">{t('importModeLabel')}</label>
            <select
              value={importMode}
              onChange={(e) => {
                const next = e.target.value as 'create' | 'append' | 'overwrite';
                setImportMode(next);
                if (next !== 'create' && !importTargetEvaluationId) {
                  const firstMine = evaluations.find((ev) => currentUserId && ev.userId === currentUserId)?.id || '';
                  setImportTargetEvaluationId(firstMine);
                }
              }}
              className="w-full px-3 py-2 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-md text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:border-cyan-500"
            >
              <option value="create">{t('importModeCreate')}</option>
              <option value="append">{t('importModeAppend')}</option>
              <option value="overwrite">{t('importModeOverwrite')}</option>
            </select>
          </div>

          {importMode !== 'create' && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-300 light:text-slate-700">{t('importTargetEvaluation')}</label>
              <select
                value={importTargetEvaluationId}
                onChange={(e) => setImportTargetEvaluationId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-md text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:border-cyan-500"
              >
                <option value="">{t('importSelectPlaceholder')}</option>
                {evaluations
                  .filter((ev) => currentUserId && ev.userId === currentUserId)
                  .map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                    </option>
                  ))}
              </select>
              {importMode === 'overwrite' && (
                <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200 light:text-amber-700">
                  {t('importOverwriteWarning')}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700">{t('importZipFileLabel')}</label>
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setImportZipFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-200 light:text-slate-800 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-slate-700 file:text-slate-100 hover:file:bg-slate-600 light:file:bg-slate-200 light:file:text-slate-800 light:hover:file:bg-slate-300"
            />
            <p className="text-xs text-slate-500 light:text-slate-600">
              {t('importZipHint')}
            </p>
            {importZipFile && (
              <p className="text-xs text-slate-400 light:text-slate-600">{t('importSelectedFile', { name: importZipFile.name })}</p>
            )}
          </div>

          {importJob && (
            <div className="space-y-2 p-3 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-slate-50">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-200 light:text-slate-800">{t('importProgressTitle')}</p>
                <Badge variant={importJob.status === 'failed' ? 'error' : importJob.status === 'completed' ? 'success' : 'info'}>
                  {t(importJob.status)}
                </Badge>
              </div>
              <div className="text-xs text-slate-400 light:text-slate-600 space-y-1">
                <div>{t('importProgressStage', { stage: getImportStageLabel(readImportProgressString(importJob.progress, 'stage')) })}</div>
                <div>
                  {t('importProgressRows', {
                    processed: readImportProgressNumber(importJob.progress, 'processedRows'),
                    total: readImportProgressNumber(importJob.progress, 'totalRows'),
                    failed: readImportProgressNumber(importJob.progress, 'failedRows'),
                  })}
                </div>
                <div>
                  {t('importProgressAttachments', {
                    success: readImportProgressNumber(importJob.progress, 'successAttachments'),
                    failed: readImportProgressNumber(importJob.progress, 'failedAttachments'),
                    total: readImportProgressNumber(importJob.progress, 'totalAttachments'),
                  })}
                </div>
                {Array.isArray(importJob.errors) && importJob.errors.length > 0 && (
                  <div>
                    {t('importProgressErrors', { count: importJob.errors.length })}
                    <div className="mt-2 max-h-32 overflow-auto space-y-1">
                      {importJob.errors.slice(0, 20).map((err, idx) => (
                        <div key={idx} className="text-slate-500 light:text-slate-700">
                          {formatImportJobError(err)}
                        </div>
                      ))}
                      {importJob.errors.length > 20 && (
                        <div className="text-slate-500 light:text-slate-700">{t('importProgressErrorsLimit', { count: 20 })}</div>
                      )}
                    </div>
                  </div>
                )}
                {importJob.status === 'failed' && importJob.errorMessage && (
                  <div className="text-red-300 light:text-red-700">{t('importFailureReason', { reason: importJob.errorMessage })}</div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-700 light:border-slate-200">
            <Button variant="ghost" onClick={() => setShowImportEval(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              onClick={() => void handleStartZipImport()}
              loading={importSubmitting}
              disabled={
                importSubmitting ||
                !importZipFile ||
                (importMode !== 'create' && !importTargetEvaluationId) ||
                (importJob?.status === 'running' || importJob?.status === 'pending')
              }
            >
              <Upload className="w-4 h-4" />
              <span>{tCommon('import')}</span>
            </Button>
          </div>
        </div>
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
            onRefresh={handleRefreshPromptOptions}
            refreshing={refreshingPromptOptions}
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

      {/* 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻橀弻锝夊箣濠垫劖缍楅梺閫炲苯澧柛濠傛健楠炴劖绻濋崘顏嗗骄闂佸啿鎼鍥╃矓椤旈敮鍋撶憴鍕８闁告梹鍨甸锝夊醇閺囩偟顓哄┑鐘绘涧閻楀啴宕戦幘娲绘晣闁绘垵妫欑€靛矂姊洪棃娑氬闁硅櫕鍔楃划缁樺鐎涙鍘藉┑掳鍊愰崑鎾翠繆椤愶絿绠炴鐐插暣閹瑩宕崟顐も偓顓烆渻閵堝棗濮夊┑顔肩－閼鸿鲸绻濆顓涙嫼闂佽崵鍠撴晶妤呭箚閸喍绻嗘い鎰剁秵濞堟洜绱掗崒姘毙х€规洘绮忛ˇ瀵哥棯閹佸仮闁哄本鐩獮妯何旈埀顒€螞濞嗘搩鏁佹俊銈呮噺閳锋垿鏌涘☉姗堝姛闁瑰啿鍟撮弻娑㈡偄閸涘﹦绋囬梺浼欑到閸㈣尙鍙呭銈呯箰鐎氼噣宕濋敃鈧—鍐Χ閸℃鐟愰梻鍌氬缁夌數绮嬪鍜佺叆闁割偆鍠撻崢鐢告⒑缂佹ê鐏﹂柨姘舵煟韫囧鍔﹂柡灞界Х椤т線鏌涢幘鏉戝摵妤犵偛鍟村畷鎺戭潩鏉堛劍顔曢梻渚€娼х换鍡涘箠閸ヮ剙纾婚柟鍓х帛閸嬨劑鏌ｉ姀銏犱化闁逞屽墮閿曨亪寮诲☉姘ｅ亾閿濆骸浜濋悘蹇曟暬閺岀喖宕ｆ径瀣攭閻庤娲滈崰鏍€佸Δ鍛＜婵°倓鐒﹀▍鏍磽閸屾艾鈧悂宕愰幖浣哥９闁告縿鍎抽惌鎾垛偓瑙勬礀濞层劑鎯岄崱妞尖偓鎺戭潩閿濆懍澹曢梻浣筋嚃閸ｏ絿绮婚弽顓炵畺婵犲﹤鐗婄€电姴顭跨捄铏圭劸闁哥偞妞藉缁樻媴閻戞ê娈岄梺瀹︽澘濡兼い顐㈢箺閵囨劙骞掗悙鐢碘棨闁诲骸绠嶉崕閬嶅箠婢舵劕缁╁ù鐘差儐閻撶喖鏌熼柇锕€澧紒鐙欏嫨浜滈柕澹啩妲愰梺鍝勬湰閻╊垰顕ｉ鈧獮姗€宕滄担瑙勵啌闂佽姘﹂～澶娒洪敃鍌氬瀭闁割偅娲栭弰銉╂煃瑜滈崜姘跺Φ閸曨垰绠抽柟瀛樼箥娴犻箖姊洪幎鑺ユ暠閻㈩垽绻濆璇测槈濮橆偅鍕冮梺纭咁潐閸旀洟藟濠靛鈷戦梺顐ゅ仜閼活垱鏅舵导瀛樼厱闊洦妫戦懓鎸庮殽閻愭彃鏆ｉ柟顔界懇閹粌螣缂佹褰囬梻鍌欑窔閳ь剛鍋涢懟顖涙櫠閹绢喗鐓冮柕澶樺灣閻ｇ數鈧娲栫紞濠囥€佸▎鎾澄ㄧ憸宥夊几濞戙垺鐓欓柧蹇ｅ亞婢х敻鏌涢埡瀣瘈鐎规洘锕㈤、鏃堝礋椤愩儱濮岄梻鍌氬€搁崐鎼佸磹妞嬪海鐭嗗ù锝呮贡閻濊泛鈹戦悩鍙夋悙缁炬儳顭烽弻娑樷槈閸楃偛笑闂佸憡绻傜€氬嘲顭囬妸鈺傜厓鐟滄粓宕滃▎鎾村仼?Modal */}
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




