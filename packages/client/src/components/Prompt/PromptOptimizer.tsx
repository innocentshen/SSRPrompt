import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  Wand2,
  Check,
  X,
  Loader2,
  AlertCircle,
  ArrowRight,
  Trophy,
  Star,
  TrendingUp,
  Settings,
  ChevronDown,
  Database,
  BarChart3,
  FlaskConical,
  Plus,
  Trash2,
} from 'lucide-react';
import type { PromptMessage } from '../../types/database';
import { Button, ModelSelector, Badge } from '../ui';
import type { Model, Provider } from '../../types';
import {
  BUILTIN_META_PROMPTS,
  saveOptimizationSettings,
  getOptimizationSettings,
} from '../../lib/optimization-settings';
import type {
  EvaluationSummary,
  EvaluationListItem,
  EvaluationCriterion,
} from '@ssrprompt/shared';
import type { ChatMessage } from '../../api/chat';
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

interface PromptOptimizerProps {
  messages: PromptMessage[];
  content?: string;
  models: Model[];
  providers: Provider[];
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  onApplySuggestion: (suggestion: OptimizationSuggestion) => void;
  onOptimize: (context?: AutoOptimizeContext) => Promise<OptimizationSuggestion[]>;
  onOpenSettings?: () => void;
  isOptimizing?: boolean;
  analysisResult?: AnalysisResult | null;
  evaluationList?: EvaluationListItem[];
  evaluationSummary?: EvaluationSummary | null;
  selectedEvaluationId?: string;
  onEvaluationSelect?: (evaluationId: string) => void;
}

type OptimizerView = 'analysis' | 'verification';

type VerificationCase = {
  id: string;
  source: 'evaluation' | 'manual';
  testCaseId?: string;
  name: string;
  input: string;
  inputVariables?: Record<string, string>;
  expectedOutput?: string;
  selected: boolean;
  historicalPassRate?: number;
  beforeScore?: number;
  beforePassed?: boolean;
  isFailed?: boolean;
};

