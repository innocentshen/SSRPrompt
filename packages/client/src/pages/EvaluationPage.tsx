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
  Link,
  Search,
} from 'lucide-react';
import { Button, Input, Modal, Badge, Select, Checkbox, useToast, ModelSelector, MarkdownRenderer, Collapsible } from '../components/ui';
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
    /["']?\bscore\b["']?\s*(?:[:：=]|is)\s*([+-]?\d+(?:\.\d+)?(?:\s*(?:\/|／)\s*(?:10|100))?%?)/i,
    /(?:评分|分数|得分)\s*(?:[:：=]|为)\s*([+-]?\d+(?:\.\d+)?(?:\s*(?:\/|／)\s*(?:10|100))?%?)/,
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

  const quotedReason = text.match(
    /["']?(?:reason|feedback|comment|理由|说明)["']?\s*(?:[:：=]|is|为)\s*(["'])([\s\S]*?)\1/i
  );
  if (quotedReason?.[2]) {
    const value = quotedReason[2].trim();
    if (value) return value;
  }

  const plainReason = text.match(
    /["']?(?:reason|feedback|comment|理由|说明)["']?\s*(?:[:：=]|is|为)\s*([^\n\r}]+)/i
  );
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

  const scoreObjectRegex = /\{[\s\S]*?["']?(?:score|评分|分数)["']?[\s\S]*?\}/g;
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
  const scoreKeys = ['score', '评分', '分数'];
  const reasonKeys = ['reason', '理由', '说明', 'feedback', 'comment'];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

      let score: number | null = null;
      for (const key of ['score', '评分', '分数', ...scoreKeys]) {
        score = normalizeJudgeScore(parsed[key]);
        if (score !== null) break;
      }
      if (score === null) continue;

      let reason = '';
      for (const key of ['reason', '理由', '说明', 'feedback', 'comment', ...reasonKeys]) {
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

// 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ゆ繝鈧柆宥呯疅闁归棿鐒﹂崑瀣煕椤愶絿绠橀柣鐔村妿缁辨挻鎷呴崫鍕戯繝鏌涘Δ浣糕枙鐎殿喖顭烽幃銏ゅ礂鐏忔牗瀚介梺璇叉捣閺佹悂鈥﹂崼鐔剁箚濞寸姴顑嗛埛鎴犵磼鐎ｎ偒鍎ラ柛搴＄Ч閺屾稒绻濋崘顏嗙杽閻庢鍠栭…宄邦嚕閹绢喗鍋勯柧蹇氼嚃閸熷酣姊绘担铏瑰笡闁告棑绠撳畷婊冾潩閼搁潧浠ч梺鍝勫暙閻楀﹪鍩涢幋锔界厱婵犻潧妫楅鎾煕鎼粹剝鎹ｇ紒杈ㄥ浮閹虫粓妫冨☉妯绘嚈闁诲孩顔栭崰鏍€﹂悜钘夋瀬闁圭増婢樺婵嬫煕鐏炲墽鈯曟い銉ョ墦閺屾盯鍩為幆褌澹曞┑锛勫亼閸婃牜鏁幒鏂哄亾濮樼厧寮€规洘鍨归埀顒婄秵閸犳鎮￠弴銏＄厓闁宠桨绀侀弳鐔兼煙閸愬弶鍤囬柡宀嬬秮椤㈡﹢鎮欓棃娑掑徍闂備礁鎼悮顐﹀礉閹存繍鍤曟い鎺戝閸ㄥ倹銇勯弮鍥舵綈閻庡灚鐗滅槐鎾存媴閸濆嫪澹曢梺绋垮婵炲﹤鐣烽妷褉鍋撻敐搴℃灈濡楀懘姊洪崨濠冨闁搞劍澹嗙划璇测槈閵忥紕鍘撻柡澶屽仦婢瑰棝藝閿曗偓閳规垿顢欓懖鈺佺厽濠殿喖锕ュ浠嬬嵁閺嶎厽鍊锋繛鏉戭儏娴滈箖鏌″搴″箺闁稿绻濋弻宥夊传閸曨剙娅ｉ梺钘夊暟閸犳牠寮婚妸銉㈡斀闁糕剝锕╁Λ锟犳⒑缁嬫寧鎹ｉ柛鐘崇墵瀵濡搁妷銏℃杸闂佺硶鍓濋敋婵炲拑绲借灃闁绘﹢娼ф禒婊勩亜閹存繍妲告い顐㈢箻閹粌螣鐠囧樊娼梻浣筋潐椤旀牠宕抽鍢夛綁顢欓崜褏锛濇繛杈剧到婢瑰﹤危濞差亝鐓欓柧蹇ｅ亝瀹曞矂鏌熼鈧粻鏍箖濠婂牊鍤嶉柕澶堝劙缁ㄧ敻姊洪悷鏉挎倯闁诡垰鐭傚畷鏉款潩鐠鸿櫣鐓戦梺绯曞墲缁嬫帡鍩涢幋锔界厱婵炴垶锕妤冪磼閸洑鎲鹃柡灞剧洴婵℃悂鍩￠埀顒勫箟閸撗€鍋撶憴鍕；闁告濞婇悰顕€骞掗幊铏⒐閹峰懘宕ｆ径濠庝紲濠电姷鏁搁崑鐘诲箵椤忓棗绶ゅù鐘差儏缁犵喖鏌ㄩ悢鍝勑㈤柣銈庡櫍閺岋綁骞囬鐓庡闂佺粯鎸鹃崰鎰┍婵犲洤围闁告洦鍘兼俊鐣岀磽娴ｆ彃浜鹃柣搴秵閸嬫帒鈻撴禒瀣厽闁归偊鍨奸崵瀣煛閳ь剚绻濆顓犲幍濡炪倖鐗楃粙鎺椝夐崼婵冩斀闁斥晛鍟崐鎰攽閿涘嫭鐒挎い锔芥尦閺岋繝宕遍弴鐐茬ギ濠殿喖锕︾划顖炲箯閸涱垳鐭欐繛鍡欏亾椤ユ垿姊绘担渚劸妞ゆ垵瀚▎銏狀潩椤掑倹娈鹃梺鍝勬储閸ㄥ綊鎷戦悢鍏肩厪濠㈣泛鐗嗛崝銈夋煕濮椻偓娴滆泛顫忓ú顏勪紶闁告洦鍋呭▓顓㈡⒑缂佹﹩娈旈柨鏇ㄤ邯楠炲啴鏁撻悩鎻掑祮闂侀潧楠忕槐鏇㈠储閹间焦鈷戦柟鑲╁仜閸旀﹢鏌涙惔銈夊摵濞ｅ洤锕幖褰掑捶椤撶媴绱查梻渚€娼ч…鍫ュ磿闁秴绠栭柟杈鹃檮閻撳繘鏌涢妷鎴濆枤娴煎啫螖閻橀潧浠滄繛宸弮閵嗕線寮崼婵嗚€垮┑鐐叉閸ㄧ敻鐛崱娑欌拻闁稿本鐟чˇ锕傛煙绾板崬浜伴柟顖氭湰瀵板嫮浠﹂幆褍绨ユ繝鐢靛█濞佳兾涘☉銏犳辈闁挎洖鍊归悡娆撴煟閹寸伝顏堟倿閻愵剛绠鹃悘蹇旂墬濞呭棝鏌曢崶褍顏鐐搭焽閹瑰嫰鎯勯幒瀣姦闁哄本绋戦～婊堝幢濡も偓椤亞绱撴担铏瑰笡缂佽鐗撻獮鍐╃鐎ｎ偒妫冨┑鐐村灦椤ㄥ牓骞戦弴鐔虹瘈缁剧増蓱椤﹪鏌涚€ｎ亜顏柡灞斤躬閺佹劙宕ㄩ娑欘啎闁荤喐绮庢晶妤冩暜濡ゅ啠鍋撻悽闈浶㈡い顓炴健閹虫粌顕ュΔ濠佺盎闁崇粯鎹囨俊鎼佸煛閸屾瀚兼繝娈垮枤閹虫挸煤閵堝鍊堕柍杞扮贰閻斿棝鏌ｉ悢宄扮盎闂婎剦鍓涢埀顒侇問閸ｎ噣宕戞繝鍌滄殾闁绘梻鈷堥弫宥嗙箾閹寸伝濂稿礌閺嶎厽鈷掑ù锝囩摂閸ゅ啴鏌涘Ο鍏兼珪闁轰緡鍣ｉ獮鎺楀箻閼碱剛鐣鹃梻浣稿閻撳牓宕抽纰辩劷濞寸厧鐡ㄩ悡鏇㈡煏婢舵ê鏋涘褜鍨堕弻宥夋煥鐎ｎ亞鐟ㄩ梻鍥ь樀閺屻劌鈹戦崱妯侯槱闂佹悶鍊愰崑鎾翠繆閻愵亜鈧牕煤濡厧鍨濋幖杈剧稻椤洟鏌熼悜妯荤厸闁稿鎹囬弫鎰償閳ヨ尙鐩庨梻浣筋嚙妤犲繑淇婇崶鈺傤潟闁圭儤鎸绘慨婊堟煙濞堝灝鏋ら柣鎾存崌閹鈻撻崹顔界彯闂侀潻缍囩徊浠嬫偩閻戣棄绠抽柟鎼幗閸嶉潧顪冮妶鍡楃瑨闁稿﹦鍏樺畷?fileId 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊椤掑鏅悷婊冪箻閸┾偓妞ゆ帊鑳堕埢鎾绘煛閸涱垰鈻堥柕鍡曠閳诲酣骞橀崘鎻掓暏婵＄偑鍊栭幐楣冨磻閻斿吋鍋橀柕澶堝劗閺€浠嬪箳閹惰棄纾归柟鐗堟緲绾惧鏌熼崜褏甯涢柛瀣€块弻鏇㈠醇濠靛浂妫ょ紓浣叉閸嬫挸鈹戦悩鍨毄濠殿喗鎸冲畷鎰磼濡粯鐝烽梺鍝勬储閸ㄦ椽鎮″☉銏″€甸柨婵嗗€瑰▍鍥╃磼閹邦厽顥堥柡宀嬬磿娴狅箓鎮欓鍌ゆЧ闁诲氦顫夊ú婊堝储瑜旈崺鐐哄箣閿曗偓缁犳稒銇勯幘绛圭础闁搞儯鍔夐幏娲⒑閸涘﹦绠撻悗姘煎幗閸掑﹥绺介崨濠勫幈闂佽鍎抽顓灻洪幘顔界厱闁宠鍎虫禍鐐繆閻愵亜鈧牕顔忔繝姘；闁瑰墽绮悡鏇熶繆椤栨繂鍚归柣顓熷笧閳ь剝顫夊ú姗€宕归崸妤冨祦婵☆垵鍋愮壕鍏间繆椤栨粌甯舵鐐茬墦濮婄粯鎷呴崨濠冨創濠电偛鐪伴崹钘夌暦濠靛牃鍋撻敐搴″⒉濠殿喗濞婇弻锝夋晲閸涱垳浼囩紒鐐劤閵堢顕ｉ崼鏇為唶婵炴垶锚椤牓姊洪崨濠勭畼闁稿簺鍊濋獮鍫ュΩ閿斿墽鐦堥梺鍛婁緱閸ｎ喗绂掗埡鍐＝濞撴艾娲ら弸鐔兼煟閻旀繂娲ょ粻鏌ユ煕閺囥劌鐏犻幆鐔兼偡濠婂嫮鐭掔€规洦鍓熷畷婊勬媴閾忕櫢绱抽梻浣侯焾閺堫剟鎮疯钘濋柨鏂款潟娴滄粓鏌ㄩ弬璺ㄤ虎鐎规挸妫欓〃銉╂倷閺夋垵顫掗悗瑙勬礃閿曘垽骞婇悩娲绘晢濞达綀顕栭崯搴♀攽閿涘嫬浜奸柛濠冪墱閺侇噣骞掑Δ鈧壕褰掓煟閵忋埄鐒剧痪鎯ь煼閺岀喖宕滆鐢盯鏌涚€ｃ劌濮傞柡宀嬬秮婵偓闁靛繒濮抽崠鏍⒑闁偛鑻晶顕€鏌ㄩ弴銊ら偗鐎殿喛顕ч埥澶婎潩閿濆懍澹曢梺鎸庣箓妤犲憡绂嶅┑瀣€堕煫鍥风到瀵噣鏌＄仦鐣屝ч柟绋匡攻瀵板嫬螣閹稄绠撳铏光偓鍦閸ゆ瑥螖閻樺磭鎽冮柣蹇斿浮濮婅櫣绱掑Ο璇茬婵°倗濮撮幉锟犳偤韫囨洜纾介柛灞捐壘閳ь剚鎮傚畷鎰板箹娴ｅ摜锛欓悗鐟板閸ｇ銇愰幒鎴犲€炲銈嗗笒椤︿即寮查鍫熷仭婵犲﹤瀚悡銉╂煟閿濆洤鍘存い銏＄洴閹粓宕卞Ο缁樼彨濠电姵顔栭崰妤呪€﹂崶顒€鍌ㄧ憸宥夊煝閹炬椿鏁冮柨鏃囆掗幏娲⒑閸涘﹦鈽夐柨鏇樺劜瀵板嫰宕熼娑氬幈闂佹寧绻傛鎼佸几濞戞瑣浜滄い鎺嗗亾闁挎洦浜妴渚€寮崼婵嗚€垮┑鐐叉閸╁﹦妲?
interface EvaluationCacheData {
  testCases: TestCase[];
  criteria: EvaluationCriterion[];
  runs: EvaluationRun[];
  results: TestCaseResult[];
  selectedRunId: string | null;
}

// 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌熼梻瀵割槮缁炬儳顭烽弻锝呂熷▎鎯ф缂備胶濮撮悘姘跺Φ閸曨喚鐤€闁圭偓鎯屽Λ銈囩磽娴ｆ彃浜炬繝鐢靛Т濞诧箓鎮￠崘顏呭枑婵犲﹤鐗嗙粈鍫熸叏濡潡鍝虹€规洖寮剁换娑㈠箣閻愬灚鍣х紓浣稿閸嬨倝骞冨Δ鍛櫜閹肩补鈧尙鏁栨俊鐐€х紓姘跺础閹惰棄绠栨俊銈傚亾闁崇粯鎹囧畷褰掝敊閻ｅ苯钂嬮梻鍌欒兌椤牓顢栭崨瀛樻櫇闁靛濡囬埞宥呪攽閻樺弶澶勯柛銈咁儔濮婂宕奸悢鎭掆偓鎺旂磼閹邦喖浠︾紒缁樼箞閹粙妫冨ù韬插灲閹顫濋鈧Σ濠氬础閸楃伝褰掓偂鎼达絾鎲奸梺鎶芥敱鐢帡婀侀梺鎸庣箓閹冲繘宕悙鐑樼厱闁绘柨鎼禒婊堟煏閸℃ê绗掓い顐ｇ箞椤㈡顦抽柣銈勭窔閹鎲撮崟顒傦紭闂佹悶鍔嶅鑺ヤ繆閸洘鏅插璺猴功椤︺劑姊洪棃娴ゆ稓浠﹂懞銉︾彙闂傚倸鍊搁崐鐑芥嚄閸撲礁鍨濇い鏍亹閳ь剨绠撳畷鍫曨敆閳ь剟寮告笟鈧弻娑樷攽閸曨偄濮庡銈冨劜閼归箖婀侀梺缁樏Ο濠囧磿閹扮増鐓熼柟鎯х摠缁€瀣煙椤旀枻鑰块柟顔界懇楠炴捇骞掗崱妯虹槺闂傚倷鐒﹂崜姘跺垂閸楃伝娲偄閻撳海鐣哄┑鈽嗗灥濞夋洟鎮块埀顒勬⒑閹稿海绠撻柟鍐叉捣閻氭儳顓兼径瀣ф嫼闂佸憡绻傜€氼噣鎮炵捄銊х＜闁哄被鍎抽悾娲煟濞戝崬鏋熺紒缁樼箞瀹曞爼濡歌楠炲牓姊绘担鍛婃儓闁哥喓濞€瀹曟垿骞樼紒妯煎幈闂侀潧顭堥崕铏閵徛颁簻闁哄浂浜炵粔顔姐亜閵忊剝绀嬪┑顔瑰亾闂佸疇妗ㄩ悞锕傚磹椤栫偞鈷掑ù锝堫潐閸嬬娀鏌涙惔鈽嗙吋婵﹣绮欏畷鐔碱敍濮橀硸妲归梻浣告啞閸旓箓宕板Δ鍛厱闁硅揪闄勯悡鏇㈢叓閸ャ劏澹樺ù婊冪秺閺屾洟宕奸悢绋垮攭闂佸搫鐭夌换婵嗙暦閵娾晩鏁婇柛鎾楀懏婢栧┑掳鍊楁慨鐑藉磻濞戔懞鍥箮閽樺）锕傛煙閻楀牊绶茬紒鐘冲▕閺岀喓绱掗姀鐘典画闁?localStorage闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌ｉ幋锝呅撻柛濠傛健閺屻劑寮崼鐔告闂佺顑嗛幐鍓у垝椤撶偐妲堟俊顖濐嚙濞呇囨⒑濞茶骞楅柣鐔叉櫊瀵鎮㈤崨濠勭Ф婵°倧绲介崯顖烆敁瀹ュ鈷戠紒瀣儥閸庡繑銇勯幋婵愭█鐎殿喖顭烽幃銏ゅ礂閻撳簶鍋撻柨瀣ㄤ簻闁瑰搫妫楁禍鐐節閳封偓鐏炵晫浠搁梺鍝勭焿缁查箖骞嗛弮鍫澪ч柛娑卞灠鐢潡姊绘笟鈧褍煤閵堝洠鍋撳顓熺凡妞ゆ洩缍侀、姘跺焵椤掆偓閻ｇ兘骞掗幋鏃€顫嶅┑鐐叉閸ㄩ潧鈽夎閳规垿鏁嶉崟顐℃澀闂佺锕ラ崝娆忣嚕閹绘巻鏀介悗锝庝簽椤ρ冣攽椤斿浠滈柛瀣尵閳ь剚顔栭崰鏍€﹂柨瀣╃箚闁割偅娲栭悙濠囨煃閸濆嫬鏆熼柛姗嗗灦濮婃椽鎳￠妶鍛咃絽霉濠娾偓缁瑥鐣峰┑鍫氬亾閿濆骸澧柛銊︾箞濮婂宕奸悢琛℃灁闂佽　鍋撳ù鐘差儐閻撶喖鏌熼柇锕€鐏犻柣銊ユ惈椤儻顦虫繛鑼枛瀵鏁愭径濠傚敤閻熸粌顑夊畷鎴﹀閳垛晛浜炬繛鍫濈仢閺嬫稒銇勯鐘插幋妤犵偛鍟存慨鈧柕鍫濇閳ь剛绮穱濠囶敍濠靛浂浠╅悷婊呭閹稿啿顫忕紒妯诲闁告繂瀚紓鎾绘⒑缁嬪灝顒㈡繛鍏肩懇閸┿垹顓兼径濠傚祮闂侀潧绻嗛埀顒佹灱閸嬫捇宕奸弴鐔哄幈濡炪倖鍔楁慨鎾礉濠婂牊鐓冮梺鍨儏閻忓瓨鎱ㄦ繝鍌ょ吋鐎规洖銈搁幃銏㈡偘閳ユ剚娼撻梻鍌欒兌閹虫捇宕ョ€ｎ喖绀夋繛鍡樻尭閽冪喖鏌曟繛鐐珔闁告娅曟穱濠囶敍濮橆厽鍎撴繝娈垮枛妤犳悂鈥旈崘顔嘉ч柛鈩冾焽閿涙﹢姊虹粙鍧楀弰婵炰匠鍥ㄥ仼闁绘垼濮ら崑鍕棯閹峰矂鍝洪柡鍜佷邯濮婃椽宕ㄦ繝浣虹箒闂侀潻缍嗛崳锝夊春閳ь剚銇勯幒鍡椾壕濡炪倧绠掓禍顒€危?
const evaluationCache = new Map<string, EvaluationCacheData>();

// 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋挎瀬鐎广儱顦粈瀣亜閹哄秶鍔嶆い鏂挎处缁绘繂顕ラ柨瀣凡闁逞屽墯濞茬喖鐛繝鍌滄殕闁告洦鍋嗛崝锕€顪冮妶鍡楀潑闁稿鎹囬弻娑㈡偆娴ｅ摜浠╁銈嗘磸閸庨潧鐣烽悢纰辨晬婵浜弶鍛婁繆閻愵亜鈧牠宕归悢鐓庢闁稿瞼鍋涚壕鍧楁煟閵忋埄鐒鹃柦鍐枑缁绘盯骞嬪▎蹇曚患缂備胶濮甸惄顖炲蓟濞戞粎鐤€闁规儳鐡ㄩ崰鎰版⒑鏉炴壆鍔嶉柣妤佺矌濡叉劙骞掑Δ鈧粻姘辨喐瀹ュ洨绀婇柡宥庡亞绾惧吋銇勯弮鍌涙珪闁瑰啿娲ㄩ埀顒侇問閸犳牠鈥﹂悜钘夌畺闁靛繈鍊栭崑鍌炲箹鏉堝墽鎮奸柡鍡曞嵆閺岋綁鎮㈤崫銉х厐缂備胶绮敃銏狀嚕椤愩埄鍚嬮柛婊€绀侀幃鎴炵節閵忥絾纭炬い鎴濇喘瀹?
interface ListCache {
  evaluations: EvaluationWithRelations[];
  prompts: Prompt[];
  promptGroups: PromptGroup[];
  models: Model[];
  providers: Provider[];
}

let evaluationCacheUserId: string | null = null;
let listCache: ListCache | null = null;
const loadingEvaluations = new Set<string>();  // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ姀鐘差棌闁轰礁锕弻鈥愁吋鎼粹€崇缂備焦鍔栭〃鍡樼┍婵犲洤围闁告侗鍘藉▓鏌ユ倵鐟欏嫭绀冮柣鎿勭節瀵鎮㈤崗鑲╁姺闂佹寧娲嶉崑鎾绘煛鐎ｎ偆銆掔紒杈ㄥ浮閻擃剟骞撻幒鍡椾壕婵犻潧顑呴拑鐔兼煥閺囨浜鹃柧浼欑到閵嗘帒顫濋悡搴ｄ画濡炪倕楠稿Λ婵嗩潖濞差亝鍤冮柍杞扮贰閺嗩參鏌ｆ惔锝囨嚄闁搞儺鐏涢敃鍌涚厱闁哄洢鍔岄弸銈夋煟閵堝倸浜鹃梻鍌欐祰椤鐣峰Ο琛℃灃婵炴埈娼块埀顒€鍊块幖褰掑捶椤撶媴绱冲┑鐐舵彧缁叉崘銇愰崘鈺冾洸闁绘劦鍓涚弧鈧梺闈涢獜缁蹭粙鎮￠幇鐗堢厱闁哄啠鍋撻柣妤冨█楠炲啴鏁撻悩鍐蹭簻闂傚倵鍋撻柟閭﹀枤閻ｇ偓淇婇悙顏勨偓鏍偋濡ゅ啫鍨濈€光偓閳ь剟寮鈧畷濂稿即閻斿搫骞堥梻浣告惈閸婂綊顢栧▎鎾崇？闁瑰濮风壕濂稿级閸稑濡肩紒妤佸哺閺岀喎鐣￠悧鍫濇闂佷紮缍囩换婵嗩嚕閸撲焦宕夐柕濠忕到娴犲繘姊婚崒姘偓椋庣矆娓氣偓楠炴牠顢曢敂钘夊壒婵犮垼娉涢惉鑲╃矆婵犲伅褰掓晲婢跺棗浜炬繛鎴炴皑閻ｉ箖姊绘担鍝ョШ婵☆偉娉曠划鍫熸媴閸涘﹥娈伴梻鍌氬€风欢姘焽瑜旇棟濞寸姴顑呯粣妤呮煛閸モ晛校妞ゎ偅娲熼弻鐔煎礈瑜忕敮娑㈡煃闁垮绗掗棁澶愭煥濠靛棭妯堟俊顐ｅ灥閳藉骞橀悷鎵缂備浇椴哥敮锟犲箖閳哄懎绀冮柤纰卞厸濡楁挻淇婇悙顏勨偓鎴﹀礉婵犲洤纾块柣銏犳憸瀹撲線鏌″鍐ㄥ濠殿垱鎸抽弻娑㈡晜鐠囨彃绠婚梺鍝勬閸ㄥ綊鍩為幋锔藉亹闁割煈鍋呭В鍕節濞堝灝鏋ら柛蹇斆锝夘敃閿曗偓瀹告繂鈹戦悩鎻掓殭鐎殿喖娼″铏圭磼濡櫣浼囧┑鈽嗗亜鐎氼喚鍒掓繝姘兼晬闁绘劙娼цぐ鍕⒑閹肩偛鍔橀柛鏂块叄閸╁﹪寮撮姀锛勫帗闂備礁鐏濋鍛归鈧弻锛勪沪閸撗佲偓鎺懨归悪鍛暤鐎规洘绮忛¨渚€鏌￠崱蹇婂亾閹颁焦瀵岄梺闈涚墕閸燁偊宕濆鍛＜妞ゆ棁鍋愭牎缂備礁鐭佹ご鍝ユ崲濠靛鐐婇柤绋跨仛濞呭洭姊绘担鐟邦嚋缂佽鍊婚埀顒佺▓閺呯娀骞冮幐搴㈠闁?

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
  const [exporting, setExporting] = useState(false);
  const [exportingRunId, setExportingRunId] = useState<string | null>(null);
  const [batchExporting, setBatchExporting] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [submittingNewVersion, setSubmittingNewVersion] = useState(false);
  const [draggedEvaluationId, setDraggedEvaluationId] = useState<string | null>(null);
  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾圭€瑰嫭鍣磋ぐ鎺戠倞鐟滃繘寮抽敃鍌涚厱妞ゎ厽鍨垫禍婵嬫煕濞嗗繒绠婚柡灞稿墲瀵板嫮鈧綆浜濋鍛攽閻愬弶鈻曞ù婊勭矊濞插潡姊绘担瑙勫仩闁稿氦宕靛濠囨嚍閵壯屾锤闂佺粯鍔﹂崜姘跺矗韫囨柧绻嗘い鏍ㄧ矊鐢爼鎮介婵嗙厫妞ゃ劊鍎甸幃娆撳箹椤撶姴濮虹紓鍌欐祰妞村摜鏁敓鐘偓浣糕枎閹寸偛鍘归梺姹囧€ら崹浼村箚閸儲鐓熼幖娣焺閸熷繘鏌涢悩宕囧⒌闁诡喓鍎茬缓浠嬪传閵夈儳銈﹀┑鐘垫暩婵挳宕愭繝姘辈闁挎洖鍊归悡鏇㈡煏婢跺鐏ラ悗姘煎枟缁傚秹顢旈崼鐔叉嫽婵炶揪缍€椤宕戦悩缁樼厱闁哄倽娉曟晥閻庤娲樺ú鐔肩嵁鎼淬劍鍤嶉柕澶堝劙閹綁姊绘担铏瑰笡闁搞劎鍘ц灋闁告洦鍨遍崐宄扳攽閻樺弶澶勯柣鎾卞劜缁绘繈妫冨☉娆樻！闂侀潻绲块…鍫モ€︾捄銊﹀枂闁告洦鍓涢ˇ鏉库攽椤旂》榫氭繛鍜冪悼濡叉劙骞掗幊宕囧枛閹煎綊鏌呭☉姘鳖槰婵犵數濮烽。钘壩ｉ崨鏉戠；闁告洦鍘搁崑鎾愁潩椤愩垹绁Δ鐘靛仜濡稒绂掗敂鑺ュ闁圭瀛╅ˉ鍫⑩偓瑙勬磸閸旀垿銆佸▎鎾崇畾鐟滃秶绮婚悙鐑樷拻濞达絿鐡旈崵娆戠磼缂佹ê娴€规洘鍨甸埥澶娾枎閹邦厾褰垮┑鐐差嚟婵挳顢栭崨瀛樺亗闁逞屽墴濮婃椽宕崟顒€绐涢梺鍝ュУ閹稿墽鍒掔紒妯稿亝闁告劏鏅濋崢鍗烆渻閵堝棗濮х紒鑼舵硶缁顫滈埀顒勫蓟濞戙垹鐓涢悗锝庡墰钃遍梻渚€鈧稓鈹掗柛鏂跨Ф閹广垹鈹戠€ｎ亞顦ㄩ梺宕囨嚀閵囨﹢鎼规惔銊︾厽閹兼番鍩勯崯蹇涙煕閻樺磭澧柡鍛板煐閹棃濡搁妷褜鍞归梻浣告啞濞诧箓宕归悧鍫濆姅闂傚倷娴囬～澶嬬珶鐎ｎ喖鐤炬繛鎴欏灩閻掑灚銇勯幒宥堝厡缂佺姷鍋熼埀?
  const [evalModelConfig, setEvalModelConfig] = useState<PromptConfig>(DEFAULT_PROMPT_CONFIG);
  const [showParamsModal, setShowParamsModal] = useState(false);
  const [publishModal, setPublishModal] = useState<{ evaluationId: string; step: 'confirm' | 'done' } | null>(null);
  const [publishShareAttachments, setPublishShareAttachments] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [privateShareModalOpen, setPrivateShareModalOpen] = useState(false);
  const [privateShareLink, setPrivateShareLink] = useState<ShareLink | null>(null);
  const [privateShareExpirePreset, setPrivateShareExpirePreset] = useState<ShareExpirePreset>('30d');
  const [privateSharePasswordMode, setPrivateSharePasswordMode] = useState<'none' | 'random' | 'custom'>('none');
  const [privateSharePassword, setPrivateSharePassword] = useState('');
  const [privateShareLoading, setPrivateShareLoading] = useState(false);
  const [privateShareSaving, setPrivateShareSaving] = useState(false);
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

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋挎瀬闁瑰墽绮崑鎰版煕閹邦剙绾ч柣銈呭閳规垶骞婇柛濞у懎绶ゅù鐘差儏閻ゎ喗銇勯幇鈺佲偓鎰板磻閹炬剚娼╂い鎺戭槹鏁堥梻渚€娼уú銈団偓姘嵆閻涱噣骞掑Δ鈧粻锝嗙節閸偄濮冪紒杈ㄧ箞濮?ref 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌熼梻瀵割槮缁惧墽绮换娑㈠箣濞嗗繒鍔撮梺杞扮椤戝棝濡甸崟顖氱閻犺櫣鍎ら悗楣冩⒑閸涘﹦鎳冪紒缁樺姍濠€渚€姊虹粙璺ㄧ闁告艾顑囩槐鐐哄箣閻樺灚锛忛梺璇″瀻閸曨偂娣梻浣告惈閻ジ宕版惔銊ョ厺闁规崘顕ч崹鍌涖亜閺冨倹娅曞ù婊堢畺濮婄粯鎷呯憴鍕╀户闂佸憡顭堝Λ鍕偩濠靛绠瑰ù锝嗙摃閹芥洖鈹戦悙鏉戠仧闁糕晛瀚板顐﹀礃椤旂晫鍙嗗┑鐘绘涧濡瑩藟閻樼偨浜滈柨鏂挎惈閸旓附鎱ㄦ繝鍐┿仢鐎规洜鍏橀、姗€鎮㈤柨瀣殮闂傚倷鑳剁划顖炴偋閺囥垹围缂佸顑欓崵鏇炩攽閻樺疇澹橀柛妤佸▕閺岋綁寮崶顭戜哗濡炪倖姊瑰ú鐔奉潖濞差亜绀堥柤纰卞墮鐢儵姊洪崫銉バｉ柣妤侇殜楠炲牓濡搁埡渚囨綂闂侀潧绻堥崹濠氭晬濠婂牊鈷戠紓浣姑慨锕傛煕閹惧鎳呯紒顔肩墦瀹曟﹢濡搁姀鈩冩澑婵＄偑鍊栭弻銊╁箹椤愶箑鐒垫い鎺嶈兌缁犵偤鏌ｅ☉鍗炴珝鐎规洖銈告俊鐑藉Ψ鎼存ɑ娅婇柡灞炬礃瀵板嫰宕煎┑鍫滅棯闂備礁鎼崐鐢稿磻閹剧粯鈷掗柛灞剧懅椤︼箓鏌熷ù瀣у亾鐡掍焦妞介弫鍐磼濮樻唻绱遍梻浣告啞濞诧箓宕滃璺虹煑闊洦绋掗悡娑㈡煕閵夛絽鍔氶柣蹇ｄ邯閺屽秹鏌ㄧ€ｎ亞浼岄梺鍝勭焿缂嶄線骞冮姀銏″珰闁肩⒈鍓欐慨娲⒒娴ｄ警鐒炬い鎴濆暣瀹曡绂掔€ｎ亣鎽曢梺璺ㄥ枔婵挳鎮為崹顐犱簻闁圭儤鍨甸顏堟煟閹烘洖浜归柍褜鍓欑粻宥夊磿闁秴绠犻柟浼村亰閺佸﹪鏌涢埄鍐姇闁抽攱鍨块弻娑樷槈濮楀牊顣肩紓浣哥埣娴滃爼寮诲☉妯锋瀻闊洦绋戝浼存⒑鐠団€虫珯缂佺粯绻冩穱濠囨倻閽樺鍘搁梺绋挎湰缁瞼鏁Δ鍛厽闁绘柨鎽滈惌瀣磼椤旇姤灏柣锝呭槻椤劑宕奸悢铚傜盎闂備胶绮幐绋棵归悜鑺ュ仾闁搞儜鈧弨浠嬫煟閹邦剙绾фい銉у仱閺岀喓绮欓幐搴㈠枑缂備緡鍠栭…鐑藉极閹邦厼绶為悗锝庡墮楠炴绻濈喊妯活潑闁搞劋鍗抽獮鏍敃閿曗偓濮规煡寮堕崼娑樺Ω濞存粍绮撻獮鏍庨鈧悘顔界箾閹绘帞鎽犻柟渚垮妽缁绘繈宕ㄩ鍛摋缂傚倷绶￠崰妤€螞閸愩劎鏆﹂柛妤冨€ｉ弮鍫濈劦妞ゆ帒瀚烽弫鍌炴倵濞戞瑯鐒界紒鐘荤畺閺屾盯顢曢妶鍛€剧紓浣插亾閻庯綆鍠楅悡娑㈡倶閻愰鍤欏┑鈥炽偢閺屽秹鎸婃径妯恍﹂梺瀹狀嚙闁帮綁鐛€ｎ亖鏀介柛鎰ㄦ櫅椤忣垶姊婚崒姘偓椋庣矆娓氣偓楠炴牠顢曢敂钘夊壒婵犮垼娉涢張顒€鐣烽崣澶岀瘈闂傚牊绋掗ˉ鐘绘煛閸☆厾鐣甸柡宀嬬秮楠炴﹢宕橀懠顒佇炴繝鐢靛仜閻ㄧ兘寮插鍫澪﹂柛鏇ㄥ灠缁狅絾绻濋棃娑氬闁惧繐楠搁—鍐Χ閸愩劌濮曢悗鍏夊亾缂佸顑欏鏍р攽閻樺疇澹樼痪鎯у悑缁绘盯宕卞Ο铏瑰姼濠碘€虫▕閸ｏ絽顫忓ú顏勬嵍妞ゆ挻绋掔€氭盯姊虹粙娆惧剰闁挎洏鍊濋幃楣冩倻閽樺鐤€濡炪倖妫佸Λ鍕几閸岀偞鈷戦柛娑橈攻婢跺嫰鏌涘Ο璇茬闁靛洦鍔栭妶锝夊礃閳圭偓瀚肩紓鍌欑贰閸ㄥ崬煤閺嶃劍娅犻柡灞诲劜閻撳繘鏌涢妷锝呭婵炴彃顕埀?selectedEvaluation
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

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾圭€瑰嫭鍣磋ぐ鎺戠倞鐟滃繘寮抽敃鍌涚厱妞ゎ厽鍨垫禍婵嬫煕濞嗗繒绠抽柍褜鍓濋～澶娒洪弽顬℃椽鏁冮崒銈嗘櫇婵炲濮撮鍡涙偂韫囨稒鐓曟い鎰剁悼缁犳牕顭跨捄鍝勵仾闁靛洤瀚伴、鏇㈡晲閸℃瑯妲归梻浣告惈閻鎹㈠┑鍡欐殾闁割偅娲栧敮闂侀潧锛忛崒婊勶紡闂傚倸鍊烽懗鍫曗€﹂崼銉晞闁稿瞼鍋涢悿楣冩煟濡鍤欓柦鍐枛閺屻劑鎮㈤崫鍕戙垻绱掗埀顒傗偓锝庡亖娴滄粓鏌熼幍铏珔闁逞屽墯椤ㄥ﹪骞冮崸妤€绀嬫い鎺戝€婚鏇㈡煟鎼淬垻鈯曟い顓炴喘閹本绻濋崟顓狅紳閻庡箍鍎遍幏鎴︾叕椤掑倵鍋撳▓鍨灈妞ゎ厾鍏橀獮鍐閵堝棗浜楅柟鑹版彧缁插潡寮虫导瀛樼厽闁绘柨鎽滈惌濠勭磼婢跺本鍤€妞ゆ洩缍侀幖褰掝敃閿濆洨肖闂備線娼ч…顓犲緤閼测晞濮冲┑鐘崇閳锋垿姊婚崼鐔恒€掑褎娲熼弻鐔煎礃閼碱剛顔掗悗瑙勬礈閺佽鐣烽崼鏇ㄦ晢濞达絽鎼獮宥嗕繆閻愵亜鈧牕螞娓氣偓瀹曟垿骞囬鍓х厠闂佹儳绻愰崢婊堝磻閹捐埖鍠嗛柛鏇ㄥ墰椤︺劑姊虹粙鍧楊€楅柕鍫熺摃濡喖姊洪崨濠勬噧妞わ富鍘界粋宥咁煥閸垹褰勯梺鎼炲劦椤ユ挾鈧絻鍋愮槐鎺楀Ω瑜庡▍鏇犵磼鏉堛劌绗氭繛鐓庣箻婵℃悂濡疯閹虫牠姊绘担鐑樺殌闁搞垺鐓￠獮濠囧箛閺夎法鐤呴梺鍦檸閸犳牜绮堢€ｎ偁浜滈柟鎹愭硾琚ラ梺鍝勵儏缁绘ê顫忕紒妯诲缂佸娉曠粙蹇曠磽娓氣偓绾悂宕板杈潟闁绘劕顕悷褰掓煃瑜滈崜娆擃敋閿濆洦瀚氱€瑰壊鍠栭幃鎴炵節閵忥絾纭剧拫鈺呮煏婵炵偓娅嗛柣鎾崇箰椤法鎷犻垾宕囦哗缂備礁顦晶搴ｅ垝閸喓绡€闁搞儯鍔夐幏缁樼箾閹炬潙鐒归柛瀣崌閺屽秷顧侀柛鎾寸洴瀹曟垵鈽夐姀鈥虫濡炪倖鐗楃粙鎺戔枍閻樿褰掓偂鎼达絾鎲奸梺缁樻尰濞茬喖鎮￠锕€鐐婇柕濠忓瘜濡牠姊洪懖鈺侇暭閻庣瑳鍥モ偓鍐Ψ閳哄倸鈧兘鏌涘▎蹇ｆ▓婵☆偓绠撻幃妤冩喆閸曨剛顦ㄩ梺鎸庢磸閸ㄤ粙濡存担绯曟瀻闁圭偓娼欏▓鎰版⒑閸愬弶鎯堥柨鏇樺劜閺呫儱鈹戦悩娈挎殰缂佽鲸娲熷畷鎴﹀箣閿曗偓绾惧綊鏌″搴′簼闁哄棙绮岄埞鎴︽偐閸欏顦╅梺鎼炲€曠€氫即寮诲☉銏╂晝闁挎繂妫涢ˇ銉╂⒑缂佹ê绗掗柣蹇斿哺婵＄敻宕熼姘鳖唺闂佽鎯岄崢鐣岀懅闂傚倷绀侀幖顐︻敄閸℃稒鍎庢い鏍嚤濞戞瑦濯撮柣鐔稿缁愮偤姊鸿ぐ鎺戜喊闁告﹢绠栧畷銏ゆ寠婢跺棙鏂€闂佸疇妫勫Λ妤呮倶閿熺姵鍊电紒妤佺☉濞诧箓宕戦悢鎼炰簻闊洦鎸炬晶娑㈡煟閹惧娲撮柟顔筋殜閺佹劖鎯斿┑鍫㈡晨婵＄偑鍊曞ù姘跺磻閸℃瑦顫曢柟鐑樻尰缂嶅洭鏌曟繛鍨姢闁荤喆鍔戦弻褏绱掑Ο鐓庘拰闂佸搫鑻粔鐑铰ㄦ笟鈧弻娑㈠箻鐠虹儤鐎婚梺浼欑悼閸忔﹢鐛崶顒€绾ч柟绋块缁佽埖淇婇悙顏勨偓鏍箰閼姐倗鐭欓柟瀵稿仧椤╂彃螖閿濆懎鏆為柍閿嬪浮閺屾盯顢曢妶鍛亖闂佸磭顑曢崐婵嬪蓟濞戞埃鍋撻敐鍐ㄥ闁诲繑鐓￠弻鈥崇暆閳ь剟宕伴弽顓溾偓浣糕枎閹寸偛鏋傞梺鍛婃处閸撴稖銇愮€ｎ喗鐓熼幖娣€ゅ鎰箾鐠囇呯暤鐎规洘鍨剁换婵嬪磼濠婂嫭顔曢梻浣虹帛濮婂鍩涢崼銉ユ瀬闁告劦鍠楅悡蹇涚叓閸パ屽剰闁绘帗妞介弻娑橆潩椤掍礁娈楀┑?
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

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛闁诲氦顫夊ú蹇涘磿閹惰棄鐒垫い鎺戯功缁夌敻鏌涢悩宕囧⒈濠㈣娲熷畷绋课旀担鍝勫箥闂備浇顕栭崹铏櫠濡ゅ惤澶嬪緞閹邦剛顔愰梺鍝勵槹閸╁﹪鐓鍕厸閻忕偠顕ч埀顒佺箞楠炲﹤鈹戠€ｎ亞顓煎銈嗘閸嬫劖鏅堕姘ｆ斀闁绘劘灏欓幗鐘电磼椤旇偐鐏辩紒杈╁仦缁绘繈宕惰閹芥洖鈹戦悙鏉戠仧闁搞劎鎳撻弫顔戒繆閻愵亜鈧牕螞娴ｅ摜鏆﹂柣銏㈩焾濮瑰弶淇婇妶鍕厡缂佺娀绠栭幃妤€鈽夊▎妯煎姺闂佹椿鍘奸敃锔炬閹炬剚鍚嬮柛婊冨暢閸氼偊鎮楀▓鍨灈妞ゎ厾鍏橀獮鍐閵堝棗浜楅柟鑹版彧缁插潡寮虫导瀛樼厽闁绘柨鎽滈惌濠勭磼婢跺本鍤€妞ゆ洩缍侀幖褰掝敃閿濆洨肖闂備線娼ч…顓犲緤閼测晞濮冲┑鐘崇閳锋垿姊婚崼鐔恒€掑褎娲熼弻鐔煎礃閼碱剛顔掗悗瑙勬礈閺佽鐣烽崼鏇ㄦ晢濞达絽鎼獮宥嗕繆閻愵亜鈧牕螞娓氣偓瀹曟垿骞囬鍓х厠闂佹儳绻愰崢婊堝磻閹捐埖鍠嗛柛鏇ㄥ墰椤︺劑姊虹粙鍧楊€楅柕鍫熺摃濡喖姊洪崨濠勬噧妞わ富鍘界粋宥咁煥閸垹褰勯梺鎼炲劦椤ユ挾鈧絻鍋愮槐鎺楀Ω瑜庡▍鏇犵磼鏉堛劌绗氭繛鐓庣箻婵℃悂濡疯閹虫牠姊绘担鐑樺殌闁搞垺鐓￠獮濠囧箛閺夎法鐤呴梺鍦檸閸犳牜绮堢€ｎ偁浜滈柟鎹愭硾琚ラ梺鍝勵儏缁绘ê顫忕紒妯诲缂佸娉曠粙蹇曠磽娓氣偓绾悂宕板杈潟闁绘劕顕悷褰掓煃瑜滈崜娆擃敋閿濆洦瀚氱€瑰壊鍠栭幃鎴炵節閵忥絾纭剧拫鈺呮煏婵炵偓娅嗛柣鎾崇箰椤法鎷犻垾宕囦哗缂備礁顦晶搴ｅ垝閸喓绡€闁搞儯鍔夐幏缁樼箾閹炬潙鐒归柛瀣崌閺屽秷顧侀柛鎾寸洴瀹曟垵鈽夐姀鈥虫濡炪倖鐗楃粙鎺戔枍閻樿褰掓偂鎼达絾鎲奸梺缁樻尰濞茬喖鎮￠锕€鐐婇柕濠忓瘜濡牠姊洪懖鈺侇暭閻庣瑳鍥モ偓鍐Ψ閳哄倸鈧兘鏌涘▎蹇ｆ▓婵☆偓绠撻幃妤冩喆閸曨剛顦ㄩ梺鎸庢磸閸ㄤ粙濡存担绯曟瀻闁圭偓娼欏▓鎰版⒑閸愬弶鎯堥柨鏇樺劜閺呫儱鈹戦悩娈挎殰缂佽鲸娲熷畷鎴﹀箣閿曗偓绾惧綊鏌￠崶鈺佇ｇ€规洘鐓￠弻鐔兼偋閸喓鍑￠梺姹囧€ら崳锝夊蓟閻斿皝鏋旈柛顭戝枟閻忔挻绻涢幋鐐村碍缂佸鏁婚獮鍫ュΩ閵夊海鍠栧畷褰掝敊閹冪細闂傚倷鐒︽繛濠囧绩闁秴鍨傞柛褎顨呯粻鏍喐閻楀牆绗掗柣鎰躬閺屻劌鈹戦崱妞诲亾閸涘﹦顩插Δ锝呭暞閻撴洟鏌熼柇锕€骞栫紒鑼帛閵囧嫰骞掗幘鍓佺厜濠殿喖锕︾划顖炲箯閸涱垱鍠嗛柛鏇ㄥ亗閸濇姊绘担鍛婂暈闁哄被鍔庣划鏃堟偨閸偄搴婂┑鐐村灦閻熝呭姬閳ь剟姊虹粙鑳潶闁稿﹥娲栭埢鎾诲Ω閵夘喗瀵岄梺闈涚墕濡鎱ㄨ缁辨帡鎮╅崘鑼淮濠电偞褰冨鈥愁潖缂佹ɑ濯撮柧蹇撶畭閳ь剙锕弻娑㈠箻鐎靛摜鐤勯梺璇″枤閸忔﹢銆佸☉妯炴帡顢橀悢鎼炰虎濡ょ姷鍋為悧妤呭箯閸涙潙鎹舵い鎾跺仜缁犮儵姊婚崒娆掑厡缂侇噮鍨堕獮鎰矙濡潧缍婇幃婊堟寠婢跺矈鍟堥梻浣虹帛椤洭寮崫銉ヮ棜濠靛倸鎲￠崑锝夋煕閵夛絽濡肩紒鑼帛閵囧嫯绠涢敐鍛睄闂佸搫鐬奸崰鏍€佸▎鎾村仼閻忕偞鍎冲▍妤冪磽閸屾瑨鍏岀紒顕呭灣閹广垽宕煎┑鍫熸闂佸壊鍋呭ú鏍ㄥ劔闂備線娼х换鍡涘焵椤掍礁澧ù鍏肩墬缁绘繄鍠婃径宀€锛熼梺绋款儐閸ㄥ灝鐣烽幇鏉垮唨妞ゆ挾鍋熼ˇ顕€鎮峰鍐妞ゆ洏鍎茬换婵嬪炊閵娿儰鎮ｉ柣搴″帨閸嬫捇鏌嶈閸撴稓鍒掓繝姘睄闁稿本绋戦弸鎴︽椤愩垺澶勬繛鍙夛耿閿濈偤寮撮姀锛勫幍闂佺粯鍨堕敃鈺佲枔閵忋倖鐓涘ù锝夋交闊剟鏌″畝瀣暠閾伙絽銆掑鐓庣仭闁崇粯鎸搁埞鎴﹀煡閸℃ぞ绨诲┑鈽嗗亝缁诲倿锝炶箛鎾佹椽顢旈崨顖氬Х闂備胶绮崝妯间焊椤忓棌鍋撳顓熺凡妞ゎ叀鍎婚¨渚€鏌涢妸銉э紞婵″弶鍔欓獮鎺楀棘閸濆嫪澹曢梺鎸庣箓妤犲憡绂嶅鍕闁圭⒈鍘奸弸銈夋煃瑜滈崜婵嬶綖婢跺⊕鍝勎熼崗鐓庡簥闂佺鏈换鍕濞嗘挻鈷掑ù锝呮啞閸熺偤鏌涢弮鈧崹鍨暦濠靛棛鏆嗛柛鏇ㄥ墮閳ь剝娉涢埞鎴︽偐閸欏顦╅梺绋匡工閻忔岸銆冮妷鈺傚€烽柤纰卞厸閾忓酣姊洪崨濠冣拹缁炬澘绉电粚杈ㄧ節閸ヨ埖鏅濋梺鎸庣箓濞诧箓宕氬☉銏♀拺?
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

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌ｉ幋锝呅撻柛銈呭閺屾盯顢曢敐鍡欘槬缂佺偓鍎冲锟犲蓟閿濆顫呴柕蹇婃櫇閸旀悂姊哄Ч鍥р偓妤呭磻閹捐埖宕叉繝闈涙川缁♀偓闂佺鏈划宀勩€傚ú顏呪拺闁硅偐鍋涙俊濂告煕婵犲倹鍋ョ€殿喖顭烽弫鎰緞婵犲孩缍傞梻渚€娼х换鍡涘疾濠靛绀夐柛婵勫劤绾捐棄霉閿濆懏鎯堥弽锟犳⒑閻撳海绉虹紒鐘崇墵閸ㄩ箖鏁傞悙顒€纾梺闈涱煭缁犳垹澹曢鐐粹拺闁诡垎鍛唶濠电姭鍋撻弶鍫涘妼椤曢亶鏌涢妷銏℃珖缁炬儳銈搁弻鐔碱敍閸℃鏆熺紒瀣箳缁辨挻绗熼崶褎鐏嶉梺鑽ゅ暱閺呮盯顢氶敐鍡欑瘈婵﹩鍘兼禍婊堟⒑缂佹ɑ灏繛瀵稿厴閹偓銈ｉ崘鈺佷画濠电姴锕ら崯鎵不婵犳碍鐓涘ù锝呮憸瀛濆銈嗘尭閸氬顕ラ崟顓涘亾閿濆骸澧鐐茬Ч濮婄粯鎷呮搴濊缂備浇寮撶划娆撳箠閻旂⒈鏁嶆慨妯块哺閹冲啯绻濈喊澶岀？闁稿鍨垮畷鎰板Χ婢跺﹤鍋嶉梺缁樻尭鐎垫帡鎮炴禒瀣叆闁绘柨鎼暩閻庤鎸风欢姘跺蓟濞戙垹鐒洪柛蹇曞娴滎亪銆佸鑸电劶鐎广儱妫涢崢鍛婄節閵忥絾纭炬い鎴濇嚇閹﹢鏁冮崒娑氬幍闂佹儳娴氶崑鍡涘箠閸ャ劍鍙忓┑鐘插鐢盯鏌熷畡鐗堝殗鐎规洏鍔嶇换婵嬪礃閵娿儱顥掗梻鍌氬€烽懗鍫曞箠閹捐鐤柛褎顨嗛崕妤呮煕鐏炵偓鐨戦柡鍡畵閺岋繝宕堕妷銉т痪闂佹悶鍊栭崹鍫曞Φ閸曨垰绠抽柟瀛樼妇閸嬫挻绻濆顓炩偓鍧楁煕瑜庨〃鍡涘磹閸偒娈介柣鎰皺娴犮垽鏌涢弮鈧喊宥囨崲濞戙垺鍤戞い鎺嗗亾闁宠鐗忛埀顒冾潐濞叉﹢宕归崸妤冨祦婵☆垵鍋愮壕鍏间繆椤栨粎甯涢柣婵囧▕濮婄粯鎷呮笟顖滃姼闂佸搫鐗滈崜娑氬垝濞嗘挸绠虫俊銈勭娴犙囨⒑閸濆嫭宸濋柛搴㈠姇閵嗘帗绻濆顓犲帾闂佸壊鍋呯换鍐夊鍐ｆ斀妞ゆ梻鍘ч弳鐔虹磼鏉堛劌娴い銏＄懇閹墽浠﹂幆褎鐝伴梺璇插椤旀牠宕伴弽顓涒偓锕傛煥鐎ｂ晝绠氶梺褰掓？缁€浣告暜闂備線娼х换鍡椢ｉ崨顓х劷闁哄啠鍋撶紒缁樼箘閸犲﹤螣濞茬粯缍夐梻浣规偠閸斿宕￠幎钘夌畺婵☆垵銆€閺€浠嬫倵閿濆懐浠涢柡鍛矊椤啴濡堕崱妯烘殫婵犳鍣ｉˉ鎾寸珶閺囩喓顩烽悗锝庡亞閸橀亶鏌ｈ箛鏇炰户闁稿鎹囬幆鍐箣閻橆偄浜炬繛鎴炵懅缁犳挻銇勯鍕殻濠碘€崇埣瀹曞崬螖閸愌勬▕濠碉紕鍋戦崐褏鈧潧鐭傚畷褰掑醇閺囩偟鐣洪梺璇″瀻閸涱喗鐤傞梻浣哥秺閺€鍗烆潖閻熸嫈娑㈠礃閵娧勬闂侀潧艌閺呪晠寮崶顒佺厽闁规壆澧楀☉褏绱撳鍕獢婵﹤顭峰畷鎺戔枎閹存繂顬夐梻浣规た娴滄粎绱炴繝鍌滄殾閻熸瑥瀚弧鈧┑顔斤供閸撴岸鎮楅浣虹瘈闁汇垽娼ф牎闂佽偐鎳撴晶鐣屽垝閺勫繈浜归柟鐑樻尵閸橆亝绻濋悽闈浶㈢紒缁樺笧濡叉劙骞嶉鍓э紲闁荤姴娲ゅ鍫曀夐姀銈嗙厸鐎光偓鐎ｎ剛袦濡ょ姷鍋涘ú顓炵暦濡ゅ懎浼犻柕澹嫭娅掗梻鍌氬€风欢姘跺焵椤掑倸浠滈柤娲诲灡閺呭爼顢涘☉鏍︾盎闂侀潧顭堥崕璇差啅閵夛负浜滈柡鍥朵簽缁夘喗銇勯姀鈩冪濠碘€崇埣瀹曞崬螖閸愩劑鍙￠梻浣筋嚙濞寸兘骞婇幘瀵哥彾濠电姴娲ょ粣妤佹叏濡寧纭剧紒鈧径鎰拺闁割煈鍣崕鎴犵磼閻樿崵鐣洪柡灞稿墲瀵板嫮鈧綆浜炴禒鎾⒑鐠団€虫灍闁搞劌澧庨幑銏犫槈閵忕姷顦ч梺鍏肩ゴ閺呮粓宕虫导瀛樺€甸悷娆忓缁岃法绱掔紒妯肩疄闁绘侗鍠楅幆鏃堝Ω閿曗偓濞堢喖姊洪棃娑辨Ф闁稿寒鍣ｅ畷鎴﹀箻鐠囨彃鐎銈嗗姂閸婃顢欓弴銏♀拺闁荤喖鍋婇崵鐔兼煕鎼淬垹濮堥悗闈涖偢瀹曞崬鈽夊▎鎴濆箥闂佸搫顦悧鎾剁不閺嵮岀€舵い鏇楀亾闁哄本绋撻埀顒婄秵娴滄粓鍩€椤掆偓濞尖€愁嚕鐠囧樊鍚嬮柛顐亝椤庡洭姊绘担鍛婂暈闁规悂绠栧畷鐗堟償椤帞绋忛棅顐㈡处缁嬫帡宕愮紒妯圭箚妞ゆ牗绻嶉崵娆愩亜椤愵剛绡€婵﹥妞介幃鐑藉级閹稿巩鈺呮⒑閸忓吋銇熼柛銊ㄦ硾閻ｇ兘濮€閵堝懐鍔撮梺鍛婂姦娴滅偤鎯侀崼銉︹拺闁告劘灏欏▓閬嶆煕鐎ｎ偅宕岄柡灞剧洴瀵挳鎮欓崗鍝ラ┏闂備椒绱徊浠嬫偉閻撳寒娼栭柣鎴灻杈ㄧ箾閸℃ê鐏ラ柛鈺佺焸濮婅櫣鎷犻懠顒傤唹濠殿喗菧閸斿酣宕氶幒妤婃晣闁靛繆鈧厖绨婚梻浣虹帛閹哥霉閻戣棄绀夐柨鏇楀亾妞ゎ亜鍟存俊鍫曞幢濡も偓濞兼垿姊虹粙娆惧剱闁圭顭锋俊鐢稿礋椤栨艾宓嗗銈呯箰濡稖鈪靛┑锛勫亼閸婃垿宕瑰ú顏呭仭闁冲搫鎳庣粻鏍ㄧ箾閸℃ɑ鎯勯柡浣告閺屽秷顧侀柛鎾寸⊕缁旂喖寮撮姀鈺傛櫖闂佺粯鍔楃悰銉╁箯濞差亝鈷戦柛娑橈功閳藉鏌ㄩ弴顏勵洭缂侇喖顭烽獮妯肩磼濡　鍋撻崹顐ｅ弿婵☆垳鍘х敮鑸电箾閸涱厾肖闁逞屽墲椤煤韫囨稑鍨傚ù鐘差儏閽冪喖鏌涢埄鍐炬闁告艾顑夐弻娑㈠灳瀹曞洨顔夐柣?
  useEffect(() => {
    const unsubscribe = cacheEvents.subscribe((type, data) => {
      if (type === 'prompts') {
        // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻橀弻锝夊箣濠垫劖缍楅梺閫炲苯澧柛濠傛贡缁骞掗弬鍝勪壕闁挎繂绨肩花浠嬫煕閺冩挾鐣辨い顏勫暣婵″爼宕卞Δ鈧鎴︽⒑缁嬫鍎愰柟鐟版喘瀵鈽夐姀鈥充簻闂備礁鐏濋鍛閹绢喗鈷戠紒顖涙礃閺夊綊鏌涚€ｎ偅灏い顏勫暣婵″爼宕卞Δ鈧鎴︽⒑缁嬫鍎愰柟绋垮⒔濡叉劙骞橀幇浣告倯闂佸憡绮岄崯鎶藉触椤愨懡鏃堟偐闂堟稐绮堕梺鍝ュ櫏閸嬪鎮橀幒妤佺厽闁绘ê寮剁粚鍧楁倶韫囨梻鎳呯紒顕嗙秮閹瑩鎮滃Ο閿嬪闁荤喐绮庢晶妤冩暜閹烘挾顩插ù鐓庣摠閻撴洟鏌熼幆褜鍤熼柟鍐叉喘閺岀喖顢氶埀顒€顭囪閻忔帡姊洪悡搴綗闁稿﹥顨婇幆渚€宕奸妷锔规嫼闂傚倸鐗婇惄顖炴偘濠婂懐纾奸柟缁樺笒閳锋梹绻涢幋鐘虫毈闁诡喗鐟╅、鏍矗閵壯呮晨闂傚倷鑳堕幊鎾绘偤閵娧勫床闁告劦鍟熸径鎰亹缂備焦顭囬崢浠嬫⒑闂堟侗妯堥柛鐘虫礋閺屽洭顢涘☉鏍︾盎闂侀潧楠忕槐鏇灻洪幘顔界厵妞ゆ梻鏅幊鍛存煃瑜滈崜娑㈠极閹间讲鈧箓宕奸妷褍绁﹂梺瑙勫婢ф鍩涢幒鎳ㄥ綊鏁愰崟顕呭妳闂佺粯甯＄粻鏍蓟閿熺姴閱囨い鎰╁灩椤偆绱撴笟鍥ф灍闁荤啿鏅犻悰顔锯偓锝傛櫇缁夊瓨绻濋姀锝嗙【濠㈣泛娲畷鎴﹀箻缂佹ɑ娅滈柟鑲╄ˉ閳ь剝灏欓弫鏍磽?prompt 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧湱鈧懓瀚崳纾嬨亹閹烘垹鍊為悷婊勭矊闇夐柡宥庡幗閻撳繐鈹戦悙闈涗壕婵炲懎妫濋弻娑㈠Χ閸涱収浼冮梺鍝勮閸婃鍒掑▎鎴炲磯闁靛鍊楁す铏節閻㈤潧浠滈柟铏姈閹便劑宕归銈傛敵婵犵數濮村ú銈呮纯闂備胶顭堥張顒勬儗椤旂晫鐝堕柡鍥ュ灪閳锋帒霉閿濆妫戝☉鎾瑰皺缁辨帡鐓鐘电厯闂佽鍠楅敋妞ゎ偅绻冨蹇涘煛閸愵亝娈介梻鍌欒兌缁垰顫忔繝姘偍鐟滄棃骞冮悙鍝勫瀭妞ゆ劗濮崇花濠氭⒑閸︻厼鍔嬮柛銊ф暬椤㈡棃鍩￠崨顔惧幐闁诲函绲洪弲鐐哄礂瀹€鍕厓鐟滄粓宕滃▎鎴犱笉鐎广儱顦壕鍧楁⒑椤掆偓缁夊绮婚悩缁樼厵闁绘鐗婄欢鍙夋叏鐟欏嫮鍙€闁哄本鐩崺鍕礃椤忎礁顫岄梻浣虹帛閹告悂宕导鏉戠疅缂佸顑欓悡銉╂煕椤愶絿绠樻い锔诲幖閳规垿鎮欓崣澶樻！闂佹悶鍔戝褔顢氶敐澶婅摕闁靛鑵归幏缁樼箾鏉堝墽瀵奸悹鈧敃鈧…鍥箳濡や胶鍘遍梺鍝勬川閸嬬喐绂掑☉銏＄厽闁挎繂鎳庨。宕囩磼鏉堛劍灏伴柟宄版嚇瀹曨偊宕熼幋顖滃埌闁宠鍨块幃娆戞嫚瑜戦崥顐︽倵濞堝灝鏋涙い顓炲槻椤曪綁骞橀钘変簻婵＄偛顑呭ù鐑芥偘椤旂晫绡€闁汇垽娼ф禒锕傛煕椤垵鐏︾€规洜鎳撶叅妞ゅ繐绉甸弲娑㈡倵楠炲灝鍔氭繛灞傚妿婢规洟鎸婃竟婵嗙秺閺佹劖寰勫畝鈧粣妤€鈹戦敍鍕壕闁诡喖鍊垮璇测槈閵忕姈鈺呮煏婢诡垰鍟伴崢浠嬫煟?prompts 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌ｉ幋锝呅撻柛銈呭閺屾盯骞橀懠顒夋М闂佹悶鍔嶇换鍐Φ閸曨垰鍐€妞ゆ劦婢€濮规姊洪柅鐐茶嫰婢у墽绱掗悩铏碍闁伙綁鏀辩缓鐣岀矙鐠囦勘鍔戦弻鏇熷緞濞戙垺顎嶉悶姘剧秮濮婂宕掑▎鎴М闂佸湱鈷堥崑鍡欏垝濞嗘劗鐟归柍褜鍓欓悾鐑藉閿涘嫰妾梺鍛婄☉閿曘倝鍩€?
        if (data && typeof data === 'object' && 'id' in data) {
          const updatedPrompt = data as Prompt;
          setPrompts((prev) =>
            prev.some((p) => p.id === updatedPrompt.id)
              ? prev.map((p) => (p.id === updatedPrompt.id ? updatedPrompt : p))
              : [updatedPrompt, ...prev]
          );
          // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋挎瀬闁瑰墽绮崑鎰版煕閹邦剙绾ч柣銈呭閳规垶骞婇柛濞у懎绶ゅù鐘差儏閻ゎ喗銇勯幇鈺佲偓鎰板磻閹炬剚娼╂い鎺戭槹鏁堥梻渚€娼уú銈団偓姘嵆閻涱噣骞掑Δ鈧獮銏′繆閻愭潙鍔ゆい銉﹁壘閳规垿鏁嶉崟顐℃澀闂佺顭堥崐鏍矉瀹ュ拋鐓ラ柛顐ｇ箘閺屽牓姊洪崫鍕垫Ч闁搞劌缍婂鎶芥晝閸屾稓鍘甸梺缁樺灦閿曗晛鈻撻弴銏＄厱濠电姴瀚崢鎾煛瀹€鈧崰鎾舵閹烘嚦鐔兼惞閸︻厽鍣紓鍌氬€峰鎺旀閿熺姴闂柨婵嗘媼濞兼牠鏌ц箛姘兼綈閻庢碍宀搁弻鐔虹磼濡桨鍒婇梺鍛婃煥椤﹁京妲愰幘瀛樺闁告挻褰冮崜閬嶆煟閵忊晛鐏ｉ柛鐘崇墵閻涱喖螖閸滀焦鏅濋梺鎸庢琚欓柟鐤缁辨捇宕掑▎鎴濆闁藉啴浜堕幃妯跨疀鐎ｎ亜顫囬梺?listCache闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌ｉ幋锝呅撻柛濠傛健閺屻劑寮崼鐔告闂佺顑嗛幐鍓у垝椤撶偐妲堟俊顖濐嚙濞呇囨⒑濞茶骞楅柣鐔叉櫊瀵鎮㈤崨濠勭Ф婵°倧绲介崯顖烆敁瀹ュ鈷戠紒瀣儥閸庡繑銇勯幋婵愭█鐎殿喛顕ч埥澶愬閻橀潧濮堕梻浣告啞閸旓附绂嶉弽顬盯濡搁埡鍌楁嫼闂備緡鍋嗛崑娑㈡嚐椤栨稒娅犳い鏇楀亾闁哄瞼鍠栭幖褰掝敃閿濆懐锛撻梺鑺ド戠换鍫ュ蓟濞戙垺鏅滈悹鍥ㄥ絻缁犱即姊虹粙娆惧剱闁瑰憡鎮傞崺銏ゅ箻鐠囨彃鐎銈嗘⒒閺咁偅绂嶉悙顑跨箚闁绘劦浜滈埀顑惧€濆畷銏＄附閸涘﹤浜遍梺瑙勫礃椤曆囨倶閹惰姤鐓ラ柡鍥╁仜閳ь剙鎲￠崕顐︽⒒娴ｅ摜鏋冩俊妞煎姂閹虫宕奸弴鈧崶顒€惟闁靛鍠楃€靛矂姊洪棃娑氬闁硅櫕鍔楃划缁樺鐎涙鍘甸梺鍛婂姌鐏忔瑧绮婚懡銈傚亾鐟欏嫭纾婚柛妤€鍟块锝嗙鐎ｅ灚鏅ｉ梺缁樻煥瀵墎鈧俺妫勯埞鎴︽倷鐎涙ê闉嶉梺绯曟櫅閸熸潙鐣烽幋锕€绠婚悗闈涙憸椤旀洟姊洪懝閭︽綈婵犮垺锕㈠畷銉ㄣ亹閹烘挾鍘撻悷婊勭矒瀹曟粓鎮㈡總澶屽姺閻熸粍妫冮獮鍡楃暆閸曨偆锛滈梺缁樺姌鐏忔瑩鎮惧ú顏呪拺闁哄倶鍎插▍鍛存煕閻曚礁浜炴繛鍡愬灲閹瑩鎮滃Ο琛″亾閸洘鐓熼柟閭︿簽缁侀攱淇婇幆褎鍟炵紒?
          if (listCache) {
            listCache.prompts = listCache.prompts.some((p: Prompt) => p.id === updatedPrompt.id)
              ? listCache.prompts.map((p: Prompt) => (p.id === updatedPrompt.id ? updatedPrompt : p))
              : [updatedPrompt, ...listCache.prompts];
          }
        } else {
          // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻鐔兼⒒鐎靛壊妲紒鐐劤椤兘寮婚敐澶婄疀妞ゆ帊鐒﹂崕鎾剁磽娴ｅ搫小闁告濞婂濠氭偄閸忓皷鎷婚柣搴ㄦ涧婢瑰﹤危椤斿墽纾藉ù锝呮惈鍟告繝娈垮枛閻忔氨绮氭潏銊х瘈闁搞儴鍩栭弲顒€鈹戦悩缁樻锭閻庢皜鍥х；闁规崘顕ч悞鍨亜閹烘垵顏柣鎾寸洴閹鏁愭惔婵堟晼闁轰礁鐗嗚灃闁绘﹢娼ф禒锕傛煟濡や焦绀夌憸棰佺椤啴濡堕崱妤€娼戦梺绋款儐閹告悂鍩為幋锔筋€愰梺绋款儐閸旀危閹版澘绠虫俊銈傚亾闁绘帒鐏氶妵鍕箳閹存繍浠煎Δ鐘靛亼閸ㄧ儤绌辨繝鍥舵晬婵﹩鍙€绾偓缂傚倷鑳舵慨闈涚暆缁嬫娼栨繛宸簼椤ュ牊绻涢幋鐐跺妞わ絾妞藉娲偡閺夋寧姣愰梻浣稿簻缂嶄線濡存笟鈧顕€宕煎顏傚姂閺屽秹宕崟顐熷亾婵犳艾鍌ㄩ柟鍓х帛閸嬧剝绻濇繝鍌氼伀闁活厽甯為埀顒冾潐濞叉鍒掑畝鍕厺閹兼番鍔岀粻鑽も偓瑙勬礀濞诧箓鎮炴ィ鍐┾拻濞达絿鐡斿鎰亜閺冣偓閻楃姴鐣烽弶璇炬棃宕崘顏嗏棨闂備礁鎼ú銏ゅ垂濞差亝鍋傛繛鍡樻尰閻撴瑩鎮峰▎蹇擃仼濠殿噯绠撻弻娑㈠Χ閸℃瑦鍣紓浣介哺鐢繝骞冮埡鍛紶闁告洦鍋呴崕顏堟⒒娓氣偓閳ь剛鍋涢懟顖涙櫠閸欏浜滄い鎰╁焺濡叉悂鎮￠妶澶嬬厸鐎广儱娴锋禍瑙勭箾瀹割喕绨奸柡鍛箞閺屾稓浠﹂悙顒傛闂佹眹鍊曢幊蹇曟崲濠靛顥堟繛鎴炃氶崑鎾诲箹娴ｅ摜鐤呴梺璺ㄥ枔婵挳鎮￠弴銏＄厵閺夊牓绠栧顕€鏌ｉ幘瀵告噮缂佽鲸甯為埀顒婄秵閸嬪嫰顢氬鍫熺厵闁谎冩憸缁夘噣鏌＄仦鐣屝ч柟绋匡攻瀵板嫬螣閹稄绠撳铏光偓鍦濞兼劙鏌涢妸銉т虎闁伙絿鍏橀獮鎺楀箣閺冣偓椤秴鈹戦悙鍙夘棞闁哄牜鍓涢埀顒佹皑閺咁偆妲愰幘璇茬＜婵炲棙鍨肩粣妤呮⒑闂堚晝绉甸柛锝忕到閻ｇ兘鏁愭径濠勵槰闂侀潧臎閸曨剦鍟庨梻鍌欑窔濞佳嗗闂佸搫鎳夐弲鐘差嚕椤愶箑鐐婇柕濞у拋鍟庨梻浣烘嚀椤曨參宕戦悢鐓庣疇闁告稑鐡ㄩ悡鍐喐濠婂牆绀堟繛鍡樻尨閳ь剨绠戦悾锟犳焽閿旂晫绋佹繝鐢靛仜濡﹥绂嶅┑瀣９闁绘垼濮ら悡銏′繆椤栨瑨顒熸俊鑼焾閳规垿顢欐總绋垮及濠殿喖锕ュ钘夌暦椤愶箑唯闁靛濡囬埀顒冾嚙閳规垿鎮欓悙鍏夊亾鐎ｎ剚宕叉繝闈涱儏閺嬩線鏌熼幍顔碱暭闁稿﹦鍏橀弻锝夊箣閻愬棙鍨甸埢宥咁煥閸曨厾鐦堥梺闈涢獜缁插墽娑垫ィ鍐╃叆闁哄浂浜顔姐亜閵婏絽鍔︾€规洖鐖奸、妤佹媴閸欏顏圭紓鍌氬€搁崐鐑芥倿閿曞倹鏅┑鐘愁問閸犳牠寮甸鍌涘床婵炴垶鐟ョ欢鐐烘倵閿濆骸澧婚柣蹇撳船椤啴濡惰箛鏇犐戦柣搴ｇ懗閸涱喖搴婂┑鐘绘涧閻楀棝寮搁崼婵愮唵閻犻缚娅ｉ悘閬嶆煥濞戞艾鏋涙慨濠呮缁瑥鈻庨幆褍澹夐梻浣哄劦閺呪晠宕规导瀛樺仼闁绘垼妫勭粻娑㈡煛婢跺顕滅€规挸绉撮—鍐Χ閸℃ê闉嶇紓浣割儐閸ㄥ墎绮嬪鍡愬亝闁告劏鏅濋崢浠嬫⒑闂堟稓绠為柛濠冪墪閳藉顦归柟顔荤矙椤㈡稑鈹戦崱娆忓缚闂備線娼уú銈団偓姘嵆閵嗕線寮撮姀鈩冩珳闂佹悶鍎弲婵嬪汲椤撱垺鈷掑ù锝呮啞鐠愶繝鏌熼搹顐ｅ暗闁逞屽墯閻噣宕￠幎鐣屽祦闁告劦鐓堥悡銉╂煕閹邦喖浜剧€点倖妞藉铏瑰寲閺囩偛鈷夊┑鐐插级閿曘垹鐣烽崫鍕ㄦ闁靛繆妾ч幏濠氭⒑缁嬫寧婀伴柤褰掔畺閸┾偓妞ゆ帒瀚峰Λ鎴犵磼椤旇偐澧涚紒妤冨枛閸┾偓妞ゆ帒瀚畵渚€鏌″搴″季闁轰礁鍟撮弻銊╁即濡も偓娴滃墽绱掗悙顒€鍔ょ紓宥咃躬楠炲啫鐣￠幍铏€婚棅顐㈡处閹尖晜绂掓總鍛娾拺闁硅偐鍋涙俊浠嬫煛鐏炶濮傛繝鈧笟鈧铏圭磼濡浚浜滆灒濠电姴娲ょ壕鍧楁煙鐎电袥闁稿鎸鹃幉鎾礋椤掆偓閻喚绱撴担钘夌厫鐎光偓閹间礁绠栭柨鐔哄閺佸啴鏌ㄩ弴妤€浜鹃梺缁樺姇閿曨亪寮婚弴鐔虹鐟滃宕戦幘缈犵箚闁圭粯甯炴晶锔芥叏婵犲倹鎯堥悡銈夋偣閸ャ劌绲荤紒鐘叉惈椤啴濡堕崘銊ヮ瀳闂佹寧娲︽禍婊堫敋閿濆棛绡€婵﹩鍓涙导瀣⒑瑜版帩鏆掔紒鈧笟鈧獮鍐箣閿旇В鎷洪梺鍛婄☉閿曘倖鎱ㄩ崒鐐寸厱闁哄倽娉曢悞鎼佹煃閵夛妇澧€垫澘瀚换娑㈡倷椤掍焦婢戦梻鍌欒兌缁垶宕濆Ο闂寸剨婵炲棙鍔栧▍鐘绘煛閸ャ儱鐏柣鎾跺枛閺屸€崇暤椤旇崵顦﹀ù鐙€鍣ｉ幃?
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
    // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋婵愭綗闁逞屽墮閸婂潡骞愭繝鍐彾闁冲搫顑囩粔顔锯偓瑙勬磸閸旀垵顕ｉ崼鏇炵闁绘瑥鎳愰獮銏ゆ⒒閸屾瑧绐旈柍褜鍓涢崑娑㈡嚐椤栨稒娅犻柟缁㈠枟閻撴盯鎮橀悙鎻掆挃闁靛棙甯￠弻宥堫檨闁告挶鍔庣槐鐐哄幢濞戞锛涢梺鍛婁緱閸橀箖寮抽敂閿亾閸忓浜鹃梺鍛婃处閸撴盯宕㈤幖浣瑰€甸柛蹇擃槸娴滈箖鏌ｆ惔顖滅У闁告挻鐩弫宥夋偄閸濄儳顔曢柣搴ｆ暩椤牓顢撻幘鏂ユ斀闁炽儴娅曢崰妯活殽閻愯尙绠婚柟顔规櫇閹风娀鎳犻澶婃杸闂傚倷绀佸﹢閬嶅磿閵堝鍚归柍鍝勬噹缁狅綁鏌ｅΟ鍏兼毄闁挎稒绻堝铏圭矙閹稿孩鎷遍梺鑽ゅ暀閸パ咁槷閻庡箍鍎遍ˇ浼存偂閺囥垺鐓熼柟閭﹀枟閺嗏晠鎮介娑氣槈閼挎劙鏌涢妷鎴濈Х閸氼偊鎮楃憴鍕闁绘牕銈搁妴浣肝旈崨顓犲姦濡炪倖甯掔€氼參宕?- 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑鐐烘偋閻樻眹鈧線寮撮姀鈩冩珕闂佽姤锚椤︻喚绱旈弴銏♀拻濞达綀娅ｉ妴濠囨煕閹惧绠為柟钘夊€婚埀顒婄秵閸犳牠鎮欐繝鍥ㄧ厪濠电姴绻愰々顒傜磼婢跺﹦鍩ｆ慨濠冩そ瀹曟﹢宕ｆ径瀣壍闂備胶顭堥鍛涘Δ鍛偓锕傚炊椤掍礁浜滈梺绋跨箰閻ㄧ兘骞忓ú顏呪拺闁革富鍙庨悞楣冩倵濞戞帗娅婇挊鐔兼煕椤愮姴鍔滈柣鎾寸☉閵嗘帒顫濋浣规倷濠电偛鎳庣粔鍫曞焵椤掑喚娼愭繛鍙夛耿瀹曞綊宕稿Δ鍐ㄧウ濠殿喗銇涢崑鎾垛偓娈垮櫘閸撶喐淇婇悜鑺ユ櫆缂備焦顭囩粔鐐節閻㈤潧啸闁轰焦鎮傚畷鎴濃槈濡粍绋戦埢搴ㄥ箻椤栨浜鹃柨鏇炲€搁悙濠冦亜閹哄棗浜剧紓浣插亾濠㈣泛澶囬崑鎾绘偡閺夋浠炬繝銏㈡嚀椤戝顕ｉ妸锔绢浄閻庯綆鍋嗛崢浠嬫⒑瑜版帒浜伴柛妯兼櫕缁辩偤骞嬮悩鐢碉紲闂佽偐鈷堥崜娑氭暜濞戞氨纾肩紓浣诡焽閵嗘帗绻涢幋婵堜粵妞わ妇澧楅幆鏃堟晲閸ヮ煈娼撻梻鍌氬€烽懗鍓佸垝椤栨稓鐟规俊銈呮噹闂傤垶鏌ㄥ┑鍡╂Ш鐎规挷绶氶弻鐔兼倻濡儤顔曢梺鍝勫暙閻楀棝鎮為崹顐犱簻闁瑰搫妫楁禍楣冩⒑鏉炴壆璐伴柛锝忕到椤繒绱掑Ο鑲╂嚌闂侀€炲苯澧い顓炴穿椤﹀綊鏌熼銊ユ搐楠炪垺绻涢幋鐑嗙劷闁汇倕娲︾换婵嬪閿濆懐鍘梺鍛婃⒐濞茬喎鐣峰▎鎾村亹闁煎鍊曡ぐ鍕⒑閹肩偛鍔橀柛鏂块叄閸╁﹪寮撮姀锛勫帗?
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

    // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻橀弻锝夊箣濠垫劖缍楅梺閫炲苯澧柛濠傛贡缁骞掗弬鍝勪壕闁挎繂绨肩花浠嬫煕閺冩挾鐣辨い顏勫暣婵″爼宕卞Δ鈧鎴︽⒑缁嬫鍎愰柟鐟版喘瀵鈽夐姀鈥充簻闂備礁鐏濋鍛閹绢喗鈷戠紒顖涙礃閺夊綊鏌涚€ｎ偅灏い顏勫暣婵″爼宕卞Δ鈧鎴︽⒑缁嬫鍎愰柟绋垮⒔濡叉劙骞橀幇浣告倯闂佸憡绮岄崯鎶藉触椤愨懡鏃堟偐闂堟稐绮堕梺鍝ュ櫏閸嬪鎮橀幒妤佺厽闁绘ê寮剁粚鍧楁倶韫囨梻鎳呯紒顕嗙秮閹瑧鈧潧鎽滈惁鍫ユ⒑濮瑰洤鐏叉繛浣冲啰鎽ラ梻浣筋嚙鐎涒晝绮欓崼銉ョ柧婵炴埈娼块埀顒€鎳忕缓鐣岀矙鐠囬敮鏅犻弻宥夊传閸曨偀鍋撻悽绋跨婵炲樊浜濋埛鎴︽煕閿旇寮鹃柣鎺斿亾缁绘盯骞橀鍛棖缂備緡鍠栭…鐑界嵁濡偐纾兼俊顖滃帶楠炲秹姊绘担鍛婂暈闁告梹顭囨禍绋库枎閹寸姳绗夋繝鐢靛У绾板秹鎮￠悢鍏肩厵闁割煈鍠栭弳娆忣熆瑜嶉悺銊╁Φ閸曨垰顫呴柍钘夋閻や線鎮楃憴鍕闁哥姵鐗犻妴浣肝旈崨顓狅紲濠殿喗锕╅崜娑㈡偪閸曨垱鈷掗柛灞捐壘閳ь剟顥撶划鍫熺瑹閳ь剟鐛弽顓ф晝闁挎洍鍋撻柣銈庡枟閵囧嫰骞囬崜浣烘殸缂佺偓鍎崇紞濠囧蓟閻斿吋鈷掔痪鎯ь儏閸橈繝姊洪柅鐐茶嫰婢ф挳鏌￠埀顒佹綇閳哄倸搴婂┑鐘绘涧椤戝棝宕戦妸鈺傗拻闁割偆鍠撻埣銉︾箾瀹€濠佺盎闁宠鍨块幃娆撳箵閹烘挸鈧垶姊洪懡銈呮瀭闁稿孩濞婂畷锝夊川鐎涙ǚ鎷洪梺鍦焾鐎涒晝澹曢悽鍛婄厱閻庯綆鍋呯亸浼存煏閸パ冾伃妞ゃ垺锕㈤幃娆撳级閹寸姷宕洪梻鍌欑缂嶅﹪藟閹惧瓨鍙忛柟缁㈠枟缁犳帡姊虹拠鎻掑毐缂傚秴妫濆畷鎴﹀幢濞戞鍔﹀銈嗗坊閸嬫挻銇勯鐘插幋鐎殿喖顭烽幃銏ゆ偂鎼达綆妲梻浣稿悑缁佹挳寮插鍐ｆ灁妞ゆ帒瀚埛鎴︽煕濞戞﹫鏀婚柣鎾卞劦閺屻倕煤鐠囪尙浠搁梺绯曟杺閸ㄤ粙鐛鈧顒勫Ψ閿旇姤婢戦梻浣筋嚙閸戠晫绱為崱娑樼；闁糕剝绋戦崒銊ッ归悩宸剱闁抽攱鍨圭槐鎾存媴閸忓锛堝銈呯箰鐎氱兘宕甸弴銏＄厱妞ゆ劧绲剧粈鈧紓浣哄Т缂嶅﹪寮婚悢鐓庣妞ゆ梻鈷堥弳顓㈡⒑缁嬪尅宸ラ柣蹇斿哺楠炲牓濡搁妷搴ｅ枛閹剝鎯旈垾鑼笡濠德板€楁慨鐑藉磻閻愯　鈧箓宕堕埡鍌ゆ綗闂佸湱鍎ら〃蹇涘极婵犲嫮妫い鎾跺У閻掑潡鏌涘鐓庝簻閾绘牠鏌ｅ鈧褎绂掗敃鍌涚叆闁哄洦锚閻忔煡鏌曢崱鏇狀槮闁宠閰ｉ獮姗€寮堕幋鐐垫瀫闂傚倷绶氬褔篓閳ь剙鈹戦垾铏┛闁靛洦鍔欐俊鎼佸煛閸屾瀚藉┑鐐舵彧缁插潡鎮洪弮鍫濆惞婵炲棙鍨圭壕鑲╃磽娴ｅ顏劽归閿亾鐟欏嫭绀冮柛銊ユ健楠炲啴鍩￠崨顓犵厬闂佺鏈粙鎾趁虹€电硶鍋撶憴鍕闁哥姵鐗犻妴渚€寮撮姀鈥充簻闂佸憡鎸稿鍓佺礊瀹€鍕拺闁煎鍊曢弸鎴犵磼椤旇偐效鐎殿喖顭锋俊鎼佸煛鐎ｎ剛鈼ら梻濠庡亜濞诧箑顫忛懡銈呭К闁逞屽墮閳规垿顢欓弬銈勭返闂佸憡鎸婚惄顖氱暦閹扮増鍊烽柣鎴炃氶幏娲⒑閸︻収鐒炬繛鎾棑缁骞樼紒妯煎幍闂佸憡鍔樼亸娆愮墡缂傚倷鐒﹀濠氬窗閺嵮屽殨闁圭虎鍠栭～鍛存煃闁款垰浜鹃梺褰掓敱濡炶棄顫忓ú顏呭亗閹兼惌鍠楃紞妤呮⒑缁嬪尅鏀绘繛鑼枎椤曪綁骞栨担鍝ヮ吅闂佺粯鍔楅弫鎼侇敊閺囥垺鈷戦柛娑橈功閹冲啯銇勯敂璇茬仸闁诡喗锕㈤獮姗€顢欓悾灞藉箥婵＄偑鍊栧褰掑磿閾忣偆顩烽梺顒€绉甸悡娑樏归敐鍥剁劸闁哄棴缍侀弻娑㈠煘閹傚濠碉紕鍋戦崐鏍暜閹烘鐤柣妤€鐗忛々鏌ユ煢濡警妲撮柡鈧禒瀣厽婵妫楅弸娑㈡煟韫囨岸鍝虹紒缁樼⊕瀵板嫮鈧綆鍓氶崚娑㈡⒑鐠団€崇仩妞わ附澹嗙紓鎾寸鐎ｎ亜绐涙繝鐢靛Т閸婂憡绔熼幒妤佲拻濞达綀娅ｉ妴濠囨煕閹惧绠樼紒顔界懇楠炴帒螖娴ｉ晲绨甸梻浣告惈濞层劑宕伴幘璺哄К闁逞屽墴濮婂宕掑鍗烆杸缂備礁顑嗙敮陇妫㈠┑鐘诧工鐎氥劍绂嶅鍫㈠彄闁搞儜宥嗘暰濠电偛鎳庡Λ婵嬪蓟閺囥垹鐐婄憸宥夘敂椤撶喆浜滈柕蹇婂墲缁€瀣亜閵忊槅娈滅€规洘甯掗埞鍐倷鐎靛摜鐓夐梺璇″枟椤ㄥ懘鍩㈤幘璇插瀭妞ゆ梻鏅禍顏堟⒒娴ｈ櫣甯涢柣妤佹礋婵″爼骞栨担鍝勭ウ闂佸憡鍔戦崝澶愬几鎼淬劍鐓欓柟顖嗗啯姣愰梺璇插瘨閸樺ジ鈥旈崘顔嘉ч柛鈩冾殔琛肩紓鍌欐祰鐏忣亪宕曟繝姘﹂柟閭﹀灱濡插姊虹€圭媭娼愰柛銊ユ健楠炲啴鍩￠崨顓犵杸婵炶揪绲介幉鈥斥枍濞戙垺鈷掑ù锝呮啞閹茬鈹戦鐐毈闁靛棗鍟换婵嬪炊閳轰胶銈﹂梻浣告啞閸旓箓宕伴弽顐㈩棜濠靛倸鎲￠悡鐔兼煙閹殿喖顣兼繛鎳峰懐纾煎〒姘功閻ｅ灚鎱ㄦ繝鍐┿仢闁哄苯鎳橀幃娆撴嚑鐠轰警浼冨┑鐘媰鐏炶姤鐝濋梺鍝勬湰濞茬喎鐣烽崡鐐嶇喖鎼归崷顓熷櫙濠碉紕鍋戦崐銈夊磻閸涱垱宕查柛顐犲劘閳ь兛绀佽灃濞达綀娅ｉ惁鍫ユ⒑缁嬫寧婀伴柛鎴犳嚀椤洭顢楅崒婊咃紳闂佺鏈懝楣冨焵椤掑嫷妫戦柟宄邦儔瀵濡烽妷褝绱遍梻浣告贡閸嬫捇宕滃鑸靛亜闁糕剝绋掗崑锝夋煕濠靛棗顏╁┑鐐叉喘閺屾盯顢曢敐鍡楀壏闂佹寧绻傞ˇ顖炴煁閸ヮ剚鐓忓鑸电☉椤╊剟鏌涘Ο鍏兼毈婵﹨娅ｉ幏鐘诲灳瀹曞洠鍋撴繝姘厱婵犲﹤鍟弳鐔虹磼閳ь剚绻濋崶銊㈡嫼闁哄鍋炴竟鍡浰囬敃鍌涚厽婵°倓鐒︾亸顓熴亜椤愩垻绠伴悡銈嗐亜韫囨挻濯兼俊顐㈠暣濮婃椽宕橀崣澶嬪創闂佸摜鍣ラ崑濠傜暦閸濆嫮鏆嗛柛鏇ㄥ厴閹锋椽鏌ｉ悢鍝ユ噧閻庢凹鍣ｆ俊鍫曞箻椤旂晫鍘撻悷婊勭矒瀹曟粌顫濈捄铏诡槶濠殿喗顭堝▔娑㈠触鐟欏嫪绻嗛柕鍫濇噺閸ｆ椽鏌ｉ幘瀛樼闁哄矉绻濆畷鍫曞Ψ閵夈儺鐎冲┑鐐茬摠缁牏鍒掑▎鎾宠摕婵炴垶锕╁鈺傘亜閹烘埈妲搁柛鎾崇埣濮婃椽宕崟顒佹嫳缂備礁顑嗛崹鍧楀春閵夛箑绶為柟閭﹀墰椤㈠懘姊虹紒妯哄閻忓繑鐟╅、娆撳箳濡や胶鍘介柟鑲╄ˉ閳ь剙鍟挎潏鍛存⒑缁嬫鍎愰柟姝屽吹閹广垹鈽夐姀鐘殿吅濠电偛妫楃换鎺撶妤ｅ啯鈷戠紓浣股戠亸鐢告煕閻樺磭澧电€殿喖顭烽弫鎰板川閸屾粌鏋涢柟绛圭節婵″爼宕卞Δ浣哄經闂傚倸鍊烽懗鍫曞箠閹捐鐤悹鎭掑妽瀹曞弶鎱ㄥ璇蹭壕濡ょ姷鍋涢崯鎾箖濞嗘挸浼犻柛鏇ㄥ弾閸炲爼姊洪崷顓炲付闁宦板妿缁瑩骞囬鍨℃繝鐢靛У绾板秹鍩涢幋锔界厱婵犻潧妫楅顏堟煕鐏炶濮傞柡灞剧洴瀵剟骞愭惔銏″闂備礁鎼幊搴ㄦ偉婵傛悶鈧礁顫濈捄铏瑰姦濡炪倖宸婚崑鎾淬亜?
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
      // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌熼梻瀵割槮缁炬儳顭烽弻锝呂熷▎鎯ф缂備胶濮撮悘姘跺Φ閸曨喚鐤€闁圭偓鎯屽Λ銈囩磽娴ｆ彃浜炬繝鐢靛Т濞诧箓鎮￠崘顏呭枑婵犲﹤鐗嗙粈鍫熸叏濡潡鍝虹€规洖寮剁换娑㈠箣閻愬灚鍣х紓浣稿閸嬨倝骞冨Δ鍛櫜閹肩补鈧尙鏁栨俊鐐€х紓姘跺础閹惰棄绠栨俊銈傚亾闁崇粯鎹囧畷褰掝敊閻ｅ苯钂嬮梻鍌欒兌椤牓顢栭崨瀛樻櫇闁靛濡囬埞宥呪攽閻樺弶澶勯柛銈咁儔濮婂宕奸悢鎭掆偓鎺旂磼閹邦喖浠︾紒缁樼箞閹粙妫冨ù韬插灲閺屾盯鎮╃€圭姴顥濋柧?API 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛闁诲氦顫夊ú蹇涘磿閹惰棄鐒垫い鎺戯功缁夌敻鏌涢悩宕囧⒈濠㈣娲熷畷绋课旀担鍝勫箥闂備浇顕栭崹铏櫠濡ゅ惤澶嬪緞閹邦剛顔愰梺鍝勵槹閸╁﹪鐓鍕厸閻忕偠顕ч埀顒佺箞楠炲﹤鈹戠€ｎ亞顓煎銈嗘閸嬫劖鏅堕姘ｆ斀闁绘劘灏欓幗鐘电磼椤旇偐鐏辩紒杈╁仦缁绘繈宕惰閹芥洖鈹戦悙鏉戠仧闁搞劎鎳撻弫顕€姊绘笟鈧褏鎹㈤崱娑樼婵犻潧顑嗛崑鐔兼煛閸ャ儱鐏柣鎾跺枛楠炴牕菐椤掆偓閻忣喗銇勯敐鍫濈毢闁逞屽墮閸樻粓宕戦幘缁樼厵闂傚倸顕ˇ锕傛煢閸愵亜鏋戠紒缁樼洴楠炲鈻庤箛鏇氭偅闂備礁鎲￠〃鍡樼箾婵犲洤钃熼柡鍥╁枔缁犻箖鏌涢…鎴濇灈濠殿喖楠搁—鍐Χ鎼粹€茶埅闂佺顑呴敃銈夛綖韫囨拋娲敂閸滀焦顥堟繝鐢靛仦閸ㄥ爼鎳濇ィ鍏熺兘鍩€椤掑嫭鈷掑ù锝囧劋閸も偓闂佽绁撮崜婵堟崲濞戞瑧绡€闁搞儮鏅涚粊锕傛⒑閸涘﹤濮﹂柛妯款潐缁傚秷銇愰幒鎾跺幍闂佺粯鍨堕敋闁诲繆鏅犻弻娑欑節閸曨偂妲愬┑顔硷龚濞咃絿妲愰幒鎳崇喖鎼归柅娑氱婵犵數濮甸鏍窗閹捐纾规繝闈涱儍閳ь兛绶氶獮姗€骞囨担鍛婂€┑鐘灱濞夋盯顢栭崒鐐茬闁惧繐婀辩壕钘壝归敐鍛棌闁稿骸绻戠换娑氭兜妞嬪海鐦堝銈冨灪閹告瓕鐏冮梺鍛婂姦娴滅偤鏁嶅鍛＝闁稿本鐟ч崝宥夋煥閺囥劌浜伴柟铏尵閹瑰嫰濡搁姀鐘卞濠电偛鐗嗛悘婵嗏枍濮椻偓閺屾稓鈧綆浜滈顓熴亜閵忊槄鑰跨€规洘顨婇幃鈩冩償閿濆洨宓佹繝鐢靛Х閺佸憡鎱ㄩ弶鎳ㄦ椽濡舵径濠冪€柣鐔哥懃鐎氼喚寮ч埀顒勬⒑濮瑰洤鐏叉繛浣冲洤鐓濋柛顐ゅ枔缁犳儳霉閿濆懎鏆遍柛姘埥澶娢熼柨瀣垫綌婵犵妲呴崹杈╁垝鎼淬劌绐楅柟閭﹀枤缁犳棃鏌ｉ弮鍌氬付闁绘帒鐏氶妵鍕箳閸℃ぞ澹曟俊鐐€ら崑鍕崲閹邦喖寮叉俊鐐€曠换鎰偓姘煎墰缁絽鈽夊▎鎴犵槇闂佹眹鍨藉褍鐡梻浣侯焾閿曪箓鈥﹂崼锝庢毎闂備礁澹婇崑渚€宕曢弻銉ョ厱闁瑰濮风壕濂告倵閿濆骸浜介柛搴涘劦閺屾稒鎯旈敍鍕啋闂佸搫鐬奸崰鏍х暦濮椻偓閹崇娀顢楅崒銈呮櫔闂佽瀛╅鏍窗濞戞矮鐒婃繛鍡樻尭缁犳煡鏌涢弴銊ュ闁荤喕顫夐妵鍕冀閵娧屾殹闂佺顭崹浼村煘閹达附鍋愭い鏃囧亹娴煎洤鈹戦悙宸Ч闁烩晩鍨跺顐﹀礃椤斿槈褍顭跨捄渚剰濞寸姍鍐ｆ斀闁宠棄妫楅悘銉р偓瑙勬礈閺佺顕ｈ閸┾偓妞ゆ帒瀚埛鎴︽⒒閸喓娲撮柣娑欑矌缁辨帡骞撻幒鎴旀寖濠电偞鍨甸悘姘跺Χ閿濆绀冮柍鍝勫暙瀵娊姊绘担鍛婃儓婵炶绠撻弫瀣⒑闁偛鑻晶顖炴煟閳哄﹤鐏″ǎ鍥э躬閹晫绮欑捄銊ф澑闂備胶绮〃鍛存偋閸℃顩查柛锔诲幘绾句粙鏌涚仦鍓ф噮闁告柨绉甸妵鍕敇閻愭潙鏋犻悗瑙勬磸閸ㄦ椽濡堕敐澶婄闁冲搫鍟獮鎰攽閻橆喖鐏辨繛澶嬬洴閺佸啴鏁傞懞銉︾彿闂佺鎻梽鍕偂閺囥垺鐓涢柛灞剧箖绾爼寮崼銉︹拺缂侇垱娲樺▍鍡涙煟閳哄﹤鐏﹂柣娑卞櫍瀹曞爼顢楁担闀愮綍闂備礁澹婇崑渚€宕硅ぐ鎺斿祦闁规壆澧楅埛鎺懨归敐鍫燁仩闁靛棗锕弻娑㈠箻鐎靛摜鐤勯梺璇″枤閸忔ɑ淇婇悜钘夌厸濞达絿顭堝▓銈嗙節閻㈤潧浠﹂柛銊ョ埣閹兘顢涘锝嗙亖婵炲濮撮鍡涙偂閻斿吋鐓欓梺顓ㄧ畱楠炴绱撳鍡楃伌闁哄矉缍€缁犳盯骞橀懜鍨枛闂備線娼уú銈団偓姘卞閹便劑鍩€椤掑嫭鐓冮柕澶堝劚閺嗛亶鏌熼悾灞炬毈闁诡喗顨堥幉鎾礋椤掑偆妲柣搴ゎ潐濞诧箓宕滈悢鐓庢槬闁靛繆鍓濋崕鐔兼煏婵炲灝鍔ゆい鎾虫惈椤啴濡堕崱妯烘殫闂?
      const evaluation = await evaluationsApi.getById(evaluationId);

      // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋挎瀬闁瑰墽绮崑鎰版煕閹邦剙绾ч柣銈呭閳规垶骞婇柛濞у懎绶ゅù鐘差儏閻ゎ喗銇勯幇鈺佲偓鎰板磻閹炬剚娼╂い鎺戭槹鏁堥梻渚€娼уú銈団偓姘嵆閻涱噣骞掑Δ鈧粻锝嗙節閸偄濮冪紒杈ㄧ箞濮婄粯鎷呴懞銉ｂ偓鍐磼閳ь剚鎷呴懖婵囩☉閳规垹鈧綆浜ｉ幗鏇㈡⒑閹稿海绠撴い锔诲灣缁鈽夊▎宥勭盎闂佸湱鍎ら崹鐢稿焵椤掑嫷妫戦柛鎺撳浮閹粙宕ㄦ繝鍕箺闂佺懓鍚嬮悾顏堝垂婵犳哎鈧倿鎳犻钘変壕闁稿繐顦禍楣冩⒑瑜版帗锛熺紒鈧笟鈧幏鎴︽偄閸濄儳顔曢梺鐟扮摠閻熴儵鎮橀埡鍛厱婵°倓绀侀埢鏇㈡煛鐏炵偓绀冪紒缁樼洴瀹曞綊顢欓悡搴經濠碉紕鍋戦崐銈夊磻閹烘纾诲┑鐘插亞濞兼牗绻涘顔荤凹妞ゃ儱鐗婄换娑㈠箣閻愯泛顥濆銈冨€愰崑鎾绘⒒閸屾瑨鍏岄柟铏崌楠炲鍩勯崘顏嗩啎婵犵數濮撮崑鍡涘吹閺囩偐鏀介柣妯虹－椤ｆ煡鏌￠崨顔惧弨闁哄本绋戦埥澶娢熺悰鈥充壕濠电姵鑹剧粣妤呮煛瀹擃喖鎳忓▓楣冩偡濠婂懎顣奸悽顖楁櫊瀵偅绻濋崶銊у幍濡炪倖鐗曞Λ妤呭疮閹殿喗顫曞ù鐓庣摠閳?缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚敐澶婄闁挎繂鎲涢幘缁樼厱濠电姴鍊归崑銉╂煛鐏炶濮傜€殿喗鎸抽幃娆徝圭€ｎ亙澹曢梺鍛婄缚閸庤櫕绋夊澶嬬厸濠㈣泛锕﹀銊╂煛閳ь剚绂掔€ｎ偆鍘藉┑鈽嗗灥濞咃綁鏁嶅鍡愪簻闁挎繂妫涢崣鈧梺鍝勬湰缁嬫帞鎹㈠┑瀣窛妞ゆ柧鍕橀埀顒佸姇椤啴濡舵惔鈥崇濠电偟銆嬬换婵嬬嵁婵犲偆鐓ラ柛顐ゅ櫏濡啫鈹戦悙鏉戠仸闁挎洍鏅涢…鍥籍閸啿鎷绘繛杈剧到閹诧繝骞嗛崼銉︾厵鐎瑰嫰鍋婇崕鏃傗偓瑙勬礃缁矂鍩ユ径鎰潊闁绘﹢娼ф慨锔戒繆閻愵亜鈧牕顔忔繝姘；闁瑰墽绮悡鏇熶繆椤栨繂鍚归柣顓熷笧閳ь剝顫夊ú姗€宕归崸妤冨祦婵☆垵鍋愮壕鍏间繆椤栨粌甯舵鐐茬墦濮婄粯鎷呴崨濠冨創濠电偛鐪伴崹钘夌暦濠靛牃鍋撻敐搴″⒉濠殿喗濞婇弻锝夋晲閸涱垳浼囩紒鐐劤閵堢顕ｉ崼鏇為唶婵炴垶锚椤牓姊洪崨濠勭畼闁稿簺鍊濋獮鍫ュΩ閿斿墽鐦堥梺鍛婁緱閸ｎ喗绂掗埡鍐＝濞撴艾娲ら弸鐔兼煟閻旀繂娲ょ粻鏌ユ煕閺囥劌鐏犻幆鐔兼偡濠婂嫮鐭掔€规洦鍓熷畷婊勬媴閾忕櫢绱抽梻浣侯焾閺堫剟鎮疯钘濋柨鏂款潟娴滄粓鏌ㄩ弬璺ㄤ虎鐎规挸妫欓〃銉╂倷閺夋垵顫掗悗瑙勬礃閿曘垽骞婇悩娲绘晢濞达綀顕栭崯搴ㄦ⒑閼姐倕鏋戠紒顔煎閺呰泛螖閸愨晜娈伴梺鍐叉惈閹冲酣寮告笟鈧弻娑樼暆閳ь剟宕戦悙鐑樺亗闁哄洢鍨洪悡鍐煃鏉炴壆顦︽鐐瓷戦妵鍕疀閹炬潙娅у銈傛櫇閸忔﹢寮婚悢鍏煎€绘慨妤€妫欓悾鐑芥⒑閹惰姤鏁遍柛銊ョ仢椤繑绻濆顒勫敹闂佺粯姊归崕濂稿触閸屾埃鏀介柣鎰綑閻忕喖鏌涢妸褎鍤€妞ゆ柨绻愰埞鎴﹀炊閵夈倗鐩庨梻浣告贡閸嬫捇銆冮崨顖楀亾濮橆剚鍤囬柟顔哄灲瀹曟浜搁弽銊ヮ伜婵犵數鍋犻幓顏嗗緤閸ф鍋ら柡鍐ㄧ墕閸氳绻涢崱妯诲鞍闁稿﹤鐏氱换娑㈠箣閻愯尙鐟插┑鐐叉噹濞层劎妲愰幒妤婃晩闁伙絽鏈崳鏉课旈悩闈涗沪閻㈩垱甯熼悘鍐╃箾鏉堝墽绉い顐㈩樀閹敻濡搁敂鍓х槇缂佺偓婢橀ˇ杈╁閸ф鐓曢悗锝庡亜閻忓鈧娲橀崝娆忣嚕娴犲鈧牠鍩勯崘鈹夸虎闂佽鍠撻崹钘夌暦椤愶箑唯妞ゆ柧绮欓弫婊堟⒒閸屾瑧顦﹀鐟帮躬瀹曟垿宕ㄩ鍏兼そ瀵粙顢曢妶鍕憹闂備胶绮敋缁剧虎鍘剧划缁樸偅閸愨晝鍘甸柣搴ｆ暩椤牊绂掑鍫熺厽闁圭儤鍨圭粔娲煛鐏炲墽銆掗柍褜鍓ㄧ紞鍡涘磻閸涱厾鏆︾€光偓閸曨剛鍘靛銈嗘⒐鐎笛囁夋径鎰厓缂備焦蓱鐏忕敻鏌熼悷鏉款伃濠碘剝鎮傛俊鐑藉Ψ閹板吀绨界紒杈ㄦ崌瀹曟帒鈻庨幋婵嗩瀴婵＄偑鍊戦崝灞轿涘┑鍡欐殾鐟滅増甯掗崹鍌涖亜閺囩偞鍣虹紓宥呴叄濮婃椽骞嗚缁犵儤銇勯銏╂Ш闁逞屽墯绾板秴鐣濋幖浣歌摕鐎广儱顦敮闂侀潧顦崕鎻捫掗幇顑╂棃鎮╅棃娑楁勃闂佸憡姊归悷銉╋綖韫囨稒鎯為柛锔诲幘閿涙粌鈹戦埥鍡楃仭婵＄偘绮欏畷鐢碘偓锝庡亞缁♀偓缂佸墽澧楄彜闁稿鎹囬幖褰掝敃閿濆棗鈧兘姊洪崨濠庢疁濞存粌鐖煎濠氭偄閸忕厧浜遍梺鍓插亞閸犳捇宕欓敍鍕＝濞达絽鎼瓭濡炪値鍘鹃崗妯侯嚕鐠囨祴妲堥柕蹇曞Х椤旀帡姊洪懝鏉款棈婵炲鐩畷銏ゆ晸閻樻枼鎷虹紓鍌欑劍钃遍悘蹇ｅ幗閵囧嫰骞嬪┑鍥舵￥闂佺懓绠嶉崹褰掑煡婢舵劕顫呴柣妯兼暬閻涙捇姊绘担鐑樺殌闁宦板妿閹广垽宕橀鑲╋紮濡炪倖鐗滈崑鐐哄煕閹达附鐓犲┑顔藉姇閳ь剚娲熷鎶藉焵椤掑嫭鈷戦柛娑橈梗缁堕亶鏌涢妸锕€鈻曢柟顔惧仦缁轰粙宕ㄦ繛鐐闂備礁鎲＄粙鎴︽晝閵夛箑绶為柛鏇ㄥ灡閻撴洟鎮楅敐鍌涙珖缂佹劖妫冮弻娑㈠煘閹傚濠碉紕鍋戦崐鏍暜婵犲嫮鐭嗗ù锝堟缁犳棃鏌熼悜妯诲蔼濞存粍绮嶉妵鍕箛閸撲焦鍋х紓浣哄Х閸嬬偤濡甸崟顖氼潊闁宠棄妫欓悾鐑芥倵閸偅绶查悗姘煎幘閹广垹鈹戠€ｎ亞锛滃┑顔矫崥瀣夊鍛斀?run 闂傚倸鍊搁崐鎼佸磹瀹勬噴褰掑炊椤掑鏅悷婊冪Ч濠€渚€姊虹紒妯虹伇婵☆偄瀚划濠氭偐缂佹鍘甸梺纭咁潐閸旓箓宕靛▎鎴犵＜闁绘﹢娼ч弸娑欐叏婵犱胶鐭欑€规洖鐖奸、妤呭焵椤掍緡鏀伴梻鍌欑濠€杈ㄦ櫠濡も偓椤灝螣閼测晝鐒奸梺鍛婂姀閺傚倹绂嶅鍫熺厸闁告劑鍔嶆径鍕亜閵夈儺妲搁棁澶愭煟濮椻偓濞佳呮暜閼哥偣浜滄い蹇撳閺嗭絽鈹戦垾宕囧煟鐎规洖宕灃闁告劦浜濋崳顖炴⒒娴ｇ瓔鍤欓悗娑掓櫊瀹曟瑨銇愰幒鎴狀槶濠电偞鍨堕懝楣冨垂濠靛棌鏀介柣妯虹－椤ｆ煡鏌￠崨顔肩祷妞ゎ叀娉曢幑鍕瑹椤栨艾澹嬮梻浣告啞椤洭寮拠宸綎缂備焦顭囬悷褰掓煕閵夋垵鍟╃槐鐔虹磽閸屾艾鈧悂宕愰悷閭︽僵闁靛ň鏅滈崵宥夋⒑椤掆偓缁夌敻宕戦埡鍐ｅ亾閸忓浜鹃梺閫炲苯澧板瑙勬礃缁轰粙宕ㄦ繝鍌楀亾閻㈠憡鐓ユ繝闈涙閸戝綊鏌熼弻銉х暫闁哄矉缍侀獮姗€鎮欓挊澶夊垝闂備礁鎼惌澶屾閺囩喓顩烽柨鏇炲€哥粈鍫㈡喐鎼淬劌绀嗘繛鎴烆焸閺冨牊鍋愰梻鍫熺◥濞岊亪鏌ｉ姀鈺佺伈缂佺粯绻堥幃浼搭敊鐏忔牗鐎婚梺瑙勫劤绾绢參藝閵娾晜鈷戦柛鎰级閹牓鏌涢悤浣哥仩鐞氭瑧鈧厜鍋撻柛鏇ㄥ厴閹峰姊虹粙鎸庢拱闁荤啙鍛幓闁哄啠鍋撶紒缁樼⊕閹峰懘宕橀幓鎺撳亹濠电偞鍨堕…鍌炲籍閸繂绐涘銈嗘尵婵敻鎮為悙顑跨箚闁绘劦浜滈埀顒佺墵閹兾旈崘銊ョ亰闁瑰吋鐣崝宥夊磿濡も偓椤潡鎳滈棃娑橆潔闂佺粯鎸婚悷鈺呭蓟閿濆绠ｉ柣蹇旀た娴滎亪骞冮悙娣亝闁告劏鏅濋崢鍗炩攽椤旀枻渚涢柛鎿勭畵瀹曟洟寮崼鐔哄幐闁诲繒鍋涙晶钘壝洪幘顔界厱闁宠桨绀侀顓犫偓瑙勬礃椤ㄥ﹪寮崒鐐村癄濠㈣泛锕ラ幊娆撴煟鎼淬埄鍟忛柛鐘愁殜楠炲啴宕掑鐓庢婵炲濮撮鎰板极閸愵喗鐓忛柛顐ｇ箖缁侇偆绱掗崡鐐叉毐闁宠鍨块幃娆撴嚋闂堟稒閿紓鍌欑瀵泛鐣峰鈧俊鐢稿箛閺夎法顦ㄩ梺鍐叉惈閸犳艾煤閹间焦鈷戠紓浣姑慨锕傛煕韫囨梻銆掗柟骞垮灲瀹曞崬鈽夊▎鎴濆妇闂備礁澹婇崑鍛崲閸曨厾涓嶉柟鎯板Г閻撶喖鏌ㄥ┑鍡欏闁绘繍浜炵槐鎺旂磼濡皷濮囬悗鍨緲鐎氼噣鍩€椤掑﹦绉甸柛瀣钘濇い鎾跺Х绾捐棄銆掑顒佹悙闁哄绋掗妵鍕敇閵忊剝鏆犳繛锝呮搐閿曨亪骞冨鍫熷癄濠㈣泛鑻獮鎰版⒒娴ｄ警鐒鹃柡鍫墴閹矂顢氶埀顒€鐣烽鈶芥梹鎷呴搹鍦闂備焦鐪归崹钘夘焽瑜庣粋鎺楁晝閸屾稓鍘遍梺闈涱焾閸庢娊宕洪敐澶嬬厸濞达絽澹婇崕蹇斻亜椤忓嫬鏆ｅ┑鈥崇埣瀹曟﹢濡搁妷顔锯偓鎾⒒娴ｈ棄鍚归柛鐔锋健瀵煡鎮╁顔兼婵犵數濮甸懝鎯ф纯濠电姰鍨煎▔娑㈡晝閵堝鍊垫い鎾跺剱濞撳鏌曢崼婵囶棞濠殿喖鍊块弻娑㈠Ω瑜忕敮娑㈡倵閻㈤潧甯堕柣锝嗙箞瀹曠喖顢栭懞銉ヮ伖?
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

      // 闂傚倸鍊搁崐鎼佸磹閹间礁纾圭€瑰嫭鍣磋ぐ鎺戠倞妞ゆ帒顦伴弲顏堟偡濠婂啰绠婚柛鈹惧亾濡炪倖甯婇懗鍫曞煝閹剧粯鐓涢柛娑卞枤缁犳﹢鏌涢幒鎾崇瑨闁宠閰ｉ獮妯虹暦閸ヨ泛鏁藉┑鐘茬棄閺夊簱鍋撻幘缁樺€块柨鏇楀亾闁宠绉瑰顕€宕奸悢鍙夊闂備胶顭堥張顒勬偡瑜旇棟闁挎洖鍊归悡娆撴偣閸ュ洤鎳愰惁鍫ユ⒑鐠団€虫灓闁稿繑蓱娣囧﹪鎮滈挊澹┿劑骞栧ǎ顒€鐏柍钘夘樀閺屽秹鎸婃径妯恍﹀銈庡亝缁诲牓銆佸Ο娆炬Ъ缂傚倸绉甸〃濠傤潖缂佹ɑ濯寸紒娑橆儐缂嶅牓鎮楃憴鍕闁挎洏鍨介妴浣割潩閹颁焦鞋缂傚倷绶￠崰鏍€﹂悜钘夌疇闁跨喓濮村洿闂佺鏈惌顔界珶閺囥垺鐓熼柣鏂挎憸閹冲啴鎮楀鐓庡箻缂侇喖鐗撻崺鈧い鎺嗗亾闁宠鍨块幃娆愶紣濠靛棙鐤傜紓鍌欒兌婵敻骞戦崶顒佸仒?
      evaluationCache.set(evaluationId, {
        testCases: loadedTestCases,
        criteria: loadedCriteria,
        runs: loadedRuns,
        results: loadedResults,
        selectedRunId: loadedSelectedRunId,
      });

      // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋挎瀬闁瑰墽绮崑鎰版煕閹邦垰绱﹂柣銏㈢帛娣囧﹪鎮欓鍕ㄥ亾閺嶎厽鍋嬫俊銈呭暟閻瑩鏌熼悙顒傛菇闁逞屽墮閹虫ê鐣烽敐鍡楃窞鐎光偓閳ь剟鎯侀崼銉︹拻闁稿本姘ㄦ晶娑氱磼鐎ｎ偄娴柡浣哥Ч瀵噣宕奸悢鍝勫箻闂備礁鎼ˇ鍐测枖閺囩喓顩烽柕蹇嬪€栭ˉ鍡楊熆閼搁潧濮堥柣鎾卞劜缁绘繈妫冨☉娆樻！婵犳鍨伴崥瀣崲濞戙垺鍤冮柍杞扮劍閻庡姊婚崶褜妲圭紒缁樼箖缁绘繈宕掑顓燁啀缂傚倷绀侀ˇ鏉款渻娴犲钃熼柍銉ョ－閺嗗棝鏌嶈閸撶喎鐣锋导鏉戝唨妞ゆ挾濮寸粊锕傛⒑缁洖澧查柛鎴犳嚀鍗卞┑鐘崇閳锋垿鏌涘┑鍡楊仾妞ゃ儮鈧剚娓婚悗娑櫳戦崐鎰攽閿涘嫭鏆€规洜鍠栭、娑樞掓担鍐叉处閻撴洘绻涢幋婵嗚埞闁哄绋掔换娑㈠醇閻曚焦鐣堕梺瀹狀潐閸ㄥ潡銆佸▎鎴炲厹闂佸灝顑嗛弳鐗堢節绾板纾块柛瀣焽閸掓帒鈻庨幘婢勩儱銆掑锝呬壕閻庢鍠楅幐铏叏閳ь剟鏌ｅ▎灞戒壕濠电偟鍘ч敃顏勵潖濞差亜绀冮柛娆忣槹閸庢捇姊虹粙鍖℃敾闁告梹鐟︽穱濠囨倻閽樺鍘搁梺绋挎湰椤ㄥ棛鈧艾銈稿缁樻媴閾忕懓绗￠梺鐟版憸椤牓婀侀梻浣哥仢椤戝洭銆呴柨瀣闁瑰瓨鐟ラ悘顏堟煟閹惧瓨绀嬮柡灞炬礃缁绘盯宕归鐓庮潥闂備胶顭堥鍐磿閺屻儯鈧啴濡烽埡鍌氣偓鐑芥煕濞嗗浚妯堟俊顐畵閹鎲撮崟顒傤槰闂佹寧娲忛崹浠嬪Υ娴ｇ硶鏋庨柟鐐綑濞堟劙姊洪崘鍙夋儓闁挎洏鍎查弲銉モ攽閻樻鏆滅紒杈ㄦ礋瀹曟垿骞嬮敃鈧壕褰掓煛瀹擃喖鏈紞搴㈢節閻㈤潧校闁肩懓澧芥竟鏇熺節濮橆厾鍘甸梺鍛婄懀閸庤櫕绋夐懠顒傜＝鐎广儱妫涙晶鐢告煛鐏炵硶鍋撳畷鍥ㄦ濡炪倖姊婚幊鎾寸妤ｅ啯鈷戦悶娑掆偓鍏呭濠电偛顕慨鎾敄閸℃稒鍋傞柣鏂垮悑閻撴瑩姊洪銊х暠濠⒀傚嵆閺岀喖鎮剧仦鍙儳绱掓潏銊﹀碍妞ゆ挸銈稿畷鍗炍旈崘褎顢橀梻鍌欑窔濞佳兠洪妶鍥ｅ亾濮橆偄宓嗛柣娑卞枤閳ь剨缍嗘禍鏍绩娴犲鐓曟い鎰剁悼婵″洭鏌涘▎娆戠瘈婵﹦绮幏鍛存倻濡儤鐣紓鍌欒兌婵绮旈悷鎵殾鐟滅増甯楃€电姴顭块懜寰楊亜鈻撻妸鈺傗拺闁革富鍙€濡炬悂鏌涢悩宕囧⒌闁挎繄鍋ゅ畷銊р偓娑欘焽閸樿棄鈹戦埥鍡楃仴妞ゆ泦鍛筏濠电姵纰嶉悡娆撴煙閼测晛浠滈柍褜鍓氶悧妤冪矚鏉堛劎绡€闁搞儯鍔岄埀顒勬敱閵囧嫯绠涢幘鎰佷槐闂佺顑嗛幑鍥ь嚕娴犲鏁囬柣鏃囨腹缂冩洘绻濆閿嬫緲閳ь剚娲熷畷顖烆敍濮樿鲸娈鹃梺鍝勮閸庢煡鎮￠弴銏＄厸闁搞儯鍎辨俊鍏碱殽閻愮柕顏堝煡婢舵劕绠荤€规洖娉﹁閺屸€崇暆鐎ｎ剛袦闂佽鍠撻崹鑽ゅ垝濞嗗繆鏋庨柣鎰靛墻濡垵鈹戦悩娈挎毌闁告挻绻嗛妵鎰板礃椤旇棄浜遍梺瑙勫礃椤曆囨嫅閻斿吋鐓熼柡鍐ㄥ€哥敮鍫曟煕閵娿儱鈧綊濡甸崟顖氭闁割煈鍠楅崐顖氣攽閻愯尙澧戦柛鏂挎捣濡叉劙骞樼€涙ê顎撻梻鍌氱墛缁嬫垿鈥栭崼銉︹拺闁告稑锕ㄦ竟妯汇亜閹存繃顥犵紒顔界濞煎繘濡歌閻﹀牓姊洪幖鐐插姌闁告柨鐭傞崺鈧い鎺戝€搁崢鎾煛瀹€鈧崰鎾舵閹烘嚦鐔煎传閸曨剛绉归梻鍌欒兌椤牓顢栭崱娑樼闁搞儜鍛缂備礁顑堥鎶藉籍閸繄顦ㄩ梺闈浤涙担闀愬枈闂傚倷娴囬褎顨ラ崫銉т笉鐎广儱顦壕鍧楁⒑椤掆偓缁夊绮婚鐐村€甸柨婵嗛閺嬫盯鎮峰▎娆戠暤闁诡喗顨婇弫鎰償閳╁啰浜堕梻浣虹帛閹歌煤閻旂厧钃熺€广儱顦悡娑樏归敐鍛暈闁诲繑鎹囧铏圭磼濡櫣鐟愮紓渚囧枟閻熲晛顕ｇ拠娴嬫闁靛繒濮烽鍝勨攽閻樿宸ラ柟铏姍閹繝骞橀弬銉︽杸濡炪倖姊婚妴瀣绩缂佹ü绻嗛柣鎰煐椤ュ鏌ｉ敐鍥у幋妞ゃ垺娲熼弫鍐焵椤掑倻鐭嗛悗锝庡亖娴滄粓鏌熼柇锕€鏋涢柡瀣闇夋繝濠傜墢閻ｆ椽鏌熼鐓庢Щ闁宠姘︾粻娑㈠箼閸愌呯；闂傚倷鑳剁划顖滄崲閸岀偞鍋夊┑鍌滎焾閽冪喐绻涢幋娆忕仼闁绘帗妞介弻娑滅疀婵犲啯鐝曢梺鎼炲妼閻忔繈鎮鹃悜鑺ユ櫜闁割偁鍨婚弶绋库攽閻愭潙鐏﹂柣鐔濆洤鍌ㄩ柣銏犳啞閳锋帡鏌涚仦鎹愬闁逞屽墯閹倿銆佸棰濇晣闁宠泛鎼ú顓㈠极閸岀偛绀堢憸蹇涙晬?
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

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋挎瀬闁瑰墽绮崑鎰版煕閹邦垰绱﹂柣銏㈢帛娣囧﹪鎮欓鍕ㄥ亾閺嶎厽鍋嬫俊銈呭暟閻瑩鏌熼悙顒傛菇闁逞屽墮閹虫ê鐣烽敐鍡楃窞鐎光偓閳ь剟鎯侀崼鐔虹瘈闁汇垽娼у瓭闂佺锕ラ幃鍌氼嚕閹间焦鏅濋柛灞剧〒閸?selectedEvaluation.id 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋挎瀬闁瑰墽绮崑鎰版煕閹邦垰绱﹂柣銏狀煼濮婄粯鎷呴悷閭﹀殝濠电偛寮堕悧鐘茬暦閹邦垬浜归柟鐑樺灩閺屟冾渻閵堝懐绠伴柣妤€锕崺娑㈠箣閿旇棄浠梺鎼炲劘閸斿酣宕ｉ埀顒€顪冮妶鍛劉妞ゃ劌锕濠氭晲閸垻鏉搁梺鍝勫€搁悘婵嬪箺閻㈠憡鈷戦悹鍥ｂ偓铏彲缂備胶绮换鍫濈暦鐟欏嫨鍋呴柛鎰╁妿閻も偓濠电偠鎻徊浠嬪箟閿熺媭鏁囬柟绋跨凹缁诲棝鏌ｉ幇鍏哥盎闁逞屽墯閻楁洜鍙呴悗骞垮劚椤︻垳澹曟繝姘厵闁诡垎鍛偗闂佺顑嗛幐楣冨箟閹绢喖绀嬫い鎺戝亞濡差剟姊绘笟鈧褔鎮ц箛娑掆偓锕傚醇閵夘喗鏅梺鎸庣箓椤︻垳绮荤紒妯镐簻闁哄啫娲﹂ˉ澶愭煃瑜滈崜娑㈠礂濮椻偓瀵鎮㈤崫鍕€抽梺鍛婎殘閸嬫稓绮婚幎鑺モ拺闁荤喖鍋婇崵鐔兼煕韫囨枂顏堬綖韫囨梻绡€婵﹩鍓涢敍婊冣攽閻愬弶顥為柛鈺佺墕鍗辨い鏇楀亾婵﹥妞藉畷鐑筋敇濞戞瑥鐝遍梻浣侯焾椤戝懘鏁冮妶澶嬪仼闁绘垼妫勭粻娑㈡煟濡も偓閻楀棙绂掗銏♀拻濞撴艾娲ゅ鍨攽閳ヨ櫕鍠樼€规洦鍓熷Λ鍐ㄢ槈閹烘挻鏉搁梻浣哥枃濡嫬螞濡ゅ懏鍊堕柨婵嗘川绾惧吋銇勯弴鐐村櫣闁诲骏濡囬埀顒冾潐濞测晝绱為埀顒傜磼閻樺磭鈽夐柍钘夘槸閳诲酣骞嬪┑鍡欘啈闂傚倸鍊风粈浣虹礊婵犲洤纾诲┑鐘叉搐缁€鍫熺箾閹存瑥鐏╃紒鐘虫そ閺岋絽螣閼姐們鍋為梺琛″亾闁兼亽鍎禍婊堟煛閸愩劌鈧懓鈻嶉弴銏＄厽妞ゆ挾鍠庡ù顕€鏌＄仦绯曞亾瀹曞洦娈曢柣搴秵閸撴盯鎯侀崼銉﹀€甸悷娆忓缁€鍐偨椤栨稑绗╅柣蹇斿浮閺岋綁鎮欑€电硶鏋旈梺閫炲苯澧柛妯荤墬缁旂喖寮撮悙鈺傛杸闁圭儤濞婂畷鎰板即閵忕姷鏌堟繛瀵稿帶閻°劑宕曞Δ鍛厱闁斥晛鍠氬▓銏ゆ煟閺傛寧顥㈤柡灞诲€濋獮鏍ㄦ媴鐟欏嫰鏁┑鐘愁問閸犳牠鎮ч幘璇茶摕鐎广儱顦伴悡銉╂倵閿濆簼绨藉ù鐘虫倐濮婃椽妫冨☉娆愭倷闁诲孩鐭崡鎶芥偘椤曗偓楠炴帒螖閳ь剟鐛姀鈥茬箚闁绘劖娼欓崝銈嗐亜閵夛箑鍝烘慨濠傤煼瀹曟帒鈻庨幇顔哄仒婵＄偑鍊栧▔锕傚川椤旂厧绨ラ梻浣烘嚀椤曨厽鎱ㄩ棃娑氭殾闁哄被鍎查悡鏇熴亜閹板墎鎮肩紒鐘筹耿閺?status 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋挎瀬闁瑰墽绮崑鎰版煕閹邦垰绱﹂柣銏狀煼濮婄粯鎷呴悷閭﹀殝濠电偛寮堕悧鐘茬暦閹邦垬浜归柟鐑樺灩閺屟冾渻閵堝懐绠伴柣妤€锕崺娑㈠箣閿旇棄浠梺鎼炲労娴滄粓鎯冨ú顏呯厱闁瑰瓨绻冪拹锛勭磼鏉堛劌娴柟宕囧Х閹瑰嫰宕崟顒€鍔掓繝鐢靛仜閻°劎鍒掓惔銊⑩偓锕傚醇閵夈儳鍘洪柟鍏肩暘閸斿瞼绮婚懡銈傚亾鐟欏嫭绀€婵炲眰鍔戝鎼佸焵椤掑嫭鈷掗柛灞剧懅椤︼附绻濋埀顒勬焼瀹ュ棙鍎柟鍏肩暘閸斿瞼绮ｅΔ浣风箚闁靛牆鎳忛崳褰掓煟閵堝洤浜剧紒缁樼箞濡啫鈽夐崡鐐插闂備胶绮幐鎼佸疮娴兼潙绠熺紒瀣儥閻撱儵鏌涢锝囩畼妞わ富鍘奸埞鎴︽偐缂佹ɑ閿銈嗗灥閹冲繘銆佹繝鍥ㄢ拻濞达絽鎲＄拹鈥愁熆瑜庨〃鍛粹€﹂崹顔ョ喖鎮℃惔顔筋棥濠电娀娼ч崐鎼佸箟閿熺姵鍋傞柣鏂垮悑閻撴瑩姊洪銊х暠濠⒀冾煼閺屾盯濡堕崶褎鐏堥梺鍝勬湰缁嬫垼鐏掗柣鐘叉搐瀵墎鎷犻悙鐑樷拺閻犲洠鈧櫕鐏嶅銈冨妼閿曨亪骞冩导鎼晪闁逞屽墮閻ｇ柉銇愰幒婵囨櫓闂佺粯鎸哥€垫帒顭囧☉銏♀拻闁稿本鐟ㄩ崗宀€绱掗鍛仸闁靛棗鍟村畷銊р偓娑櫳戝▍鍥⒑閹稿孩鈷愰柛搴㈠▕瀹曠懓鈹戦崱蹇旀杸闂佺粯蓱瑜板啴寮冲▎鎰╀簻闁哄浂婢€閹查箖鏌熼绛嬫當闁宠棄顦埢宥夘敇瑜岀花鑲╃磼閸屾稑娴い銏★耿婵偓闁抽敮鍋撻柟閿嬫そ濮婃椽宕ㄦ繝鍕暤闁诲孩鍑归崢濂割敊韫囨挴鏀介悗锝庡亞閸橀亶鏌ｆ惔顖滅У闁告挻鐟︾粋鎺楁焼瀹ュ棗鐧勯梺缁樻煥閸氬鎮￠悢闀愮箚妞ゆ牗绻冮鐘绘煥濞戞肖缂佽鲸甯￠幃鈺呮嚒閵堝洦姣囬梻浣告惈閻ジ宕伴幘鑸殿潟闁圭儤鍤﹂悢璁挎椽顢旈崟顒傛澓闂傚倸鍊搁崐鎼佲€﹂鍕闁挎洖鍊哥粈鍫熺箾閹存瑥鐏╅柣鎺戠仛閵囧嫰骞掑鍥獥闂佸摜鍠庣换姗€寮诲☉銏℃櫜閹肩补鍓濋悵婵嬫倵鐟欏嫭绀冮柛銊ュ閹广垹鈹戠€ｎ亞鍊為悷婊冪箻閹儳煤椤忓懎浠┑鐘诧工鐎氼參鎮￠妷鈺傜厽闁挎繂娲ら崢鎾煙椤旂懓澧查柟顖涙煥铻ｇ紓浣股戝鎴︽⒒閸屾瑧顦﹀鐟帮躬瀹曟垿宕ㄩ婊呯厯闂佺懓顕崑鐔笺€?
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

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋挎瀬闁瑰墽绮崑鎰版煕閹邦剙绾ч柣銈呭閳规垶骞婇柛濞у懎绶ゅù鐘差儏閻ゎ喗銇勯幇鈺佲偓鎰板磻閹炬剚娼╂い鎺戭槹鏁堥梻渚€娼уú銈団偓姘嵆閻涱噣骞掑Δ鈧粻锝嗙節閸偄濮冪紒杈ㄧ箞濮婄粯鎷呴懞銉ｂ偓鍐磼閳ь剚鎷呴懖婵囩☉閳规垹鈧綆浜ｉ幗鏇㈡⒑閹稿海绠撴い锔诲灣缁鈽夊▎宥勭盎闂佸湱鍎ら崹鐢稿焵椤掑嫷妫戦柛鎺撳浮閹粙宕ㄦ繝鍕箺闂佺懓鍚嬮悾顏堝垂婵犳哎鈧倿鎳犻钘変壕闁稿繐顦禍楣冩⒑瑜版帗锛熺紒鈧笟鈧幏鎴︽偄閸濄儳顔曢梺鐟扮摠閻熴儵鎮橀埡鍛厱婵°倓绀侀埢鏇㈡煛鐏炵偓绀冪紒缁樼洴瀹曞綊顢欓悡搴經濠碉紕鍋戦崐銈夊磻閹烘纾诲┑鐘插亞濞兼牗绻涘顔荤凹妞ゃ儱鐗婄换娑㈠箣閻愯泛顥濆銈冨€愰崑鎾绘⒒閸屾瑧顦︽繝鈧柆宥佲偓锕傚醇閵夈儳鏌堥梺绉嗗嫷娈ｇ紓宥嗙墵閻擃偊宕堕妸锕€顎涘┑鐐叉▕娴滃爼寮崒鐐寸厱闁哄洢鍔屽顕€鏌ｅ☉娆愬磳婵﹥妞介幊锟犲Χ閸涘拑绲介湁婵犲ň鍋撶紒顔界懃閻ｅ嘲顭ㄩ崼鐔哄姸閻庡箍鍎遍幉妯款槻妞ゎ叀娉曢幑鍕瑹椤栨艾澹嬮梻浣告啞鐪夌紒顔界懃椤繐煤椤忓拋妫冨┑鐐村灦閼归箖銆傚ú顏呪拺闁荤喐婢橀弳杈╃磼缂佹﹩鐒炬俊顐犲灲濮婅櫣绱掑Ο鍝勵潕闂佽桨绀侀幗婊勭珶閺囩喓闄勯柛娑橈工閳ь剛鏁婚弻銊モ攽閸℃瑥鍤梺纭呭皺閸嬫挻绌辨繝鍥舵晬婵°倐鍋撳ù婊勫劤閳规垿鏁嶉崟顐℃澀闂佺锕ラ崹鍨暦閻熸噴娲敂閸涱喗鐝栭梻渚€娼х换鍫ュ磹閺囩姷涓嶉柡宥庡幗閻撳啴寮堕悙鏉戭€滈柛蹇撶焸閺岋繝宕遍鐘垫殼闂佸搫鏈惄顖涗繆閻戣姤鏅查柛娑卞弾閻庡瓨淇婇悙顏勨偓鏍蓟閵娧勫床闁圭増婢橀悡姗€鏌熸潏楣冩闁稿鍔栫换娑㈠醇閻斿鍤嬪┑顕嗙到閼活垶鍩為幋锕€鐒洪柛鎰╁妿缁佺兘姊虹涵鍛彧闁挎岸鏌ｉ敐鍥ㄧ効闁靛洦鍔欓獮鎺戔攽閸ャ劍鐝曢梻鍌欑婢瑰﹪宕戦崨顖涘床闁告洦鍨扮粈澶愭煥閺囨浜惧銈庝簻閸熷瓨淇婇崼鏇炲耿婵°倐鍋撴繛鍏煎灴濮婅櫣绮欏▎鎯у壉闂佽鎮傜粻鏍箚閳ь剚銇勮箛鎾搭棤缁炬儳銈搁弻鏇＄疀閺囩倫銏㈢磼椤愩垻效婵﹨娅ｉ崠鏍即閻斿憡绶梻浣侯焾椤戝棝骞愰幖浣测偓鏃堝礃椤斿槈褔鏌涢埄鍐炬畼闁荤喆鍔戝铏圭矙閸栤剝鏁鹃梺璇″枛閸婃悂鎮鹃悜钘夘潊闁冲灈鏅涙禍楣冩煟閵忋垺鏆╅柕鍡楋躬閺屾稓鈧綆鍋呯亸鐢告煙閸欏灏︾€规洜鍠栭、妤呭磼濡や焦娅栫紓鍌氬€搁崐鎼佸磹閸濄儳鐭撶€规洖娲ㄩ惌鍡椼€掑锝呬壕闂佽鍣ｇ粻鏍箖濠婂牊瀵犲璺虹焾閸炴椽姊绘担鐑樺殌闁宦板妼椤繗銇愰幒鐐电◤閻庡箍鍎遍幊澶愬绩娴犲鐓熼柟閭﹀墮缁狙勩亜閵壯冧槐闁哄本鐩顕€骞橀崜浣规闁诲氦顫夊ú锕傚垂閸洖鏄ラ柍褜鍓氶妵鍕箳閹存繍浠鹃梺?evalModelConfig
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
    // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋婵愭綗闁逞屽墮閸婂潡骞愭繝鍐彾闁冲搫顑囩粔顔锯偓瑙勬磸閸旀垵顕ｉ崼鏇炵闁绘瑥鎳愰獮銏ゆ⒒閸屾瑧绐旈柍褜鍓涢崑娑㈡嚐椤栨稒娅犻柟缁㈠枟閻撴盯鎮橀悙鎻掆挃闁靛棙甯￠弻宥堫檨闁告挶鍔庣槐鐐哄幢濞戞锛涢梺鍛婁緱閸橀箖寮抽敂閿亾閸忓浜鹃梺鍛婃处閸撴盯宕㈤幖浣瑰€甸柛蹇擃槸娴滈箖鏌ｆ惔顖滅У闁告挻鐩弫宥夋偄閸濄儳顔曢柣搴ｆ暩椤牓顢撻幘鏂ユ斀闁炽儴娅曢崰妯活殽閻愯尙绠婚柟顔规櫇閹风娀鎳犻澶婃杸闂傚倷绀佸﹢閬嶅磿閵堝鏄ラ柛顐ｇ箥閻掍粙鏌曟径鍫濆姉闁衡偓娴犲鐓熸俊顖涙た閸熷繘鏌￠崱鈺佺仸闁哄苯绉烽¨渚€鏌涢幘瀵告噰鐎规洦鍨抽幑鍕Ω瑜庨敍蹇涙偡濠婂嫭顥堢€殿喖顭烽幃銏㈠枈鏉堛劍娅撻梻浣虹帛閹稿摜鑺遍崼鏇炵；闁规崘顕х粻鐟懊归敐鍥ㄥ殌濞寸姴銈稿铏圭磼濡櫣浼囧┑鈽嗗亜鐎氼剟寮鈧缁樻媴缁嬫寧姣愰梺鍦拡閸嬪﹤鐣烽幇鐗堝仭闁逛絻娅曢悗娲⒑缁洖澧茬紒瀣浮閸╂盯骞嬮敂鐣屽幈闂婎偄娲︾粙鎺楁晬閻斿吋鐓犻柛鎾瑰紦闁垶鏌＄仦鍓р姇闁诡垱妫冩慨鈧柣姗嗗亝閻忓棝姊?prompts 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑鐐烘偋閻樻眹鈧線寮撮姀鐘靛幈濠殿喗锕╅崢浠嬪Φ濠靛棌鏀介梽鍥春閺嵮屽殫闁告洦鍘搁崑鎾绘晲鎼存繄鑳哄┑鈥冲级閸旀瑥顫忕紒妯肩懝闁逞屽墮椤洩顦跺褎绻堝娲传閸曨剙娅ら梺鐑╂櫓閸ㄥ爼鐛箛娑樼闁挎棁妫勬禍婊堟煟韫囨挾绠ｉ柣鎺炵畵瀵剟鍩€椤掑嫭鈷掑ù锝堟鐢盯鏌ㄥ鎵佸亾濞堝灝鏋﹂柛鈺傜墪椤曘儵宕熼姘鳖槹濡炪倖鐗楃粙鎾诲储閹间焦鈷戦柛娑橈功閻棛绱掗埀顒佹媴鐟欏嫭鐝烽梺鍦檸閸犳鎮″☉銏″€堕柣鎰絻閳锋梹绻涢幓鎺旀憼闁靛洤瀚版慨鈧柍鈺佸暟椤︿即姊虹拠鈥虫灀闁哄懐濞€楠炲﹪鎮╁ú缁樻櫈闁荤姵浜介崝搴ㄦ晬閻旇櫣纾介柛灞捐壘閳ь剚鎮傚畷鎰板箹娴ｅ摜锛欓梺褰掓？閻掞箓宕戠€ｎ喗鐓欓梺顓ㄧ畱楠炴ɑ銇勯埡浣哥骇闁靛洤瀚伴獮鎺楀箣濠垫劒鐥梻浣侯焾妤犳悂藝娴兼潙桅闁告洦鍠氶悿鈧梺瑙勫礃濞夋盯鍩涢崼銉︹拺閺夌偞澹嗛ˇ锔界箾鐏炲倸濮傛鐐差槺缁瑥鈻庨幆褎鍊┑鐘灱濞夋盯鏁冮妶澶婂惞闁硅揪闄勯埛鎴犵磽娴ｈ偂鎴︽偂閵夆晜鐓欓柤鎭掑劤閻瞼绱掗鍓у笡闁靛牞缍佸畷姗€鍩￠崘銊ョ缂傚倸鍊搁崐鐑芥倿閿曞倹鏅紓鍌欑劍椤ㄥ棗鐣濋幖浣歌摕婵炴垶鍩冮崑鎾绘晲閸愩劌顬堥梺鍛婃煟閸婃繈寮诲鍫闂佸憡鎸诲畝鎼併€佸▎鎾冲唨妞ゆ挾鍋ゅΛ宄邦渻閵堝棙纾甸柛瀣尵閳ь剝顫夊ú妯煎垝閹捐绠栭柕蹇嬪€栭崵鍐煃鏉炴媽鍏岄柕鍫畵閺岋絾鎯旈敍鍕殯闂佺閰ｆ禍鎯版婵炲濮撮鍛村几娴ｇ硶鏀介柣妯哄级婢跺嫰鏌ｉ幘瀵告噭闁靛洤瀚板鍊燁槼妞ゃ儲绮撻弻锟犲醇椤愩垹鈷夐梺鎰佷簼閹倸顫忔繝姘＜婵﹩鍏橀崑鎾崇暋閹冲﹤缍婂畷鍫曨敆婢跺娅旈柣鐔哥矊缁绘﹢宕洪埀顒併亜閹哄秷鍏岄柍缁樻崌閺岋繝宕ㄩ鍓х暭闂佸憡甯楃敮鎺楀煝鎼淬劌绠荤€规洖娴傞崬鐑樼節瀵伴攱婢橀埀顒佹崌閹偤鏁冮埀顒勫煝瀹ュ鐐婄憸婊冦€掓繝姘厪闁割偅绻冮ˉ婊冣攽椤旂厧鈧潡寮诲☉娆戠瘈闁告劦浜滈埛宀勬⒑閹稿海绠橀柛瀣ㄥ€曢锝夊箻椤旇棄浜滈梺鎯х箰濠€鍗炍ｉ崶顒佲拻闁稿本鑹鹃埀顒佹倐閹勭節閸愵亞鎳濆┑掳鍊曢幊搴ｅ閸ф鐓欓柟娈垮枛椤ｅジ鏌ｉ幘瀛樼闁哄本娲熷畷鐓庘攽閸″繐浜鹃柛娑橈功椤╂彃螖閿濆懎鏆為柍閿嬪笒闇夐柨婵嗘川閹藉倿鏌涢妶鍡欐噮缂佽鲸甯炵槐鎺懳熼悜妯跨檨闁诲氦顫夊ú姗€宕归崸妤€绠栭柍鍝勫暞鐎氭岸鏌ょ喊鍗炲⒕缂侀亶浜跺缁樻媴缁涘缍堟繝銏㈡嚀濡瑩寮茬捄浣曟棃宕ㄩ鐙呯幢闂備焦鏋奸弲娑㈠疮閹殿喖濮柍褜鍓熷濠氬磼濮樺崬顤€婵炴挻纰嶉〃濠傜暦閺囥垹绠涢柣妤€鐗忛崢浠嬫⒑鐟欏嫬鍔ゆい鏇ㄥ幖鐓ら柟缁㈠枟閻撴盯鎮橀悙鎻掆挃婵炴彃顕埀顒侇問閸犳骞愰搹顐ｅ弿闁逞屽墴閺屽秹鍩℃担鍛婃闂佽桨绶℃禍顏勵潖缂佹ɑ濯寸紒娑橆儏濞堫厾绱撴担铏瑰笡閻㈩垱顨堥幑銏犫槈閵忕姷鍔﹀銈嗗笒鐎氼參鎮″☉銏″€堕柣鎰絻閳锋棃鏌嶉挊澶樻█闁哄苯绉堕幏鐘诲矗婢跺﹥鏁紓鍌欒兌婵敻鎯勯姘煎殨闁圭虎鍠楅崑鎴︽煃瑜滈崜鐔风暦椤栨壕鍋撻敐搴℃灍闁抽攱甯掗湁闁挎繂鎳忛崯鐐烘煙椤栨氨澧﹂柡灞诲€曠叅閻犲洩灏欐禒鎼佹⒑鐠団€崇仩闁哄牜鍓熼獮蹇涘川鐎涙ɑ鍎梻渚囧亝缁嬫捇鎮峰┑鍥╃瘈闁汇垽娼ф禒锕傛煕椤垵鐏︾€规洖缍婂畷鐑筋敇閻樿京鐟濋梻浣哄帶椤洟宕愰幇鏉跨；闁规崘鍩栭崰鍡涙煕閺囥劌澧版い锔哄劚閳规垿鎮欓懠顒佸嬀闂佺锕ョ换鍫ュ箖娴兼惌鏁嬮柍褜鍓欓悾閿嬬附缁嬭銊╂煥閺冨浂娼愰悗姘虫閳规垿鎮欓懜闈涙锭缂備浇寮撶划娆撶嵁婢舵劖鏅搁柣妯垮皺閻ｉ箖姊洪崜鎻掍簴闁稿孩鐓￠幃锟犲即閻愨晜鏂€闂佺粯蓱瑜板啴鍩€椤掆偓缂嶅﹤鐣烽鐐村€烽柣鎴烆焽閸橀潧顪冮妶鍡欏缂佸甯￠幃锟犲Ψ閿旇桨绨诲銈嗘尰缁本鎱ㄩ崒婧惧亾鐟欏嫭纾搁柛鏃€鍨块妴浣割潩鐠哄搫绐涘銈嗘煥婢т粙鍩?
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

    // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻橀弻锝夊箣濠垫劖缍楅梺閫炲苯澧柛濠傛贡缁骞掗弬鍝勪壕闁挎繂绨肩花浠嬫煕閺冩挾鐣辨い顏勫暣婵″爼宕卞Δ鈧鎴︽⒑缁嬫鍎愰柟鐟版喘瀵鈽夐姀鈥充簻闂備礁鐏濋鍛閹绢喗鈷戠紒顖涙礃閺夊綊鏌涚€ｎ偅灏い顏勫暣婵″爼宕卞Δ鈧鎴︽⒑缁嬫鍎愰柟绋垮⒔濡叉劙骞橀幇浣告倯闂佸憡绮岄崯鎶藉触椤愨懡鏃堟偐闂堟稐绮堕梺鍝ュ櫏閸嬪鎮橀幒妤佺厽闁绘ê寮剁粚鍧楁倶韫囨梻鎳呯紒顕嗙秮閹瑩鎮滃Ο閿嬪闁荤喐绮庢晶妤冩暜閹烘挾顩插ù鐓庣摠閻撴洟鏌熼幆褜鍤熼柟鍐叉喘閺岀喖顢氶埀顒€顭囪閻忔帡姊洪悡搴綗闁稿﹥顨婇幆渚€宕奸妷锔规嫼闂傚倸鐗婇惄顖炴偘濠婂懐纾奸柟缁樺笒閳锋梹绻涢幋婵堜粵闁靛牞缍佸畷姗€鍩￠崘銊ョ濠碉紕鍋戦崐鏍ь啅婵犳艾纾婚柟鍓х帛閻撴洘鎱ㄥ鍡楀⒒闁稿骸绻戦妵鍕即濡搫濮﹂悗瑙勬礈閸犳牠銆佸☉姗嗘僵濡插本鐗楁晥婵犵绱曢崑鎴﹀磹閺嶎厽鍋嬫俊銈呭暟閻瑩鏌熸潏鍓х暠闁绘帒鐏氶妵鍕箳閸℃ぞ澹曢梻浣筋嚙缁绘垵顫濋妸鈺佺闁靛繒濮Σ鍫ユ煏韫囨洖啸妞ゆ挻妞藉铏圭磼濡搫顫岄梺璇茬箲瀹€绋跨暦閻㈢纾奸柣鎰ˉ閹疯櫣绱撴担鍓插剱閻庣瑳鍛焿閻庯綆鍠楅悡鏇㈡煙閹屽殶闁靛棙甯楁穱濠囧矗婢跺﹤顫掑Δ鐘靛仦鐢繝鐛Ο灏栧亾闂堟稒鎲搁懖鏍⒒閸屾瑧绐旀繛浣冲棗娅ｉ梻浣告啞娓氭宕归崡鐑嗙唵闁哄稁鍘介埛鎴︽偣閸パ冪骇闁哥偛顦伴妵鍕敃閵忊晜笑闁绘挶鍊栭幈銊ヮ渻鐠囪弓澹曢梻渚€娼уΛ妤呭疮椤栨粍宕叉繝闈涱儏绾惧吋绻濇繝鍌氼仾妞ゆ梹娲熷缁樻媴閾忕懓绗￠梺鍦焾閹芥粓鍩€椤掆偓閻忔氨鏁敓鐘茬畺闁跨喓濮村敮闂佸啿鎼崐濠氬储闁秵鈷戦悷娆忓缁舵彃顭胯濞撮鍒掑▎鎰瘈婵﹩鍘鹃崢浠嬫煙閼测晞鐦介柡澶娿仒閸掓帗绻濆▓鍨灈闁挎洩濡囬崚鎺楊敍閻愯尙顔嗛梺鍛婁緱閸ㄩ亶宕伴崱娑欑厱闁哄洦顨嗗▍鍐煙閹绢喗鏁辩紒缁樼箞閹粙妫冨☉妤佸煕闂備礁鎲￠…鍡涘礃閸撗冨Ш闂備胶鍋ㄩ崕杈╁椤撱垹姹查柨鏃傛櫕缁♀偓闂傚倸鐗婄粙鎺撳緞閸曨垱鐓曢幖杈剧到閺嬫盯鏌＄仦璇插闁宠鍨垮畷鍗烆潨閸垻顦┑鐘垫暩閸嬬娀宕戦幇鏉跨獥闁哄诞灞剧稁濠电偛妯婃禍婊呯不娴兼潙绠规繛锝庡墮閻掔儤淇婇銏犳殻婵﹦鍎ゅ顏堝箥椤旇法鐛ラ梻渚€娼荤紞鍥╁緤娴犲鍋?
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
      // 婵犵數濮烽弫鍛婃叏閹绢喗鍎夊鑸靛姇缁狙囧箹鐎涙ɑ灏ù婊呭亾娣囧﹪濡堕崟顓炲闂佸憡鐟ョ换姗€寮婚敐澶婄闁挎繂妫Λ鍕磼閻愵剙鍔ゆい顓犲厴瀵鏁愭径濠勭杸濡炪倖甯婇悞锕傚磿閹惧墎纾奸柣鎰靛墮閸斻倝鏌ｈ箛鏃傜疄闁糕晝鍋ら獮瀣晝閳ь剛澹曢崗鑲╃闁瑰鍋熼幊鍐归悩顐ｆ珚婵﹥妞介弻鍛存倷閼艰泛顏梺鍛娒幗婊呮閹烘鍤嬮梻鍫熺☉閹界敻姊虹紒妯圭繁闁哥姵宀搁崺鈧い鎺戯功缁夌敻鏌涢悩鎰佹疁鐎殿喗褰冮埞鎴犫偓锝庡亞閸樻捇鎮峰鍕煉鐎规洘绮岄埥澶婎潩椤掆偓閻忓﹪姊洪崜鎻掍簽闁哥姴娴峰▎銏ゆ倷閻戞鍘甸梻渚囧弿缁犳垿鐛鈧弻娑樜熼幐搴闂佸疇顫夐崹鍧楀春閵夆晛骞㈡俊銈呭暕閸栨牠姊绘担鍛婂暈妞ゎ厼妫濆畷鎯邦槾妞わ富鍣ｉ弻锝嗘償椤栨粎校闂佸憡鎸荤粙鎾寸珶閺囥垺鍋傛鐐靛枎缂嶅﹪寮幇鏉垮窛妞ゆ挾鍟橀埡鍛€甸悷娆忓鐏忣厽淇婇锝囩疄鐎殿喖顭烽崹鎯х暦閸ャ劍鐣烽梻渚€鈧偛鑻晶瀵糕偓瑙勬磻閸楁娊鐛Ο鍏煎珰闁肩⒈鍓涘畷璺衡攽閻樺灚鏆╁┑顔肩摠鐎靛ジ鏁愭径瀣簻闂佸憡绋戦敃銈夛綖閿熺姵鈷戦柛婵嗗濡茶銇勯幋鐐垫噧閾荤偞绻濇繝鍌滃闁抽攱甯￠弻娑氫沪閹规劕顥濋梺閫炲苯澧存い銉︽尵閸掓帡宕奸悢铏规嚌闂侀€炲苯澧撮柣娑卞櫍瀵粙顢樿閺呮繈姊洪幐搴㈩梿婵☆偄瀚粋宥夋焼瀹ュ棌鎷虹紓渚囧灡濞叉牗鏅堕弻銉︾叄闁哄倹顑欓崕鏃傗偓瑙勬礀閻栧吋淇婇幖浣肝ㄦい鏂垮悑椤旀捇姊婚崒娆戭槮闁圭⒈鍋婅棟濞村吋娼欓崹鍌炴煠缁嬭法浠涚紓宥呮喘閺屾盯顢曢悩鎻掑闂佹娊鏀遍崹鍦閹惧瓨濯撮柤娴嬪墲閸ㄥ潡宕哄☉銏犵婵°倓鑳堕崢鍗炩攽閳藉棗鐏ｅ┑顔芥尦楠炲﹪骞囬鐘灃?
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

      // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌熼梻瀵割槮缁炬儳娼￠弻鐔衡偓鐢殿焾瀛濈紓浣界堪閸婃繈寮婚敃鈧灒濞撴凹鍨遍敍鍡椻攽閻愬弶鈻曞ù婊勭箞瀵彃顭ㄩ崼鐔哄幗闂侀€涘嵆濞佳勬櫠椤曗偓楠炴牠寮堕幋顖濆惈濠殿喖锕ㄥ▍锝囧垝濞嗘垶宕夐柕濞у倻绀冮梻鍌欒兌椤牓顢栭崶顒€纾婚柕鍫濇噽閺嗭箓鏌熸潏鍓х暠閸ュ瓨绻濋姀锝嗙【妞ゆ垵娲畷銏ゎ敂閸涱垳鐦堥梺姹囧灲濞佳勭瑜旈弻娑氣偓锝庡亝鐏忣參鏌嶇拠鑼х€规洏鍔戦、娑橆煥閸滃啰搴婇梻鍌欑窔閳ь剛鍋涢懟顖涙櫠鐎电硶鍋撶憴鍕鐎规洦鍓熼崺銉﹀緞婵炵偓鐎婚梺鐟扮摠缁诲倻绮婚妷銉㈡斀闁绘ê鐏氶弳鈺呮煕鐎ｎ偆娲撮柟顔ㄥ洤骞㈡繛鎴炵懃閳ь剝鍩栫换婵嬫濞戝崬鍓伴梺鍛婂灩婵炩偓闁哄本娲熷畷鐓庘攽閸パ屸偓娑㈡⒑缂佹ɑ鐓ユ俊顐ｇ箞楠炲啳銇愰幒鎴滅炊闂佸憡娲﹂崜姘跺磿閹炬剚娓婚柕鍫濇噺缁傚鏌涘▎蹇撴殻鐎?
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

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑鐐烘偋閻樻眹鈧線寮撮姀鐘靛幈濠殿喗锕╅崢浠嬪Φ濠靛棌鏀介梽鍥春閺嵮屽殫闁告洦鍘搁崑鎾绘晲鎼存繄鑳哄┑鈥冲级閸旀瑥顫忕紒妯肩懝闁逞屽墮椤洩顦跺褎绻堝娲传閸曨剙娅ら梺鐑╂櫓閸ㄥ爼鐛箛娑樼闁挎棁妫勬禍婊堟煟韫囨挾绠ｉ柣鎺炵畵瀵剟鍩€椤掑嫭鈷掑ù锝堟鐢盯鎷戞潏鈺傚枑闁哄鐏濋弳锝嗐亜閵忊剝顥堟い銏℃礋婵″爼宕堕…鎺旂闂傚倷绀侀幉锟犳偡閿濆纾块柟鎯板Г閸庢绻涢崱妯诲鞍闁绘挻绋撻埀顒€鍘滈崑鎾绘煃瑜滈崜鐔风暦娴兼潙鍐€妞ゆ挾濮寸粊锕傛⒑缁洖澧查柛鎴犳嚀鍗卞Δ锝呭暞閳锋垿鏌熺粙鎸庢崳闁宠棄顦辩槐鎺撳緞婵犲嫮楔閻庢鍠栭…鐑藉箖閵忋倕绀傞柣鎾崇凹閹綁姊虹拠鑼闁稿濮鹃。楣冩⒑閸濆嫷鍎忛柟铏～蹇撁洪鍕炊闂佸憡娲﹂崢楣冨礉閸︻厾纾介柛灞炬皑灏忛梺缁樺釜闂勫嫮绮氭潏銊х瘈闁搞儜鍜佸晣濠电偠鎻紞鈧柛濠佺矙婵℃悂鍩￠崒婊冨妇濠电姰鍨奸崺鏍晪闂佸搫顑嗛悷褏妲愰幒鎾寸秶闁靛绠戦弳妤冪磽娴ｄ粙鍝洪柟鐟版搐閻ｇ兘骞掗幋鏃€鐎婚梺瑙勬儗閸樺€熲叺濠电姷鏁告慨顓㈠箯閸愵喖绀冩い鏃傚帶閸欏﹪鏌ｆ惔銈庢綈婵炲弶鍨垮畷锟犲礃瀹割喖娈ㄩ梺绋匡功閸ｃ儱危妤ｅ啯鈷戦柛婵嗗閿涙棃姊婚崟顐㈩伀闁瑰箍鍨归埞鎴犫偓锝庡亽濡啫鈹戦悙鏉戠仴鐎规洦鍓熷畷婊勫鐎涙ǚ鎷虹紓鍌欑劍钃遍悘蹇斿缁辨帞鈧綆鍋勯悘瀛樼節閳ь剚绗熼埀顒€顫忓ú顏勭閹艰揪绲块悾鐢告⒑閻熸澘鏆辩紒缁樏悾鐑筋敍閻愭潙鈧兘鏌ｉ幋鐑嗙劷闁告ü绮欏娲箰鎼淬埄姊块梺绋款儐閸旀鍒掗弮鍫晩闁兼亽鍎卞?
  const updateEvaluationCache = (evaluationId: string, updates: Partial<EvaluationCacheData>) => {
    const cached = evaluationCache.get(evaluationId);
    if (cached) {
      evaluationCache.set(evaluationId, { ...cached, ...updates });
    }
  };

  const clearEvaluationCache = (evaluationId: string) => {
    evaluationCache.delete(evaluationId);
  };

  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑鐐烘偋閻樻眹鈧線寮撮姀鐘靛幈濠殿喗锕╅崢浠嬪Φ濠靛棌鏀介梽鍥春閺嵮屽殫闁告洦鍘搁崑鎾绘晲鎼存繄鑳哄┑鈥冲级閸旀瑥顫忕紒妯肩懝闁逞屽墮椤洩顦跺褎绻堝娲传閸曨剙娅ら梺鐑╂櫓閸ㄥ爼鐛箛娑樼闁挎棁妫勬禍婊堟煟韫囨挾绠ｉ柣鎺炵畵瀵剟鍩€椤掑嫭鈷掑ù锝堟鐢盯鏌ㄥ鎵佸亾濞堝灝鏋涢柣鏍с偢閻涱噣寮介鐐电杸濡炪倖鏌ㄦ晶浠嬫晬濠婂牊鈷戦梺顐ゅ仜閼活垱鏅剁€电硶鍋撶憴鍕鐎规洦鍓濋悘鎺楁⒑闂堚晛鐦滈柛姗€绠栭幃鐐偅閸愨斁鎷绘繛鎾村焹閸嬫挻绻涙担鍐叉处閸嬪鏌涢埄鍐槈缂佺姷濞€楠炴牠骞栭鐘插弗闂佽桨绀侀崐鍧楀蓟閺囩喎绶為柛鈩兩戦悵鏇㈡⒑缂佹ɑ灏柛鐔跺嵆楠炲绮欏▎鍓у弳闂佸壊鍋呯换鍕囬鐐╂斀闁绘劕寮堕ˉ鐐烘煙閸涘﹥鍊愰柟顔兼健椤㈡岸鍩€椤掑嫬钃熼柣鏂跨殱閺嬫棃鏌涢…鎴濇灍闁诲繐绉撮—鍐Χ鎼粹€茬凹濠电偠灏欓崰鏍ь嚕婵犳碍鍋勯柣鎾虫捣椤斿姊洪柅娑樺祮婵炰匠鍐ｆ灁妞ゆ挾濮风壕钘壝归敐鍛儓闂夊鎮楃憴鍕闁轰礁顭峰畷娲焵椤掍降浜滈柟鐑樺灥閺嬨倖绻涢崗鐓庡缂佺粯鐩畷锝嗗緞鐏炶В鍚傞梺缁樻尪閸婃繈寮婚妸鈺佸嵆闁绘劖绁撮崑鎾诲传閵壯傜瑝?
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
      // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌ｉ幋锝呅撻柛銈呭閺屾盯顢曢敐鍡欙紩闂侀€炲苯澧剧紒鐘虫尭閻ｉ攱绺界粙娆炬綂闂佺偨鍎遍崯璺ㄨ姳閵夆晜鈷掑ù锝囩摂濞兼劕顭块悷鐗堫棡闁哄懓娉涜灃闁告侗鍘鹃敍娑㈡煟鎼搭垳绉甸柛鐘愁殜閹€斥枎閹惧鍘靛┑鐐茬墕閻忔繈寮稿☉娆嶄簻闁挎繂鎳岄崑銏ゆ煛鐏炲墽鈯曢柟顖涙閺佸秹宕熼幊宄版处閻撴稓鈧厜鍋撻悗锝庡墰琚﹂柣搴㈩問閸ｎ噣宕滈悢椋庢殾鐟滅増甯╅弫濠囨煢濡警妲撮柛瀣崌椤㈡盯鎮欑划瑙勫?API 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋挎瀬鐎广儱顦粈瀣亜閹哄秶鍔嶆い鏂挎处缁绘繂顕ラ柨瀣凡闁逞屽墯濞茬喎鐣烽娑橆嚤閻庢稒锚閸撶懓鈹戦悙鍙夘棡闁圭顭烽幃鈥斥枎閹炬潙鈧敻鏌ｉ姀鈽嗗晱闁绘帡绠栧畷顖炲传閵壯咃紲闂佽鍨庨崘顏嗏棨缂傚倷绶￠崰妤呮偡閳轰緡鍤曞┑鐘崇閸嬪嫰鏌ｉ幘铏崳妞ゆ柨顦靛楦裤亹閹烘垳鍠婇梺鍝ュ暱閺呮盯鈥﹂妸鈺侀唶闁绘柨鎼獮鍫ユ⒒娴ｇ懓顕滄俊顐＄窔椤㈡俺顦归柣娑卞櫍楠炲洭鎮ч崼銏犲箞闂佽鍑界紞鍡涘磻閸涱厾鏆︾€光偓閸曨剛鍘告繛杈剧悼閹虫挻鎱ㄩ崼銉︾厵妞ゆ牗绋掗ˉ鍫ユ煕閵婏箑鍔ら柣锝囧厴瀹曞墎鎹勯悜妯荤彣婵犵數濮烽弫鍛婃叏閻戝鈧倹绂掔€ｎ亞鍔﹀銈嗗坊閸嬫捇鏌涢悢缁樼《闁汇儺浜ｉˇ褰掓煛瀹€鈧崰鏍€佸▎鎾村亗閹煎瓨锚娴滈箖鏌涢…鎴濇珮闁搞倖娲栭埞鎴︽偐瀹曞浂鏆￠梺鍝勬噺瑜板啴鈥﹂崸妤佸殝闁汇垻鍋ｉ埀顒佸笧缁辨帞鈧綆浜炵粻鐗堛亜椤忓嫬鏆ｅ┑鈥崇埣瀹曞崬螖閳ь剙顭囬幋锔解拺缂佸顑欓崕鎰版煙閸涘﹥鍊愰柛鈺冨仱楠炲鏁傜粵瀣у亾閹邦兘鏀介柣鎰级鐎氬懐绱掗幓鎺斾虎閸?
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

    // 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕婵犲倹鍋ラ柡灞诲姂瀵挳鎮欏ù瀣壕闁归棿鐒︾€氬懘鏌ｉ弬鍨倯闁绘挸绻愰埞鎴︽倷闂堟稐澹曞┑鐐叉噺閹瑰洭寮婚埄鍐╁缂佸顑欐导鍐⒑閸濆嫭婀扮紒瀣灴閸┿儲寰勯幇顒傤攨闂佺粯鍔樼亸娆擃敊閹烘鈷掑ù锝呮啞閹牊淇婇銏ゅ弰鐎规洘鍔曢埞鎴犫偓锝庝海閹芥洖鈹戦悙鏉戠仧闁搞劌缍婇幃鐐裁洪鍛幈闂佸綊鍋婇崜娆撳煕閺冨牊鐓曢柡鍐ㄥ€搁崢瀛樻叏婵犲倹鎯堥柣锝囧厴瀹曞爼濡搁妷锔炬殮缂傚倸鍊风粈渚€藝闁秴鏋侀柟闂寸缁犳煡鏌曡箛鏇炐涢柡鈧禒瀣€甸柨婵嗛娴滆姤淇婇銏犳殭闁宠鍨块幃娆撳级閹寸姳妗撻梻浣藉吹閸ｃ儵宕归幏宀€浜遍梻渚€娼ч悧鍡浰囨导鏉戠厱闁硅揪闄勯悡鏇㈡煥閺冨浂鍤欐鐐搭殕缁绘盯宕ㄩ鐣岊槬闂佸疇顫夐崹鍧楀箖濞嗘挸鐓涘ù锝呭槻椤ユ岸姊婚崒姘偓椋庣矆娓氣偓楠炴牠顢曢敃鈧€氬銇勯幒鎴濐仾闁稿骸瀛╅妵鍕冀椤愵澀鎴烽悗瑙勬尫缁舵岸寮婚悢鍏煎€绘慨妤€妫欓悾璺衡攽閳藉棗浜濋拑杈╃磼缂佹娲寸€规洖宕埢搴ょ疀鎼粹槅妫滃┑鐘愁問閸ｎ垳寰婃禒瀣庡洭妫冨☉杈ㄧ稁缂傚倷鐒﹁摫濠殿垱鎸抽弻娑樷槈濮楀牊鏁鹃梺绋垮閹告悂鍩為幋锕€鐓￠柛鈩冦仦缁ㄥジ姊洪悜鈺傛珦闁搞劋鍗抽幃楣冩煥鐎ｎ亶鍤ら梺鍝勵槹閸ㄧ敻宕妸銉富闁靛牆妫欑亸闈涒攽椤旂⒈鍤熺紒顔硷躬閺佸啴宕掑☉鎺撳缂備胶铏庨崢濂稿箠韫囨哎浜圭憸鏃堝箖濡ゅ懏顥堟繛鎴炴皑閸旑垶鎮楀▓鍨珮闁稿鎳愰幑銏犫攽鐎ｎ亞鍊為梺闈浤涢崘銊ь啋婵犵數濮烽弫鎼佸磻閻愬樊鐒芥繛鍡樻惄閺佸嫰鏌涢埄鍐︿粶闁哄绉归弻娑㈠焺閸愵亖濮囬梺?
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

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌ｉ幋锝呅撻柛銈呭閺屾盯顢曢敐鍡欙紩闂侀€炲苯澧剧紒鐘虫尭閻ｉ攱绺界粙娆炬綂闂佺偨鍎遍崯璺ㄨ姳閵夆晜鈷掑ù锝囩摂濞兼劕顭块悷鐗堫棡闁哄懓娉涜灃闁告侗鍘鹃敍娑㈡煟鎼搭垳绉甸柛鐘愁殜閹€斥枎閹惧鍘靛┑鐐茬墕閻忔繈寮稿☉娆嶄簻闁挎繂鎳岄崑銏ゆ煛鐏炲墽鈯曢柟顖涙閺佸秹宕熼幊宄版处閻撴稓鈧厜鍋撻悗锝庡墰琚﹂柣搴㈩問閸ｎ噣宕滈悢椋庢殾鐟滅増甯╅弫濠囨煢濡警妲撮柛瀣崌椤㈡盯鎮欑划瑙勫?API 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋挎瀬鐎广儱顦粈瀣亜閹哄秶鍔嶆い鏂挎喘濮婄粯鎷呴搹鐟扮闂佸憡姊瑰ú鐔笺€佸棰濇晣闁绘ê鍚€缁楀淇婇妶蹇曞埌闁哥噥鍨堕幃锟犲礃椤忓懎鏋戝┑鐘诧工閻楀棛绮堥崼鐔稿弿婵☆垰娼￠崫铏光偓?
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
      // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌ｉ幋锝呅撻柛銈呭閺屾盯顢曢敐鍡欙紩闂侀€炲苯澧剧紒鐘虫尭閻ｉ攱绺界粙娆炬綂闂佺偨鍎遍崯璺ㄨ姳閵夆晜鈷掑ù锝囩摂濞兼劕顭块悷鐗堫棡闁哄懓娉涜灃闁告侗鍘鹃敍娑㈡煟鎼搭垳绉甸柛鐘愁殜閹€斥枎閹惧鍘靛┑鐐茬墕閻忔繈寮稿☉娆嶄簻闁挎繂鎳岄崑銏ゆ煛鐏炲墽鈯曢柟顖涙閺佸秹宕熼幊宄版处閻撴稓鈧厜鍋撻悗锝庡墰琚﹂柣搴㈩問閸ｎ噣宕滈悢椋庢殾鐟滅増甯╅弫濠囨煢濡警妲撮柛瀣崌椤㈡盯鎮欑划瑙勫?API 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋挎瀬鐎广儱顦粈瀣亜閹哄秶鍔嶆い鏂挎处缁绘繂顕ラ柨瀣凡闁逞屽墯濞茬喎鐣烽娑橆嚤閻庢稒锚閸撶懓鈹戦悙鍙夘棡闁圭顭烽幃鈥斥枎閹炬潙鈧敻鏌ｉ姀鈽嗗晱闁绘帡绠栧畷顖炲传閵壯咃紲闂佽鍨庨崘顏嗏棨缂傚倷绶￠崰妤呮偡閳轰緡鍤曞┑鐘崇閸嬪嫰鏌ｉ幘铏崳妞ゆ柨顦靛楦裤亹閹烘垳鍠婇梺鍛婃尰閻╊垰鐣烽姀銈庢晝闁挎梻鏅崢浠嬫煙閸忚偐鏆橀柛銊ヮ煼閵嗗倿鎳犻钘変壕闁稿繐顦禍楣冩⒑瑜版帗锛熺紒鈧笟鈧幏鎴︽偄閸濄儳顔曢梺鐟扮摠閻熴儵鎮橀埡鍛厱婵°倓绀侀埢鏇㈡煛鐏炵偓绀冪紒缁樼洴瀹曞綊顢欓悡搴經濠碉紕鍋戦崐銈夊磻閹烘纾诲┑鐘插亞濞兼牗绻涘顔荤凹妞ゃ儱鐗婄换娑㈠箣閻愯泛顥濆銈冨€愰崑鎾绘⒒閸屾瑨鍏岄柟铏崌楠炲鍩勯崘顏嗩啎婵犵數濮撮崑鍡涘吹閺囩偐鏀介柣妯虹枃婢规﹢鏌ｈ箛鏂库枙闁哄瞼鍠愰敍鎰媴娓氼垱袦闂備浇顕栭崰妤呭垂閸噮娼栨繛宸簻瀹告繂鈹戦悩杈厡缂佽绶氬娲传閵夈儛锝嗐亜閵娿儻韬柣娑卞櫍瀹曟﹢濡搁姀锛勨偓濠氭⒑閻熸澘鈷旈悶娑栧劦楠?
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

    // 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕婵犲倹鍋ラ柡灞诲姂瀵挳鎮欏ù瀣壕闁归棿鐒︾€氬懘鏌ｉ弬鍨倯闁绘挸绻愰埞鎴︽倷闂堟稐澹曞┑鐐叉噺閹瑰洭寮婚埄鍐╁缂佸顑欐导鍐⒑閸濆嫭婀扮紒瀣灴閸┿儲寰勯幇顒傤攨闂佺粯鍔樼亸娆擃敊閹烘鈷掑ù锝呮啞閹牊淇婇銏ゅ弰鐎规洘鍔曢埞鎴犫偓锝庝海閹芥洖鈹戦悙鏉戠仧闁搞劌缍婇幃鐐裁洪鍛幈闂佸綊鍋婇崜娆撳煕閺冨牊鐓曢柡鍐ㄥ€搁崢瀛樻叏婵犲倹鎯堥柣锝囧厴瀹曞爼濡搁妷锔炬殮缂傚倸鍊风粈渚€藝闁秴鏋侀柟闂寸缁犳煡鏌曡箛鏇炐涢柡鈧禒瀣€甸柨婵嗛娴滆姤淇婇銏犳殭闁宠鍨块幃娆撳级閹寸姳妗撻梻浣藉吹閸ｃ儵宕归幏宀€浜遍梻渚€娼ч悧鍡浰囨导鏉戠厱闁硅揪闄勯悡鏇㈡煥閺冨浂鍤欐鐐搭殕缁绘盯宕ㄩ鐣岊槬闂佸疇顫夐崹鍧楀箖濞嗘挸鐓涘ù锝呭槻椤ユ岸姊婚崒姘偓椋庣矆娓氣偓楠炴牠顢曢敃鈧€氬銇勯幒鎴濐仾闁稿骸瀛╅妵鍕冀椤愵澀鎴烽悗瑙勬尫缁舵岸寮婚悢鍏煎€绘慨妤€妫欓悾璺衡攽閳藉棗浜濋拑杈╃磼缂佹娲寸€规洖宕埢搴ょ疀鎼粹槅妫滃┑鐘愁問閸ｎ垳寰婃禒瀣庡洭妫冨☉杈ㄧ稁缂傚倷鐒﹁摫濠殿垱鎸抽弻娑樷槈濮楀牊鏁鹃梺绋垮閹告悂鍩為幋锕€鐓￠柛鈩冦仦缁ㄥジ姊洪悜鈺傛珦闁搞劋鍗抽幃楣冩煥鐎ｎ亶鍤ら梺鍝勵槹閸ㄧ敻宕妸銉富闁靛牆妫欑亸闈涒攽椤旂⒈鍤熺紒顔硷躬閺佸啴宕掑☉鎺撳缂備胶铏庨崢濂稿箠韫囨哎浜圭憸鏃堝箖濡ゅ懏顥堟繛鎴炴皑閸旑垶鎮楀▓鍨珮闁稿鎳愰幑銏犫攽鐎ｎ亞鍊為梺闈浤涢崘銊ь啋婵犵數濮烽弫鎼佸磻閻愬樊鐒芥繛鍡樻惄閺佸嫰鏌涢埄鍐︿粶闁哄绉归弻娑㈠焺閸愵亖濮囬梺?
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

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌ｉ幋锝呅撻柛銈呭閺屾盯顢曢敐鍡欙紩闂侀€炲苯澧剧紒鐘虫尭閻ｉ攱绺界粙娆炬綂闂佺偨鍎遍崯璺ㄨ姳閵夆晜鈷掑ù锝囩摂濞兼劕顭块悷鐗堫棡闁哄懓娉涜灃闁告侗鍘鹃敍娑㈡煟鎼搭垳绉甸柛鐘愁殜閹€斥枎閹惧鍘靛┑鐐茬墕閻忔繈寮稿☉娆嶄簻闁挎繂鎳岄崑銏ゆ煛鐏炲墽鈯曢柟顖涙閺佸秹宕熼幊宄版处閻撴稓鈧厜鍋撻悗锝庡墰琚﹂柣搴㈩問閸ｎ噣宕滈悢椋庢殾鐟滅増甯╅弫濠囨煢濡警妲撮柛瀣崌椤㈡盯鎮欑划瑙勫?API 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋挎瀬鐎广儱顦粈瀣亜閹哄秶鍔嶆い鏂挎喘濮婄粯鎷呴搹鐟扮闂佸憡姊瑰ú鐔笺€佸棰濇晣闁绘ê鍚€缁楀淇婇妶蹇曞埌闁哥噥鍨堕幃锟犲礃椤忓懎鏋戝┑鐘诧工閻楀棛绮堥崼鐔稿弿婵☆垰娼￠崫铏光偓?
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
      ? formatDateTime(uniqueRuns[0].startedAt)
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
      showToast('info', t('retryScoresRunning', { defaultValue: '评分重试正在后台执行，请稍候' }));
      return;
    }
    if (selectedRun.status === 'pending' || selectedRun.status === 'running') {
      showToast('info', t('runStillRunning', { defaultValue: '当前执行记录仍在运行中' }));
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

      // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑鐐烘偋閻樻眹鈧線寮撮姀鐘靛幈濠殿喗锕╅崢浠嬪Φ濠靛棌鏀介梽鍥春閺嵮屽殫闁告洦鍘搁崑鎾绘晲鎼存繄鑳哄┑鈥冲级閸旀瑥顫忕紒妯肩懝闁逞屽墮椤洩顦跺褎绻堝娲传閸曨剙娅ら梺鐑╂櫓閸ㄥ爼鐛箛娑樼闁挎棁妫勬禍婊堟煟韫囨挾绠ｉ柣鎺炵畵瀵剟鍩€椤掑嫭鈷掑ù锝堟鐢盯鎷戞潏鈺傚枑闁哄鐏濋弳锝嗐亜閵忊剝顥堟い銏℃礋婵″爼宕堕…鎺旂闂傚倷绀侀幉锟犳偡閿濆纾块柟鎯板Г閸庢绻涢崱妯诲鞍闁绘挻绋撻埀顒€鍘滈崑鎾绘煃瑜滈崜鐔风暦娴兼潙鍐€妞ゆ挾濮寸粊锕傛⒑缁洖澧查柛鎴犳嚀鍗卞Δ锝呭暞閳锋垿鏌熺粙鎸庢崳闁宠棄顦辩槐鎺撳緞婵犲嫮楔閻?
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

      // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻鐔兼⒒鐎靛壊妲紒鐐劤椤兘寮婚敐澶婄疀妞ゆ帊鐒﹂崕鎾剁磽娴ｅ搫小闁告濞婂濠氭偄閸忓皷鎷婚柣搴ㄦ涧婢瑰﹤危椤斿墽纾藉ù锝呮惈鍟告繝娈垮枛閻忔氨绮氭潏銊х瘈闁搞儴鍩栭弲顒€鈹戦悩缁樻锭閻庢皜鍥х；闁规崘顕ч悞鍨亜閹烘垵顏柣鎾寸洴閹鏁愭惔婵堟晼闁轰礁鐗嗚灃闁绘﹢娼ф禒锕傛煟濡や緡娈旀い顓炴穿缁犳稑鈽夊Ο纰辨Ф闁荤喐绮岄柊锝呯暦閹达綆妲剧紓浣介哺鐢繝鐛崱姘兼Щ缂傚倸绉甸悧婊呮閹烘鏁婇柣锝呮湰閸ｄ即鎮楀▓鍨灈妞ゎ厾鍏橀獮鍐閵堝棗浜楅柟鑹版彧缁插潡寮虫导瀛樼厽闁绘柨鎽滈惌濠勭磼缂佹﹫鑰跨€殿噮鍋勯濂稿椽娴ｅ憡鍊┑鐘灱濞夋盯顢栭崶顒€鍌?
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

  // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻愰湁闁稿繐鍚嬬紞鎴︽煕閵娿儱鈧潡寮婚敐澶婄鐎规洖娲ら崫娲⒑閸濆嫷鍎愰柣妤侇殘閹广垹鈽夐姀鐘殿吅闂佺粯鍔樼亸娆撳礉娴煎瓨鈷戠紒瀣儥閸庢劙鏌熼崨濠冨€愰柨婵堝仜閳规垹鈧綆鍋勬禍妤呮煙閸忚偐鏆橀柛銊︽閵囨劖鎯旈～顓犵畾闂侀潧鐗嗗ú銈呮毄闂備胶顭堥鍡涙儎椤栨氨鏆︽い鏍剱閺佸秵绻濇繝鍌氼仼閹兼潙锕ら埞鎴︽偐缂佹ɑ閿銈嗗灥閹虫劖绔熼弴鐔虹瘈婵﹩鍘鹃崢浠嬫⒑閹稿海绠撻柟铏尵閳ь剚鐭崡鎶藉蓟閿涘嫧鍋撻敐搴′簽婵炲弶鎸抽弻锛勪沪閸撗勫垱婵犵鍓濋幃鍌炲极閸愵喖鐒垫い鎺戝缁€澶愭煏閸繍妲归柣鎾跺枛閺屻劌鈹戦崱妯绘倷闂佸憡锚椤曨參鍩€椤掑喚娼愭繛鍙夌墵閹儲绺界粙鎸庣€梺鍦濠㈡ê顔忓┑鍥ヤ簻闁瑰搫妫楁禍鎯ь渻閵堝啫鍔滅€光偓缁嬫娼栫紓浣股戞刊鎾煣韫囨洘鍤€缂佹绻濆娲箹閻愭彃顬嬮梺鍛婎焼閸℃瑤缃曢梻鍌欑閹测€趁洪敃鍌氬瀭闂侇剙绉寸壕鎸庝繆閵堝嫭顦风紒璇叉閺屾洟宕煎┑鍥ф闂侀潻绲惧浠嬪蓟閿濆绠婚悗娑欘焽椤︿即姊虹拠鈥虫灍闁挎洏鍨介獮鍐ㄢ枎閹惧磭顔岄梺鐟版惈濡瑧鈧灚鐗犲缁樻媴閻熸澘顫梺鎼炲妼瀹曨剛鍙呭┑鈽嗗灠閸氬鐣烽崣澶岀闁瑰瓨鐟ラ悘鈺呮⒑閸楃偞澶勭紒缁樼箞濡啫鈽夊顒夋毇闂備胶绮幐楣冨窗閺嵮屾綎婵炲樊浜滄导鐘绘煕閺囥劌澧柟鐤含缁辨挻鎷呴崜鎻掑壉闂佹悶鍔屽鈥崇暦濞差亜顫呴柍鈺佸暙閸斿懘姊洪棃娑辩劸闁稿孩濞婇幃鐐偅閸愨斁鎷洪梺闈╁瘜閸欏酣鎮為幆顬棃鎮╅搹顐⑩偓鎰版煙椤旀枻鑰垮┑锛勫厴閸╋繝宕掑顐ゆ殫?
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

  // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻愰湁闁稿繐鍚嬬紞鎴︽煕閵娿儱鈧潡寮婚敐澶婄鐎规洖娲ら崫娲⒑閸濆嫷鍎愰柣妤侇殘閹广垹鈽夐姀鐘殿吅闂佺粯鍔樼亸娆撳礉娴煎瓨鈷戠紒瀣儥閸庢劙鏌熼崨濠冨€愰柨婵堝仜閳规垹鈧綆鍋勬禍妤呮煙閸忚偐鏆橀柛銊︽閵囨劖鎯旈～顓犵畾闂侀潧鐗嗗ú銈呮毄闂備胶顭堥鍡涙儎椤栨氨鏆︽い鏍剱閺佸秵绻濇繝鍌氼仼閹兼潙锕ら埞鎴︽偐缂佹ɑ閿銈嗗灥閹虫﹢骞冨▎鎰瘈闁告洦鍓欓弸鎴︽椤愩垺澶勯柧鏂款儔瀹曞爼顢斿鍡忔瀸闂傚倷绀侀幖顐︽儗婢跺苯绶ゅΔ锝呭暙缁犳岸鏌￠崘銊у闁绘帗妞介弻娑㈠箛闂堟稑绠诲銈冨灩閹冲酣鍩為幋锔藉亹闁归绀侀弲閬嶆⒑閸濄儱校闁绘绮嶇粩鐔煎即閵忊晜鏅ｉ梺闈涚箳婵兘藝?Prompt 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋挎瀬闁瑰墽绮崑鎰版煕閹邦垰绱﹂柣銏狀煼濮婄粯鎷呴悷閭﹀殝濠电偛寮堕崹鍧楀箖閻愮儤鏅濋柛灞炬皑閻ゅ洭鏌ｈ箛鏇炰粶濠⒀呮櫕瀵囧焵椤掑嫭鈷戞慨鐟版搐閻忓弶绻涙担鍐插椤╃兘鏌ㄩ弮鍌氫壕闁哥姵鍔欓弻鈩冨緞婵犲嫪铏庨梺鍝勬閻燂箓濡甸崟顖ｆ晣闁绘劖娼欓弸鐘绘⒑閹肩偛濮傜紒鐘崇墵閻涱噣宕堕妸锕€顎撻梺鍛婄☉椤剟宕ュ▎蹇婃斀闁挎稑瀚禍濂告煕婵犲啰澧悡銈団偓骞垮劚椤︻垳澹曟繝姘厵闁诡垎鍛偗闂佺顑嗛幐楣冨箟閹绢喖绀嬫い鎺戝亞濡叉壆绱撻崒娆戣窗闁哥姵鐗滅划鏃囥亹閹烘柨绁﹂棅顐㈡处缁嬫垵顔忓┑瀣€垫繛鎴烆仾椤忓懐顩锋い鎾卞灪閳锋垿鎮峰▎蹇擃伌闁哥喎绻橀弻娑㈡偐瀹曞洤鈷岄梺缁樹緱閸ｏ絽鐣锋總绋课ㄩ柨鏃囶潐鐎氫粙姊绘担渚劸闁哄牜鍓熼幃鐤樄閽樻繈鏌ㄩ弬鍨挃缁惧墽鏅埀顒€绠嶉崕閬嶅箯閹存繍鍟呴柕澶涜礋娴滄粍銇勯幘璺轰沪缂佸本瀵ч妵鍕晝閳ь剛绱炴繝鍥ц摕闁绘梻鈷堥弫濠囨煟椤撗冧航濞存粠浜畷娲倷閸濆嫮顓洪梺鎸庢磵閸嬫挻顨ラ悙顏勭伈闁哄苯绉靛顏堝箥椤旂厧顬夋俊鐐€栭幐鑽も偓绗涘嫮鈹嶅┑鐘叉处閸婇攱銇勮箛鎾愁仱闁稿鎹囧浠嬵敃閿濆棙顔囬梻浣告贡閸庛倝寮婚敓鐘茬；闁圭偓鍓氬鈺呮煟閹炬娊顎楅柍宄邦儔閹?
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

      // Backward-compatible: localize legacy auto-generated titles from different locales.
      const singleMatch = /^(?:Single Run|单轮分析|單輪分析|単一実行)\s*[:：]\s*(.+)$/i.exec(trimmedTitle);
      if (singleMatch) {
        const label = singleMatch[1]?.trim();
        if (!label) return defaultTitle;
        return t('analysisAutoTitleSingle', { label });
      }

      const multiMatch = /^(?:Multi Run|多轮分析|多輪分析|複数実行)\s*[（(]\s*(.+?)\s*[）)]$/i.exec(trimmedTitle);
      if (multiMatch) {
        const rawLabel = multiMatch[1]?.trim();
        const legacyCountMatch = rawLabel
          ? /^(\d+)\s*(?:runs?|条运行|條執行|件の実行)?$/i.exec(rawLabel)
          : null;
        const label = legacyCountMatch
          ? t('analysisRunCount', { count: Number(legacyCountMatch[1]) })
          : rawLabel || t('analysisRunCount', { count: Math.max(report.runIds.length, 2) });
        return t('analysisAutoTitleMulti', { label });
      }

      if (
        trimmedTitle === 'analysisAutoTitleSingle' ||
        ['Single-Run Analysis', '鍗曡疆鍒嗘瀽', '鍠吉鍒嗘瀽', '鍗樹竴瀹熻鍒嗘瀽'].includes(trimmedTitle)
      ) {
        return t('analysisAutoTitleSingle', { label: defaultTitle });
      }

      if (
        trimmedTitle === 'analysisAutoTitleMulti' ||
        ['Multi-Run Analysis', '澶氳疆鍒嗘瀽', '澶氳吉鍒嗘瀽', '瑜囨暟瀹熻鍒嗘瀽'].includes(trimmedTitle)
      ) {
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

  const openPrivateShareModal = async () => {
    if (!selectedEvaluation) return;
    setPrivateShareModalOpen(true);
    setPrivateShareLoading(true);
    try {
      const link = await shareApi.createLink({
        resourceType: 'evaluation',
        resourceId: selectedEvaluation.id,
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

      const shareUrl = new URL(`/share/e/${updated.token}`, window.location.origin).toString();
      await navigator.clipboard.writeText(shareUrl);
      showToast('success', tCommon('privateShareCreatedAndCopied'));
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setPrivateShareSaving(false);
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
                          <button
                            onClick={() => {
                              if (!selectedEvaluation.isPublic) {
                                openPublishModal();
                                return;
                              }
                              void handleSetEvaluationPrivate();
                            }}
                            disabled={submittingNewVersion || publishing}
                            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
                              selectedEvaluation.isPublic
                                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 light:border-emerald-300 light:bg-emerald-50 light:text-emerald-700'
                                : 'border-slate-600/70 bg-slate-800/70 text-slate-200 hover:bg-slate-700 light:border-slate-300 light:bg-slate-100 light:text-slate-600 light:hover:bg-slate-200'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                            title={selectedEvaluation.isPublic ? t('clickToPrivate') : t('clickToPublic')}
                          >
                            <Globe className="w-3.5 h-3.5" />
                            {selectedEvaluation.isPublic ? t('public') : t('private')}
                          </button>
                        </>
                      ) : (
                        <Badge variant={selectedEvaluation.isPublic ? 'success' : 'info'}>
                          {selectedEvaluation.isPublic ? t('public') : t('private')}
                        </Badge>
                      )}
                      {(isSelectedEvaluationOwner || selectedEvaluation.isPublic) && (
                        <div className="inline-flex items-center gap-1">
                          {isSelectedEvaluationOwner && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => void openPrivateShareModal()}
                              disabled={submittingNewVersion}
                              className="h-8 px-3"
                            >
                              <Link className="w-4 h-4" />
                              <span>{tCommon('privateShare')}</span>
                            </Button>
                          )}
                          {selectedEvaluation.isPublic && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => void handleCopyEvaluationShareLink(selectedEvaluation.id)}
                              disabled={submittingNewVersion}
                              className="h-8 px-3"
                            >
                              <Link className="w-4 h-4" />
                              <span>{tCommon('shareLink')}</span>
                            </Button>
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
                                    ? t('retryScoresRunning', { defaultValue: '重试中' })
                                    : t('retryScores')}
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
                            <span>{t('abort')}</span>
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
                                    {run ? formatDateTime(run.startedAt ?? run.createdAt) : runId.slice(0, 8)}
                                  </span>
                                );
                              })}
                              <span className="text-slate-500 light:text-slate-600">·</span>
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
                    {t('abort')}
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

      <Modal isOpen={privateShareModalOpen} onClose={closePrivateShareModal} title={tCommon('privateShareSettings')} size="lg">
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
                value={privateShareEvaluationUrl}
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

      {/* 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋婵愭綗闁逞屽墮閸婂潡骞愭繝鍐彾闁冲搫顑囩粔顔锯偓瑙勬磸閸旀垵顕ｉ崼鏇炵婵犻潧鐗冮崑鎾活敇閻戝棙瀵岄梺闈涚墕閹虫劗绮绘导瀛樼厽婵°倐鍋撴俊顐ｇ箞楠炲啴鎮欓崫鍕€銈嗗姉婵磭鑺辨繝姘拺闁荤喓澧楅幆鍫熶繆椤愶綆娈曠紒鍌氱Ч瀹曟粏顦寸痪鎯с偢閺屾盯骞樺Δ鈧Λ娆擃敁濡ゅ懏鈷戦柛娑橈功閹冲啴鏌涢悢鍛婄稇闁伙絽鍢茬叅妞ゅ繐瀚崝锕€顪冮妶鍡楃瑐闂傚嫬绉电粋宥咁煥閸喓鍘甸梺缁樺灦閿氶柣蹇嬪劦閺屽秷顧侀柛鎾村哺楠炲啴宕掑杈ㄦ闂侀潧绻嗛幊鍥磻閹剧粯鍋ㄩ柣銏㈠仯閳ь剙锕弻娑氣偓锝庡亝鐏忕敻鏌熼崣澶嬪唉鐎规洜鍠栭、妤呭磼濡や焦娅栫紓鍌氬€搁崐鎼佸磹閸濄儳鐭撶€规洖娲ㄩ惌鍡椼€掑锝呬壕闂佽鍣ｇ粻鏍箖濠婂牊瀵犲璺虹焾閸炴椽姊绘担鐑樺殌闁宦板妼椤繗銇愰幒鐐电◤閻庡箍鍎遍幊澶愬绩娴犲鐓熼柟閭﹀墮缁狙勩亜閵壯冧槐闁哄本鐩顕€骞橀崜浣规闁诲氦顫夊ú锕傚垂閸洖鏄ラ柍褜鍓氶妵鍕箳閹存繍浠鹃梺鎶芥敱鐢繝寮诲☉姘勃闁硅鍔曢ˉ婵嬫⒑闁偛鑻晶浼存煕韫囨棑鑰挎鐐插暣閹瑩鎮滃Ο缁樼彇闂備線鈧偛鑻晶鎾煃閵夘垳鐣电€规洖缍婇、娆撳Ψ瑜嶉弸娑㈡煙閾忣偆澧甸柛鈺嬬節瀹曟﹢顢旈崟顐ュ姌闂傚倸鍊搁崐椋庣矆娴ｅ湱鐝跺┑鐘叉搐绾惧鏌涘☉鍗炲Ц闁告繂瀚峰銊╂煃瑜滈崜娆撴偩?Modal */}
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