type VerificationResult = {
  caseId: string;
  caseName: string;
  output: string;
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

const AUTO_PIPELINE_MAX_ROUNDS = 3;
const AUTO_PIPELINE_TOP_FAILURE_LIMIT = 10;
const AUTO_PIPELINE_VALIDATION_HOLDOUT = 2;
const MANUAL_SEMANTIC_PASS_THRESHOLD = 0.8;

function getScoreColor(score: number): string {
  if (score >= 90) return 'text-green-400 light:text-green-500';
  if (score >= 70) return 'text-amber-400 light:text-amber-500';
  return 'text-red-400 light:text-red-500';
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
  messages,
  content,
  models,
  providers,
  selectedModelId,
  onModelChange,
  onApplySuggestion,
  onOptimize,
  onOpenSettings,
  isOptimizing = false,
  analysisResult,
  evaluationList,
  evaluationSummary,
  selectedEvaluationId,
  onEvaluationSelect,
}: PromptOptimizerProps) {
  const { t } = useTranslation('prompts');
  const [view, setView] = useState<OptimizerView>('analysis');
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>(() => {
    const settings = getOptimizationSettings();
    return settings.selectedTemplate || 'general';
  });

  const [verificationInitialized, setVerificationInitialized] = useState(false);
  const [verificationCases, setVerificationCases] = useState<VerificationCase[]>([]);
  const [manualCaseInput, setManualCaseInput] = useState('');
  const [manualCaseExpected, setManualCaseExpected] = useState('');
  const [verificationResults, setVerificationResults] = useState<VerificationResult[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationMode, setVerificationMode] = useState<'unknown' | 'judge' | 'fallback'>('unknown');
  const [appliedSuggestionIds, setAppliedSuggestionIds] = useState<Record<string, true>>({});
  const [dismissedSuggestionIds, setDismissedSuggestionIds] = useState<Record<string, true>>({});
  const [isAutoPipelineRunning, setIsAutoPipelineRunning] = useState(false);
  const [autoPipelineRound, setAutoPipelineRound] = useState(0);
  const [autoPipelineStatus, setAutoPipelineStatus] = useState('');
  const [expandedResultCaseId, setExpandedResultCaseId] = useState<string | null>(null);

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
  const effectiveSelectedEvaluationId = selectedEvaluationId || evaluationSummary?.evaluationId || '';
  const selectedCaseCount = verificationCases.filter((item) => item.selected).length;

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

  const selectedCasePreview = useMemo(() => {
    const selected = verificationCases.find((item) => item.selected);
    if (!selected) return '';
    const generated = buildCaseMessages(
      messages,
      content,
      selected.input,
      selected.inputVariables || {}
    );
    return formatPromptMessages(generated);
  }, [content, messages, verificationCases]);

  const getScoreLabel = (score: number): string => {
    if (score >= 90) return t('scoreExcellent');
    if (score >= 70) return t('scoreGood');
    if (score >= 50) return t('scoreFair');
    return t('scoreNeedsWork');
  };

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplate(templateId);
    const template = BUILTIN_META_PROMPTS.find((item) => item.id === templateId);
    if (!template) return;

    const settings = getOptimizationSettings();
    saveOptimizationSettings({
      ...settings,
      analysisPrompt: template.prompt,
      selectedTemplate: templateId,
    });
  };

  const runOptimizeOnce = async (
    switchToAnalysis = true,
    context?: AutoOptimizeContext
  ): Promise<OptimizationSuggestion[]> => {
    setError(null);
    if (switchToAnalysis) {
      setView('analysis');
      setVerificationResults([]);
    }

    try {
      const newSuggestions = await onOptimize(context);
      setSuggestions(newSuggestions);
      setHasAnalyzed(true);
      setAppliedSuggestionIds({});
      setDismissedSuggestionIds({});
      return newSuggestions;
    } catch (optimizeError) {
      setError(optimizeError instanceof Error ? optimizeError.message : t('analysisFailed'));
      return [];
    }
  };

  const handleOptimize = async () => {
    await runOptimizeOnce(true);
  };

  const handleApply = (suggestion: OptimizationSuggestion) => {
    onApplySuggestion(suggestion);
    setAppliedSuggestionIds((prev) => ({ ...prev, [suggestion.id]: true }));
  };

  const handleDismiss = (suggestionId: string) => {
    setDismissedSuggestionIds((prev) => ({ ...prev, [suggestionId]: true }));
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

  const addManualCase = () => {
    if (!manualCaseInput.trim()) return;
    const manualCount = verificationCases.filter((item) => item.source === 'manual').length + 1;
    const nextCase: VerificationCase = {
      id: `manual_${Date.now()}`,
      source: 'manual',
      name: `${t('manualCasePrefix')} ${manualCount}`,
      input: manualCaseInput.trim(),
      expectedOutput: manualCaseExpected.trim() || undefined,
      selected: true,
    };
    setVerificationCases((prev) => [...prev, nextCase]);
    setManualCaseInput('');
    setManualCaseExpected('');
  };

  const runVerification = async (casesOverride?: VerificationCase[]): Promise<VerificationResult[] | null> => {
    const selectedCases = (casesOverride || verificationCases).filter((item) => item.selected);
    if (selectedCases.length === 0 || isVerifying) return null;

    setIsVerifying(true);
    let runningResults: VerificationResult[] =
      selectedCases.map((item) => ({
        caseId: item.id,
        caseName: item.name,
        output: '',
        expectedOutput: item.expectedOutput,
        beforeScore: item.beforeScore,
        beforePassed: item.beforePassed,
        status: 'pending',
      }));
    setVerificationResults(runningResults);

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
    const fallbackPassThreshold = Math.max(passThreshold, MANUAL_SEMANTIC_PASS_THRESHOLD);
    const testCaseById = new Map((evaluationDetail?.testCases || []).map((item) => [item.id, item]));
    const verificationModelId = evaluationDetail?.modelId || selectedModelId;
    const semanticJudgeModelId = selectedModelId || verificationModelId;

    if (!verificationModelId) {
      setError(t('selectAnalyzeModelFirst'));
      setIsVerifying(false);
      return null;
    }

    setVerificationMode(useJudgeEvaluation ? 'judge' : 'fallback');

    for (const testCase of selectedCases) {
      runningResults = runningResults.map((result) =>
        result.caseId === testCase.id ? { ...result, status: 'running' } : result
      );
      setVerificationResults([...runningResults]);

      try {
        const evaluationTestCase = testCase.testCaseId ? testCaseById.get(testCase.testCaseId) : undefined;
        const caseInput = evaluationTestCase?.inputText ?? testCase.input;
        const caseVariables = (evaluationTestCase?.inputVariables as Record<string, string>) || testCase.inputVariables || {};
        const expectedOutput = evaluationTestCase?.expectedOutput ?? testCase.expectedOutput;
        const testMessages = buildCaseMessages(messages, content, caseInput, caseVariables);

        const response = await chatApi.complete({
          modelId: verificationModelId,
          messages: testMessages,
          saveTrace: false,
          isEvalCase: true,
        });

        let afterScore: number | undefined;
        let afterPassed: boolean | undefined;
        let judgeFeedback: Record<string, string> | undefined;
        let criterionScores: Record<string, number> | undefined;

        if (useJudgeEvaluation) {
          const evaluationResult = await evaluateOutputWithCriteria({
            judgeModelId,
            criteria: enabledCriteria,
            passThreshold,
            testInput: caseInput,
            expectedOutput,
            modelOutput: response.content,
            fallbackReason: t('evaluationFailed'),
          });
          afterScore = Math.round(evaluationResult.weightedScore * 100);
          afterPassed = evaluationResult.passed;
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
            });

            afterScore = Math.round(semanticResult.score * 100);
            afterPassed = semanticResult.score >= fallbackPassThreshold;
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
                afterPassed = heuristicScore >= fallbackPassThreshold * 100;
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

        runningResults = runningResults.map((result) =>
          result.caseId === testCase.id
            ? {
                ...result,
                output: response.content,
                expectedOutput: expectedOutput || undefined,
                afterScore,
                afterPassed,
                delta,
                judgeFeedback,
                criterionScores,
                status: 'completed',
              }
            : result
        );
        setVerificationResults([...runningResults]);
      } catch (verifyError) {
        runningResults = runningResults.map((result) =>
          result.caseId === testCase.id
            ? {
                ...result,
                status: 'error',
                errorMessage: verifyError instanceof Error ? verifyError.message : t('executionFailed'),
              }
            : result
        );
        setVerificationResults([...runningResults]);
      }
    }

    setIsVerifying(false);
    return runningResults;
  };

  const runAutoOptimizationPipeline = async () => {
    if (isAutoPipelineRunning || isVerifying || isOptimizing) return;
    setIsAutoPipelineRunning(true);
    setAutoPipelineRound(0);
    setAutoPipelineStatus(t('autoOptimizing'));
    setView('analysis');

    try {
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
        setAutoPipelineStatus(
          t('autoPipelineNeedExpected', {
            defaultValue: '请先为手动用例填写期望输出，或关联评测集后再执行自动优化循环。',
          })
        );
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
          maxRounds: AUTO_PIPELINE_MAX_ROUNDS,
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

      for (let round = 1; round <= AUTO_PIPELINE_MAX_ROUNDS; round++) {
        setAutoPipelineRound(round);
        setAutoPipelineStatus(t('autoRoundLabel', { round }));

        const suggestionsInRound = await runOptimizeOnce(true, optimizeContext);
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

        toApply.forEach((item) => handleApply(item));

        setAutoPipelineStatus(t('autoPipelineApplied', { count: toApply.length }));
        await new Promise((resolve) => setTimeout(resolve, 80));

        const roundCases = dedupeVerificationCases([
          ...trainCases.map((item) => ({ ...item, selected: true })),
          ...validationCases.map((item) => ({ ...item, selected: true })),
          ...manualCases.map((item) => ({ ...item, selected: true })),
        ]);
        setVerificationCases(roundCases);
        setView('verification');
        const verification = await runVerification(roundCases);
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

        if (round >= AUTO_PIPELINE_MAX_ROUNDS) {
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
          maxRounds: AUTO_PIPELINE_MAX_ROUNDS,
          source,
          trainCasesCount: trainCases.length,
          validationCasesCount: validationCases.length,
          manualCasesCount: manualCases.length,
          failedCases: failedCasesForNextRound,
        };
      }

      setAutoPipelineStatus(t('autoPipelineDone'));
    } finally {
      setIsAutoPipelineRunning(false);
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-cyan-400 light:text-cyan-600" />
          <h3 className="text-lg font-medium text-slate-200 light:text-slate-800">
            {t('aiOptimization')}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {onOpenSettings && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenSettings}
              title={t('configureOptimization')}
            >
              <Settings className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleOptimize}
            disabled={isOptimizing || !hasContent || !selectedModelId}
          >
            {isOptimizing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('analyzing')}
              </>
            ) : (
              <>
              <Wand2 className="w-4 h-4" />
              {t('analyzePrompt')}
            </>
          )}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={runAutoOptimizationPipeline}
            disabled={
              isOptimizing ||
              isVerifying ||
              isAutoPipelineRunning ||
              !hasContent ||
              !selectedModelId
            }
          >
            {isAutoPipelineRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('autoOptimizing')}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                {t('autoOptimizeLoop')}
              </>
            )}
          </Button>
        </div>
      </div>

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
                        ? t('pending', { defaultValue: '待测试' })
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

      <div className="mb-3 flex items-center justify-between gap-2">
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
        <span className="text-xs text-slate-500">
          {view === 'analysis'
            ? t('suggestionsCount', { count: displaySuggestions.length })
            : t('selectedCasesCount', { count: selectedCaseCount })}
        </span>
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
                  <div className="flex flex-col items-center justify-center text-center py-8">
                    <Check className="w-12 h-12 text-green-400 light:text-green-500 mb-4" />
                    <h4 className="text-lg font-medium text-slate-300 light:text-slate-700 mb-2">
                      {t('excellentPerformance')}
                    </h4>
                    <p className="text-sm text-slate-500 max-w-md">{t('noSuggestionsDesc')}</p>
                  </div>
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
          <div className="h-full grid gap-4 xl:grid-cols-[minmax(360px,0.95fr)_minmax(420px,1.05fr)]">
            <div className="min-h-0 overflow-y-auto p-4 bg-slate-800/50 light:bg-slate-100 rounded-lg border border-slate-700 light:border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-5 h-5 text-cyan-400 light:text-cyan-600" />
                  <span className="text-sm font-medium text-slate-200 light:text-slate-800">
                    {t('verificationCases')}
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  {t('selectedCasesCount', { count: selectedCaseCount })}
                </span>
              </div>

              <div className="mb-3 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setVerificationCases((prev) =>
                      prev.map((item) => ({
                        ...item,
                        selected: item.source === 'evaluation' ? Boolean(item.isFailed) : item.selected,
                      }))
                    )
                  }
                  className="text-xs"
                >
                  {t('selectFailedCases')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setVerificationCases((prev) =>
                      prev.map((item) => ({
                        ...item,
                        selected: true,
                      }))
                    )
                  }
                  className="text-xs"
                >
                  {t('selectAllCases')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setVerificationCases((prev) =>
                      prev.map((item) => ({
                        ...item,
                        selected: false,
                      }))
                    )
                  }
                  className="text-xs"
                >
                  {t('clearCaseSelection')}
                </Button>
              </div>

              {verificationCases.filter((item) => item.source === 'evaluation').length > 0 ? (
                <div className="space-y-3">
                  <div className="text-xs text-slate-400 light:text-slate-600 flex items-center gap-1">
                    <Database className="w-3 h-3" />
                    {t('fromEvaluation')} "{evaluationSummary?.evaluationName || '-'}"
                  </div>

                  {verificationCases
                    .filter((item) => item.source === 'evaluation')
                    .map((item) => (
                      <label
                        key={item.id}
                        className="flex items-center gap-2 py-2 text-sm text-slate-300 light:text-slate-700 cursor-pointer hover:bg-slate-700/20 light:hover:bg-slate-50 rounded px-2"
                      >
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() =>
                            setVerificationCases((prev) =>
                              prev.map((row) =>
                                row.id === item.id ? { ...row, selected: !row.selected } : row
                              )
                            )
                          }
                          className="rounded"
                        />
                        <span className="flex-1 truncate" title={item.name}>
                          {item.name}
                        </span>
                        {typeof item.beforeScore === 'number' ? (
                          <span className="text-xs text-slate-500">
                            {t('before')}: {item.beforeScore}
                          </span>
                        ) : null}
                      </label>
                    ))}
                </div>
              ) : (
                <div className="mb-4 p-3 bg-slate-700/30 light:bg-slate-50 rounded-lg text-xs text-slate-400">
                  {t('noEvaluationForVerify')}
                </div>
              )}

              <div className="mt-4 border-t border-slate-700 light:border-slate-200 pt-3">
                <div className="text-xs text-slate-400 light:text-slate-600 mb-2">
                  {t('manualCases')}
                </div>

                {verificationCases
                  .filter((item) => item.source === 'manual')
                  .map((item) => (
                    <div key={item.id} className="flex items-center gap-2 py-1">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={() =>
                          setVerificationCases((prev) =>
                            prev.map((row) =>
                              row.id === item.id ? { ...row, selected: !row.selected } : row
                            )
                          )
                        }
                        className="rounded"
                      />
                      <span className="text-sm text-slate-300 light:text-slate-700 flex-1 truncate">
                        {item.input.slice(0, 60)}
                        {item.input.length > 60 ? '...' : ''}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setVerificationCases((prev) => prev.filter((row) => row.id !== item.id))
                        }
                      >
                        <Trash2 className="w-3 h-3 text-slate-500" />
                      </Button>
                    </div>
                  ))}

                <div className="mt-2 p-2 bg-slate-700/30 light:bg-slate-50 rounded-lg border border-slate-600/50 light:border-slate-200">
                  <textarea
                    value={manualCaseInput}
                    onChange={(event) => setManualCaseInput(event.target.value)}
                    placeholder={t('testInput')}
                    className="w-full p-2 text-sm bg-transparent border-none text-slate-200 light:text-slate-800 placeholder-slate-500 focus:outline-none resize-y min-h-[44px]"
                    rows={2}
                  />
                  <textarea
                    value={manualCaseExpected}
                    onChange={(event) => setManualCaseExpected(event.target.value)}
                    placeholder={t('expectedOutput')}
                    className="w-full p-2 text-sm bg-transparent border-t border-slate-600/50 light:border-slate-200 text-slate-200 light:text-slate-800 placeholder-slate-500 focus:outline-none resize-y min-h-[34px]"
                    rows={1}
                  />
                  <div className="flex justify-end mt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={addManualCase}
                      disabled={!manualCaseInput.trim()}
                    >
                      <Plus className="w-3 h-3" />
                      {t('addCase')}
                    </Button>
                  </div>
                </div>
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

              <div className="mb-3 p-2 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white">
                <div className="text-xs text-slate-400 light:text-slate-600 mb-1">
                  {t('promptPreviewForVerification')}
                </div>
                <pre className="text-xs whitespace-pre-wrap break-words text-slate-300 light:text-slate-700 max-h-40 overflow-y-auto">
                  {promptPreview || t('emptyPromptPreview')}
                </pre>
              </div>

              <div className="mb-3 p-2 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white">
                <div className="text-xs text-slate-400 light:text-slate-600 mb-1">
                  {t('executionPromptPreview')}
                </div>
                <pre className="text-xs whitespace-pre-wrap break-words text-slate-300 light:text-slate-700 max-h-40 overflow-y-auto">
                  {selectedCasePreview || t('noCaseSelectedForPreview')}
                </pre>
              </div>

              <Button
                variant="primary"
                size="sm"
                onClick={() => void runVerification()}
                disabled={isVerifying || selectedCaseCount === 0}
                className="w-full mb-3"
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('verifying')}
                  </>
                ) : (
                  <>
                    <FlaskConical className="w-4 h-4" />
                    {t('runAndEvaluateCount', { count: selectedCaseCount })}
                  </>
                )}
              </Button>

              {verificationResults.length > 0 && (
                <>
                  <div className="grid gap-2 sm:grid-cols-2 mb-3">
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

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400 light:text-slate-600 border-b border-slate-700 light:border-slate-200">
                          <th className="text-left py-2 pr-2">{t('caseName')}</th>
                          <th className="text-center py-2 px-2">{t('before')}</th>
                          <th className="text-center py-2 px-2">{t('after')}</th>
                          <th className="text-center py-2 px-2">{t('delta')}</th>
                          <th className="text-left py-2 pl-2">{t('status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {verificationResults.map((result) => (
                          <tr key={result.caseId} className="border-b border-slate-700/50 light:border-slate-100">
                            <td className="py-2 pr-2 text-slate-300 light:text-slate-700">
                              {result.caseName}
                            </td>
                            <td className="py-2 px-2 text-center">
                              {typeof result.beforeScore === 'number' ? (
                                <span className={result.beforeScore >= 80 ? 'text-green-400' : 'text-red-400'}>
                                  {result.beforeScore}
                                </span>
                              ) : (
                                <span className="text-slate-500">-</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-center">
                              {result.status === 'completed' && typeof result.afterScore === 'number' ? (
                                <span className={result.afterScore >= 80 ? 'text-green-400' : 'text-amber-400'}>
                                  {result.afterScore}
                                </span>
                              ) : result.status === 'running' ? (
                                <Loader2 className="w-3 h-3 animate-spin inline" />
                              ) : result.status === 'error' ? (
                                <span className="text-red-400">{t('error')}</span>
                              ) : (
                                <span className="text-slate-500">-</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-center">
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
                              {result.status === 'completed' && result.afterPassed === true ? (
                                <Check className="w-3 h-3 text-green-400 inline" />
                              ) : result.status === 'completed' && result.afterPassed === false ? (
                                <X className="w-3 h-3 text-red-400 inline" />
                              ) : result.status === 'running' ? (
                                <Loader2 className="w-3 h-3 animate-spin text-cyan-400 inline" />
                              ) : result.status === 'error' ? (
                                <AlertCircle className="w-3 h-3 text-red-400 inline" />
                              ) : (
                                <span className="text-slate-500">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 space-y-2">
                    <div className="text-xs text-slate-400 light:text-slate-600">
                      {t('evaluationDetails')}
                    </div>
                    {verificationResults
                      .filter((result) => result.status === 'completed')
                      .map((result) => {
                        const criterionEntries = Object.entries(result.criterionScores || {});
                        const feedbackEntries = Object.entries(result.judgeFeedback || {});
                        const isExpanded = expandedResultCaseId === result.caseId;
                        return (
                          <div key={result.caseId} className="rounded border border-slate-700 light:border-slate-200 bg-slate-900/20 light:bg-white">
                            <button
                              type="button"
                              className="w-full flex items-center justify-between px-3 py-2 text-left"
                              onClick={() => setExpandedResultCaseId((prev) => (prev === result.caseId ? null : result.caseId))}
                            >
                              <span className="text-xs text-slate-300 light:text-slate-700">{result.caseName}</span>
                              <span className="text-xs text-slate-500">
                                {typeof result.afterScore === 'number' ? `${t('after')}: ${result.afterScore}` : '-'}
                              </span>
                            </button>
                            {isExpanded && (
                              <div className="px-3 pb-3 text-xs">
                                {criterionEntries.length > 0 && (
                                  <div className="mb-2">
                                    <div className="text-slate-400 light:text-slate-600 mb-1">{t('criterionScores')}</div>
                                    <div className="space-y-1">
                                      {criterionEntries.map(([name, score]) => (
                                        <div key={name} className="flex items-center justify-between">
                                          <span className="text-slate-300 light:text-slate-700">
                                            {name === 'semantic_match' ? t('expectedOutput') : name}
                                          </span>
                                          <span className="text-cyan-300 light:text-cyan-700">{Math.round(score * 100)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {feedbackEntries.length > 0 && (
                                  <div className="mb-2">
                                    <div className="text-slate-400 light:text-slate-600 mb-1">{t('judgeFeedbackDetails')}</div>
                                    <div className="space-y-1">
                                      {feedbackEntries.map(([name, feedback]) => (
                                        <div key={`${result.caseId}_${name}`} className="text-slate-300 light:text-slate-700 whitespace-pre-wrap break-words">
                                          <span className="text-slate-400 light:text-slate-600">
                                            {name === 'semantic_match' ? t('expectedOutput') : name}
                                            {': '}
                                          </span>
                                          {feedback}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {result.expectedOutput && (
                                  <div className="mb-2">
                                    <div className="text-slate-400 light:text-slate-600 mb-1">{t('expectedOutput')}</div>
                                    <div className="text-slate-300 light:text-slate-700 whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
                                      {result.expectedOutput}
                                    </div>
                                  </div>
                                )}
                                <div>
                                  <div className="text-slate-400 light:text-slate-600 mb-1">{t('modelOutputPreview')}</div>
                                  <div className="text-slate-300 light:text-slate-700 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                                    {result.output || '-'}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
