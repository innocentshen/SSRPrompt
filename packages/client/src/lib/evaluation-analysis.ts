import type {
  EvaluationAnalysisReport,
  EvaluationAnalysisScope,
  EvaluationCriterion,
  EvaluationRun,
  EvaluationStatus,
  RunConfig,
  TestCase,
  TestCaseResult,
} from '../types';

export type CriterionScoreStat = {
  criterion: string;
  averageScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  count: number;
};

export type FailureCaseStat = {
  testCaseId: string;
  testCaseName: string;
  errorMessage: string | null;
  averageScore: number | null;
  llmTimeMs: number;
  ocrTimeMs: number;
  totalTokens: number;
};

export type ScoreBucketCounts = {
  excellent: number;
  good: number;
  fair: number;
  poor: number;
  unknown: number;
};

export type JudgeEvaluationStats = {
  totalCases: number;
  evaluatedCases: number;
  unevaluatedCases: number;
  errorCases: number;
  feedbackCoverage: number;
  scoreScale: number | null;
  averageScore: number | null;
  averageScoreNormalized: number | null;
  scoreBuckets: ScoreBucketCounts;
};

export type RunAnalysisSummary = {
  runId: string;
  runTitle: string | null;
  status: EvaluationStatus;
  startedAt: string;
  completedAt: string | null;
  promptId: string | null;
  modelName: string | null;
  modelId: string | null;
  judgeModelName: string | null;
  judgeModelId: string | null;
  promptName: string | null;
  promptVersion: number | null;
  fileProcessing: string | null;
  ocrProvider: string | null;
  passThreshold: number | null;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  tokensInput: number;
  tokensOutput: number;
  tokensTotal: number;
  llmTimeMs: number;
  ocrTimeMs: number;
  totalTimeMs: number;
  avgLlmTimeMs: number;
  avgOcrTimeMs: number;
  avgTotalTimeMs: number;
  criterionStats: CriterionScoreStat[];
  topFailures: FailureCaseStat[];
  judgeEvaluation: JudgeEvaluationStats;
};

export type RunProfile = {
  key: string;
  runCount: number;
  runIds: string[];
  passRate: number;
  avgScoreNormalized: number | null;
  avgTotalTimeMs: number | null;
  avgLlmTimeMs: number | null;
  avgOcrTimeMs: number | null;
};

export type ModelProfile = RunProfile & {
  modelId: string | null;
  modelName: string | null;
};

export type PromptProfile = RunProfile & {
  promptId: string | null;
  promptName: string | null;
  promptVersion: number | null;
};

export type OcrProviderProfile = RunProfile & {
  ocrProvider: string | null;
};

export type JudgeModelProfile = RunProfile & {
  judgeModelId: string | null;
  judgeModelName: string | null;
};

export type RecommendedSetup = {
  model: ModelProfile | null;
  prompt: PromptProfile | null;
  ocrProvider: OcrProviderProfile | null;
  judgeModel: JudgeModelProfile | null;
  strategy: {
    riskLevel: 'low' | 'medium' | 'high';
    prioritizeStability: boolean;
    prioritizeLatency: boolean;
  };
};

export type SingleRunAnalysisData = {
  scope: 'single';
  generatedAt: string;
  run: RunAnalysisSummary;
  configurationComparison: {
    models: ModelProfile[];
    prompts: PromptProfile[];
    ocrProviders: OcrProviderProfile[];
    judgeModels: JudgeModelProfile[];
    hasMixedModels: boolean;
    hasMixedPrompts: boolean;
    hasMixedOcrProviders: boolean;
    hasMixedJudgeModels: boolean;
  };
  judgeEvaluationSummary: JudgeEvaluationStats;
  recommendedSetup: RecommendedSetup;
};

export type RunTransition = {
  testCaseId: string;
  testCaseName: string;
  fromRunId: string;
  fromStartedAt: string;
  toRunId: string;
  toStartedAt: string;
};

export type UnstableCase = {
  testCaseId: string;
  testCaseName: string;
  passCount: number;
  failCount: number;
  passRate: number;
};

export type CrossRunCaseFailure = {
  testCaseId: string;
  testCaseName: string;
  failureCount: number;
  lastErrorMessage: string | null;
};

export type MultiRunAnalysisData = {
  scope: 'multi';
  generatedAt: string;
  runCount: number;
  aggregate: {
    totalCases: number;
    passedCases: number;
    failedCases: number;
    passRate: number;
    tokensInput: number;
    tokensOutput: number;
    tokensTotal: number;
    llmTimeMs: number;
    ocrTimeMs: number;
    totalTimeMs: number;
  };
  runSummaries: RunAnalysisSummary[];
  regressions: RunTransition[];
  improvements: RunTransition[];
  unstableCases: UnstableCase[];
  topFailingCases: CrossRunCaseFailure[];
  criterionTrends: Array<{
    criterion: string;
    points: Array<{ runId: string; startedAt: string; averageScore: number | null }>;
  }>;
  configurationComparison: {
    models: ModelProfile[];
    prompts: PromptProfile[];
    ocrProviders: OcrProviderProfile[];
    judgeModels: JudgeModelProfile[];
    hasMixedModels: boolean;
    hasMixedPrompts: boolean;
    hasMixedOcrProviders: boolean;
    hasMixedJudgeModels: boolean;
  };
  judgeEvaluationSummary: JudgeEvaluationStats;
  recommendedSetup: RecommendedSetup;
  comparabilityWarnings: string[];
};

export type EvaluationAnalysisData = SingleRunAnalysisData | MultiRunAnalysisData;

type AnalyzeInput = {
  runs: EvaluationRun[];
  runResultsById: Record<string, TestCaseResult[]>;
  testCases: TestCase[];
  criteria: EvaluationCriterion[];
};

const MAX_FAILURE_ITEMS = 10;
const MAX_TRANSITION_ITEMS = 20;

type SupportedAnalysisLocale = 'en' | 'zh-CN' | 'zh-TW' | 'ja';

type AnalysisCopy = {
  casePrefix: string;
  structuredDataHeading: string;
  modelWarning: string;
  promptWarning: string;
  ocrWarning: string;
  judgeModelWarning: string;
};

const ANALYSIS_COPY: Record<SupportedAnalysisLocale, AnalysisCopy> = {
  en: {
    casePrefix: 'Case',
    structuredDataHeading: 'Here is the structured analysis data (JSON):',
    modelWarning: 'Selected runs use different target models, so direct comparison may be unfair.',
    promptWarning: 'Selected runs use different prompts/versions, so trend conclusions may be biased.',
    ocrWarning: 'Selected runs use different OCR providers, so OCR quality and latency are not directly comparable.',
    judgeModelWarning: 'Selected runs use different judge models, so score consistency may be affected.',
  },
  'zh-CN': {
    casePrefix: '用例',
    structuredDataHeading: '以下是结构化分析数据（JSON）：',
    modelWarning: '所选运行使用了不同的被测模型，直接对比可能不够公平。',
    promptWarning: '所选运行使用了不同的 Prompt 或版本，趋势结论可能存在偏差。',
    ocrWarning: '所选运行使用了不同的 OCR 供应商，OCR 质量与耗时不可直接横向对比。',
    judgeModelWarning: '所选运行使用了不同的评价模型，评分一致性可能受影响。',
  },
  'zh-TW': {
    casePrefix: '用例',
    structuredDataHeading: '以下是結構化分析資料（JSON）：',
    modelWarning: '所選執行使用了不同的被測模型，直接比較可能不夠公平。',
    promptWarning: '所選執行使用了不同的 Prompt 或版本，趨勢結論可能存在偏差。',
    ocrWarning: '所選執行使用了不同的 OCR 供應商，OCR 品質與耗時無法直接比較。',
    judgeModelWarning: '所選執行使用了不同的評價模型，評分一致性可能受影響。',
  },
  ja: {
    casePrefix: 'ケース',
    structuredDataHeading: '以下は構造化された分析データ（JSON）です:',
    modelWarning: '選択した実行で評価対象モデルが異なるため、単純比較は公平でない可能性があります。',
    promptWarning: '選択した実行で Prompt またはバージョンが異なるため、傾向結論に偏りが出る可能性があります。',
    ocrWarning: '選択した実行で OCR プロバイダーが異なるため、OCR 品質や遅延は単純比較できません。',
    judgeModelWarning: '選択した実行で評価モデルが異なるため、スコア整合性に影響する可能性があります。',
  },
};

function resolveAnalysisLocale(locale: string | null | undefined): SupportedAnalysisLocale {
  if (!locale) return 'en';
  const normalized = locale.toLowerCase();
  if (normalized.startsWith('ja')) return 'ja';
  if (
    normalized.startsWith('zh-tw') ||
    normalized.startsWith('zh-hk') ||
    normalized.startsWith('zh-mo') ||
    normalized.startsWith('zh-hant')
  ) {
    return 'zh-TW';
  }
  if (normalized.startsWith('zh')) return 'zh-CN';
  return 'en';
}

function round(value: number, digits = 2): number {
  const ratio = 10 ** digits;
  return Math.round(value * ratio) / ratio;
}

function detectScoreScale(values: number[]): number | null {
  if (values.length === 0) return null;
  const maxValue = Math.max(...values.map((value) => Math.abs(value)));
  if (!Number.isFinite(maxValue) || maxValue <= 0) return null;
  if (maxValue <= 1.5) return 1;
  if (maxValue <= 12) return 10;
  if (maxValue <= 120) return 100;
  return round(maxValue, 2);
}

function normalizeScoreTo100(value: number, scale: number | null): number {
  if (!Number.isFinite(value)) return 0;
  if (!scale || scale <= 0) return round(Math.max(0, Math.min(value, 100)), 2);
  return round(Math.max(0, Math.min((value / scale) * 100, 100)), 2);
}

function buildJudgeEvaluationStats(runResults: TestCaseResult[]): JudgeEvaluationStats {
  const totalCases = runResults.length;
  const caseAverageScores = runResults.map((result) => getResultScoreAverage(result));
  const nonNullAverages = caseAverageScores.filter((value): value is number => value !== null && Number.isFinite(value));
  const scoreScale = detectScoreScale(nonNullAverages);

  const scoreBuckets: ScoreBucketCounts = {
    excellent: 0,
    good: 0,
    fair: 0,
    poor: 0,
    unknown: 0,
  };

  for (const average of caseAverageScores) {
    if (average === null || !Number.isFinite(average)) {
      scoreBuckets.unknown += 1;
      continue;
    }
    const normalized = normalizeScoreTo100(average, scoreScale);
    if (normalized >= 85) scoreBuckets.excellent += 1;
    else if (normalized >= 70) scoreBuckets.good += 1;
    else if (normalized >= 50) scoreBuckets.fair += 1;
    else scoreBuckets.poor += 1;
  }

  const feedbackCases = runResults.filter(
    (result) =>
      !!result.aiFeedback &&
      typeof result.aiFeedback === 'object' &&
      Object.keys(result.aiFeedback).length > 0
  ).length;
  const evaluatedCases = runResults.filter((result, index) => {
    const hasScore = caseAverageScores[index] !== null;
    const hasFeedback =
      !!result.aiFeedback &&
      typeof result.aiFeedback === 'object' &&
      Object.keys(result.aiFeedback).length > 0;
    return hasScore || hasFeedback;
  }).length;
  const errorCases = runResults.filter((result) => !!result.errorMessage).length;

  const averageScore = nonNullAverages.length > 0
    ? round(nonNullAverages.reduce((sum, value) => sum + value, 0) / nonNullAverages.length, 4)
    : null;
  const normalizedAverages = nonNullAverages.map((value) => normalizeScoreTo100(value, scoreScale));
  const averageScoreNormalized = normalizedAverages.length > 0
    ? round(normalizedAverages.reduce((sum, value) => sum + value, 0) / normalizedAverages.length, 2)
    : null;

  return {
    totalCases,
    evaluatedCases,
    unevaluatedCases: Math.max(totalCases - evaluatedCases, 0),
    errorCases,
    feedbackCoverage: totalCases > 0 ? round((feedbackCases / totalCases) * 100, 2) : 0,
    scoreScale,
    averageScore,
    averageScoreNormalized,
    scoreBuckets,
  };
}

function toRunConfig(run: EvaluationRun): RunConfig | null {
  return (run.runConfig as RunConfig | null) ?? null;
}

function getCaseNameById(testCases: TestCase[], language?: string | null): Map<string, string> {
  const locale = resolveAnalysisLocale(language);
  const casePrefix = ANALYSIS_COPY[locale].casePrefix;
  return new Map(
    testCases.map((testCase, index) => [
      testCase.id,
      testCase.name?.trim() ? testCase.name : `${casePrefix} #${index + 1}`,
    ])
  );
}

function getResultScoreAverage(result: TestCaseResult): number | null {
  const values = Object.values(result.scores || {}).filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 4);
}

function summarizeRun(
  run: EvaluationRun,
  runResults: TestCaseResult[],
  testCaseNameById: Map<string, string>,
  criteria: EvaluationCriterion[]
): RunAnalysisSummary {
  const passCases = runResults.filter((result) => !!result.passed).length;
  const failCases = runResults.length - passCases;
  const tokensInput = runResults.reduce((sum, result) => sum + (result.tokensInput || 0), 0);
  const tokensOutput = runResults.reduce((sum, result) => sum + (result.tokensOutput || 0), 0);
  const llmTimeMs = runResults.reduce((sum, result) => sum + (result.latencyMs || 0), 0);
  const ocrTimeMs = runResults.reduce((sum, result) => sum + (result.ocrLatencyMs || 0), 0);
  const totalCases = runResults.length;
  const divisor = totalCases > 0 ? totalCases : 1;
  const config = toRunConfig(run);
  const judgeEvaluation = buildJudgeEvaluationStats(runResults);
  const ocrProvider = config?.ocrProviderResolved ?? config?.ocrProvider ?? null;
  const passThreshold =
    typeof config?.passThreshold === 'number' && Number.isFinite(config.passThreshold)
      ? config.passThreshold
      : null;

  const criterionStats = criteria
    .filter((criterion) => criterion.enabled)
    .map((criterion) => {
      const scores = runResults
        .map((result) => result.scores?.[criterion.name])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

      if (scores.length === 0) {
        return {
          criterion: criterion.name,
          averageScore: null,
          minScore: null,
          maxScore: null,
          count: 0,
        } satisfies CriterionScoreStat;
      }

      return {
        criterion: criterion.name,
        averageScore: round(scores.reduce((sum, value) => sum + value, 0) / scores.length, 4),
        minScore: round(Math.min(...scores), 4),
        maxScore: round(Math.max(...scores), 4),
        count: scores.length,
      } satisfies CriterionScoreStat;
    });

  const topFailures = runResults
    .filter((result) => !result.passed || !!result.errorMessage)
    .map((result) => ({
      testCaseId: result.testCaseId,
      testCaseName: testCaseNameById.get(result.testCaseId) ?? result.testCaseId,
      errorMessage: result.errorMessage ?? null,
      averageScore: getResultScoreAverage(result),
      llmTimeMs: result.latencyMs || 0,
      ocrTimeMs: result.ocrLatencyMs || 0,
      totalTokens: (result.tokensInput || 0) + (result.tokensOutput || 0),
    }))
    .sort((a, b) => {
      if (!!a.errorMessage !== !!b.errorMessage) return a.errorMessage ? -1 : 1;
      const aScore = a.averageScore ?? Number.POSITIVE_INFINITY;
      const bScore = b.averageScore ?? Number.POSITIVE_INFINITY;
      if (aScore !== bScore) return aScore - bScore;
      return b.llmTimeMs + b.ocrTimeMs - (a.llmTimeMs + a.ocrTimeMs);
    })
    .slice(0, MAX_FAILURE_ITEMS);

  return {
    runId: run.id,
    runTitle: run.title?.trim() || null,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    promptId: config?.promptId ?? null,
    modelName: config?.modelName ?? null,
    modelId: config?.modelId ?? null,
    judgeModelName: config?.judgeModelName ?? null,
    judgeModelId: config?.judgeModelId ?? null,
    promptName: config?.promptName ?? null,
    promptVersion: typeof config?.promptVersion === 'number' ? config.promptVersion : null,
    fileProcessing: config?.fileProcessing ?? null,
    ocrProvider,
    passThreshold,
    totalCases,
    passedCases: passCases,
    failedCases: failCases,
    passRate: totalCases > 0 ? round((passCases / totalCases) * 100, 2) : 0,
    tokensInput,
    tokensOutput,
    tokensTotal: tokensInput + tokensOutput,
    llmTimeMs,
    ocrTimeMs,
    totalTimeMs: llmTimeMs + ocrTimeMs,
    avgLlmTimeMs: round(llmTimeMs / divisor, 2),
    avgOcrTimeMs: round(ocrTimeMs / divisor, 2),
    avgTotalTimeMs: round((llmTimeMs + ocrTimeMs) / divisor, 2),
    criterionStats,
    topFailures,
    judgeEvaluation,
  };
}

function sortRunsByTime(runs: EvaluationRun[]): EvaluationRun[] {
  return [...runs].sort((a, b) => {
    const at = new Date(a.startedAt || a.createdAt).getTime();
    const bt = new Date(b.startedAt || b.createdAt).getTime();
    return at - bt;
  });
}

function buildRunProfileMetrics(key: string, summaries: RunAnalysisSummary[]): RunProfile {
  const runCount = summaries.length;
  const runIds = summaries.map((summary) => summary.runId);
  const totalCases = summaries.reduce((sum, summary) => sum + summary.totalCases, 0);
  const passedCases = summaries.reduce((sum, summary) => sum + summary.passedCases, 0);
  const passRate = totalCases > 0 ? round((passedCases / totalCases) * 100, 2) : 0;

  const weightedScore = summaries.reduce(
    (acc, summary) => {
      const value = summary.judgeEvaluation.averageScoreNormalized;
      if (value === null || !Number.isFinite(value)) return acc;
      const weight = Math.max(summary.judgeEvaluation.evaluatedCases, 1);
      return {
        weightedSum: acc.weightedSum + value * weight,
        totalWeight: acc.totalWeight + weight,
      };
    },
    { weightedSum: 0, totalWeight: 0 }
  );

  const totalLlmTimeMs = summaries.reduce((sum, summary) => sum + summary.llmTimeMs, 0);
  const totalOcrTimeMs = summaries.reduce((sum, summary) => sum + summary.ocrTimeMs, 0);
  const avgScoreNormalized = weightedScore.totalWeight > 0
    ? round(weightedScore.weightedSum / weightedScore.totalWeight, 2)
    : null;
  const avgLlmTimeMs = totalCases > 0 ? round(totalLlmTimeMs / totalCases, 2) : null;
  const avgOcrTimeMs = totalCases > 0 ? round(totalOcrTimeMs / totalCases, 2) : null;
  const avgTotalTimeMs =
    avgLlmTimeMs !== null && avgOcrTimeMs !== null ? round(avgLlmTimeMs + avgOcrTimeMs, 2) : null;

  return {
    key,
    runCount,
    runIds,
    passRate,
    avgScoreNormalized,
    avgTotalTimeMs,
    avgLlmTimeMs,
    avgOcrTimeMs,
  };
}

function choosePreferredProfile<T extends RunProfile>(profiles: T[]): T | null {
  if (profiles.length === 0) return null;
  return [...profiles].sort((a, b) => {
    if (b.passRate !== a.passRate) return b.passRate - a.passRate;
    const aScore = a.avgScoreNormalized ?? -1;
    const bScore = b.avgScoreNormalized ?? -1;
    if (bScore !== aScore) return bScore - aScore;
    const aLatency = a.avgTotalTimeMs ?? Number.POSITIVE_INFINITY;
    const bLatency = b.avgTotalTimeMs ?? Number.POSITIVE_INFINITY;
    if (aLatency !== bLatency) return aLatency - bLatency;
    return b.runCount - a.runCount;
  })[0] ?? null;
}

function buildModelProfiles(runSummaries: RunAnalysisSummary[]): ModelProfile[] {
  const grouped = new Map<string, { modelId: string | null; modelName: string | null; summaries: RunAnalysisSummary[] }>();
  for (const summary of runSummaries) {
    const key = `${summary.modelId || ''}:${summary.modelName || ''}`;
    const current = grouped.get(key);
    if (current) current.summaries.push(summary);
    else grouped.set(key, { modelId: summary.modelId, modelName: summary.modelName, summaries: [summary] });
  }
  return Array.from(grouped.entries())
    .map(([key, value]) => ({
      ...buildRunProfileMetrics(key, value.summaries),
      modelId: value.modelId,
      modelName: value.modelName,
    }))
    .sort((a, b) => b.runCount - a.runCount);
}

function buildPromptProfiles(runSummaries: RunAnalysisSummary[]): PromptProfile[] {
  const grouped = new Map<
    string,
    { promptId: string | null; promptName: string | null; promptVersion: number | null; summaries: RunAnalysisSummary[] }
  >();
  for (const summary of runSummaries) {
    const key = `${summary.promptId || ''}:${summary.promptName || ''}:v${summary.promptVersion || ''}`;
    const current = grouped.get(key);
    if (current) current.summaries.push(summary);
    else {
      grouped.set(key, {
        promptId: summary.promptId,
        promptName: summary.promptName,
        promptVersion: summary.promptVersion,
        summaries: [summary],
      });
    }
  }
  return Array.from(grouped.entries())
    .map(([key, value]) => ({
      ...buildRunProfileMetrics(key, value.summaries),
      promptId: value.promptId,
      promptName: value.promptName,
      promptVersion: value.promptVersion,
    }))
    .sort((a, b) => b.runCount - a.runCount);
}

function buildOcrProviderProfiles(runSummaries: RunAnalysisSummary[]): OcrProviderProfile[] {
  const grouped = new Map<string, { ocrProvider: string | null; summaries: RunAnalysisSummary[] }>();
  for (const summary of runSummaries) {
    const key = summary.ocrProvider || 'default';
    const current = grouped.get(key);
    if (current) current.summaries.push(summary);
    else grouped.set(key, { ocrProvider: summary.ocrProvider, summaries: [summary] });
  }
  return Array.from(grouped.entries())
    .map(([key, value]) => ({
      ...buildRunProfileMetrics(key, value.summaries),
      ocrProvider: value.ocrProvider,
    }))
    .sort((a, b) => b.runCount - a.runCount);
}

function buildJudgeModelProfiles(runSummaries: RunAnalysisSummary[]): JudgeModelProfile[] {
  const grouped = new Map<string, { judgeModelId: string | null; judgeModelName: string | null; summaries: RunAnalysisSummary[] }>();
  for (const summary of runSummaries) {
    const key = `${summary.judgeModelId || ''}:${summary.judgeModelName || ''}`;
    const current = grouped.get(key);
    if (current) current.summaries.push(summary);
    else grouped.set(key, { judgeModelId: summary.judgeModelId, judgeModelName: summary.judgeModelName, summaries: [summary] });
  }
  return Array.from(grouped.entries())
    .map(([key, value]) => ({
      ...buildRunProfileMetrics(key, value.summaries),
      judgeModelId: value.judgeModelId,
      judgeModelName: value.judgeModelName,
    }))
    .sort((a, b) => b.runCount - a.runCount);
}

function aggregateJudgeEvaluationStats(runSummaries: RunAnalysisSummary[]): JudgeEvaluationStats {
  const scoreBuckets = runSummaries.reduce<ScoreBucketCounts>(
    (acc, summary) => ({
      excellent: acc.excellent + summary.judgeEvaluation.scoreBuckets.excellent,
      good: acc.good + summary.judgeEvaluation.scoreBuckets.good,
      fair: acc.fair + summary.judgeEvaluation.scoreBuckets.fair,
      poor: acc.poor + summary.judgeEvaluation.scoreBuckets.poor,
      unknown: acc.unknown + summary.judgeEvaluation.scoreBuckets.unknown,
    }),
    { excellent: 0, good: 0, fair: 0, poor: 0, unknown: 0 }
  );

  const totals = runSummaries.reduce(
    (acc, summary) => ({
      totalCases: acc.totalCases + summary.judgeEvaluation.totalCases,
      evaluatedCases: acc.evaluatedCases + summary.judgeEvaluation.evaluatedCases,
      unevaluatedCases: acc.unevaluatedCases + summary.judgeEvaluation.unevaluatedCases,
      errorCases: acc.errorCases + summary.judgeEvaluation.errorCases,
      feedbackWeighted: acc.feedbackWeighted + (summary.judgeEvaluation.feedbackCoverage * summary.judgeEvaluation.totalCases),
      scoreWeighted:
        acc.scoreWeighted +
        ((summary.judgeEvaluation.averageScoreNormalized ?? 0) * Math.max(summary.judgeEvaluation.evaluatedCases, 0)),
      scoreWeight: acc.scoreWeight + Math.max(summary.judgeEvaluation.evaluatedCases, 0),
      rawScoreWeighted:
        acc.rawScoreWeighted +
        ((summary.judgeEvaluation.averageScore ?? 0) * Math.max(summary.judgeEvaluation.evaluatedCases, 0)),
      rawScoreWeight: acc.rawScoreWeight + Math.max(summary.judgeEvaluation.evaluatedCases, 0),
    }),
    {
      totalCases: 0,
      evaluatedCases: 0,
      unevaluatedCases: 0,
      errorCases: 0,
      feedbackWeighted: 0,
      scoreWeighted: 0,
      scoreWeight: 0,
      rawScoreWeighted: 0,
      rawScoreWeight: 0,
    }
  );

  return {
    totalCases: totals.totalCases,
    evaluatedCases: totals.evaluatedCases,
    unevaluatedCases: totals.unevaluatedCases,
    errorCases: totals.errorCases,
    feedbackCoverage: totals.totalCases > 0 ? round(totals.feedbackWeighted / totals.totalCases, 2) : 0,
    scoreScale: null,
    averageScore: totals.rawScoreWeight > 0 ? round(totals.rawScoreWeighted / totals.rawScoreWeight, 4) : null,
    averageScoreNormalized: totals.scoreWeight > 0 ? round(totals.scoreWeighted / totals.scoreWeight, 2) : null,
    scoreBuckets,
  };
}

function buildRecommendedSetup(input: {
  models: ModelProfile[];
  prompts: PromptProfile[];
  ocrProviders: OcrProviderProfile[];
  judgeModels: JudgeModelProfile[];
  aggregatePassRate: number;
  regressionsCount: number;
  improvementsCount: number;
  unstableCasesCount: number;
  avgTotalTimeMs: number | null;
}): RecommendedSetup {
  const prioritizeStability = input.unstableCasesCount > 0 || input.regressionsCount > input.improvementsCount;
  const prioritizeLatency = (input.avgTotalTimeMs ?? 0) > 5000;
  let riskLevel: 'low' | 'medium' | 'high' = 'medium';
  if (input.aggregatePassRate >= 85 && !prioritizeStability) riskLevel = 'low';
  else if (input.aggregatePassRate < 65 || input.regressionsCount > input.improvementsCount + 2) riskLevel = 'high';

  return {
    model: choosePreferredProfile(input.models),
    prompt: choosePreferredProfile(input.prompts),
    ocrProvider: choosePreferredProfile(input.ocrProviders),
    judgeModel: choosePreferredProfile(input.judgeModels),
    strategy: {
      riskLevel,
      prioritizeStability,
      prioritizeLatency,
    },
  };
}

export function analyzeSingleRun(input: AnalyzeInput & { run: EvaluationRun; language?: string | null }): SingleRunAnalysisData {
  const caseNameById = getCaseNameById(input.testCases, input.language);
  const runResults = input.runResultsById[input.run.id] || [];
  const summary = summarizeRun(input.run, runResults, caseNameById, input.criteria);
  const runSummaries = [summary];
  const models = buildModelProfiles(runSummaries);
  const prompts = buildPromptProfiles(runSummaries);
  const ocrProviders = buildOcrProviderProfiles(runSummaries);
  const judgeModels = buildJudgeModelProfiles(runSummaries);
  const judgeEvaluationSummary = aggregateJudgeEvaluationStats(runSummaries);
  const recommendedSetup = buildRecommendedSetup({
    models,
    prompts,
    ocrProviders,
    judgeModels,
    aggregatePassRate: summary.passRate,
    regressionsCount: 0,
    improvementsCount: 0,
    unstableCasesCount: 0,
    avgTotalTimeMs: summary.avgTotalTimeMs,
  });

  return {
    scope: 'single',
    generatedAt: new Date().toISOString(),
    run: summary,
    configurationComparison: {
      models,
      prompts,
      ocrProviders,
      judgeModels,
      hasMixedModels: false,
      hasMixedPrompts: false,
      hasMixedOcrProviders: false,
      hasMixedJudgeModels: false,
    },
    judgeEvaluationSummary,
    recommendedSetup,
  };
}

export function analyzeMultipleRuns(input: AnalyzeInput & { language?: string | null }): MultiRunAnalysisData {
  const locale = resolveAnalysisLocale(input.language);
  const copy = ANALYSIS_COPY[locale];
  const caseNameById = getCaseNameById(input.testCases, input.language);
  const sortedRuns = sortRunsByTime(input.runs);
  const runSummaries = sortedRuns.map((run) =>
    summarizeRun(run, input.runResultsById[run.id] || [], caseNameById, input.criteria)
  );

  const aggregate = runSummaries.reduce(
    (acc, summary) => {
      acc.totalCases += summary.totalCases;
      acc.passedCases += summary.passedCases;
      acc.failedCases += summary.failedCases;
      acc.tokensInput += summary.tokensInput;
      acc.tokensOutput += summary.tokensOutput;
      acc.llmTimeMs += summary.llmTimeMs;
      acc.ocrTimeMs += summary.ocrTimeMs;
      return acc;
    },
    {
      totalCases: 0,
      passedCases: 0,
      failedCases: 0,
      tokensInput: 0,
      tokensOutput: 0,
      llmTimeMs: 0,
      ocrTimeMs: 0,
    }
  );
  const passRate = aggregate.totalCases > 0
    ? round((aggregate.passedCases / aggregate.totalCases) * 100, 2)
    : 0;

  const resultMapByRun = new Map<string, Map<string, TestCaseResult>>();
  for (const run of sortedRuns) {
    const runResults = input.runResultsById[run.id] || [];
    resultMapByRun.set(
      run.id,
      new Map(runResults.map((result) => [result.testCaseId, result]))
    );
  }

  const caseIds = Array.from(
    new Set(
      sortedRuns.flatMap((run) => (input.runResultsById[run.id] || []).map((result) => result.testCaseId))
    )
  );

  const regressions: RunTransition[] = [];
  const improvements: RunTransition[] = [];
  const unstableCases: UnstableCase[] = [];
  const failingCaseStats: CrossRunCaseFailure[] = [];

  for (const caseId of caseIds) {
    let passCount = 0;
    let failCount = 0;
    let lastErrorMessage: string | null = null;
    let previous: { run: EvaluationRun; passed: boolean } | null = null;

    for (const run of sortedRuns) {
      const result = resultMapByRun.get(run.id)?.get(caseId);
      if (!result) continue;

      const passed = !!result.passed;
      if (passed) passCount += 1;
      else failCount += 1;
      if (result.errorMessage) {
        lastErrorMessage = result.errorMessage;
      }

      if (previous) {
        if (previous.passed && !passed && regressions.length < MAX_TRANSITION_ITEMS) {
          regressions.push({
            testCaseId: caseId,
            testCaseName: caseNameById.get(caseId) ?? caseId,
            fromRunId: previous.run.id,
            fromStartedAt: previous.run.startedAt,
            toRunId: run.id,
            toStartedAt: run.startedAt,
          });
        }
        if (!previous.passed && passed && improvements.length < MAX_TRANSITION_ITEMS) {
          improvements.push({
            testCaseId: caseId,
            testCaseName: caseNameById.get(caseId) ?? caseId,
            fromRunId: previous.run.id,
            fromStartedAt: previous.run.startedAt,
            toRunId: run.id,
            toStartedAt: run.startedAt,
          });
        }
      }

      previous = { run, passed };
    }

    if (passCount > 0 && failCount > 0) {
      unstableCases.push({
        testCaseId: caseId,
        testCaseName: caseNameById.get(caseId) ?? caseId,
        passCount,
        failCount,
        passRate: round((passCount / (passCount + failCount)) * 100, 2),
      });
    }

    if (failCount > 0) {
      failingCaseStats.push({
        testCaseId: caseId,
        testCaseName: caseNameById.get(caseId) ?? caseId,
        failureCount: failCount,
        lastErrorMessage,
      });
    }
  }

  unstableCases.sort((a, b) => b.failCount - a.failCount);
  failingCaseStats.sort((a, b) => b.failureCount - a.failureCount);

  const enabledCriteria = input.criteria.filter((criterion) => criterion.enabled).map((criterion) => criterion.name);
  const criterionTrends = enabledCriteria.map((criterionName) => ({
    criterion: criterionName,
    points: sortedRuns.map((run) => {
      const values = (input.runResultsById[run.id] || [])
        .map((result) => result.scores?.[criterionName])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const averageScore = values.length > 0
        ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 4)
        : null;
      return {
        runId: run.id,
        startedAt: run.startedAt,
        averageScore,
      };
    }),
  }));

  const modelProfiles = buildModelProfiles(runSummaries);
  const promptProfiles = buildPromptProfiles(runSummaries);
  const ocrProviderProfiles = buildOcrProviderProfiles(runSummaries);
  const judgeModelProfiles = buildJudgeModelProfiles(runSummaries);
  const hasMixedModels = modelProfiles.length > 1;
  const hasMixedPrompts = promptProfiles.length > 1;
  const hasMixedOcrProviders = ocrProviderProfiles.length > 1;
  const hasMixedJudgeModels = judgeModelProfiles.length > 1;

  const comparabilityWarnings: string[] = [];
  if (hasMixedModels) {
    comparabilityWarnings.push(copy.modelWarning);
  }
  if (hasMixedPrompts) {
    comparabilityWarnings.push(copy.promptWarning);
  }
  if (hasMixedOcrProviders) {
    comparabilityWarnings.push(copy.ocrWarning);
  }
  if (hasMixedJudgeModels) {
    comparabilityWarnings.push(copy.judgeModelWarning);
  }

  const judgeEvaluationSummary = aggregateJudgeEvaluationStats(runSummaries);
  const avgTotalTimeMs = aggregate.totalCases > 0
    ? round((aggregate.llmTimeMs + aggregate.ocrTimeMs) / aggregate.totalCases, 2)
    : null;
  const recommendedSetup = buildRecommendedSetup({
    models: modelProfiles,
    prompts: promptProfiles,
    ocrProviders: ocrProviderProfiles,
    judgeModels: judgeModelProfiles,
    aggregatePassRate: passRate,
    regressionsCount: regressions.length,
    improvementsCount: improvements.length,
    unstableCasesCount: unstableCases.length,
    avgTotalTimeMs,
  });

  return {
    scope: 'multi',
    generatedAt: new Date().toISOString(),
    runCount: sortedRuns.length,
    aggregate: {
      ...aggregate,
      passRate,
      tokensTotal: aggregate.tokensInput + aggregate.tokensOutput,
      totalTimeMs: aggregate.llmTimeMs + aggregate.ocrTimeMs,
    },
    runSummaries,
    regressions,
    improvements,
    unstableCases: unstableCases.slice(0, MAX_FAILURE_ITEMS),
    topFailingCases: failingCaseStats.slice(0, MAX_FAILURE_ITEMS),
    criterionTrends,
    configurationComparison: {
      models: modelProfiles,
      prompts: promptProfiles,
      ocrProviders: ocrProviderProfiles,
      judgeModels: judgeModelProfiles,
      hasMixedModels,
      hasMixedPrompts,
      hasMixedOcrProviders,
      hasMixedJudgeModels,
    },
    judgeEvaluationSummary,
    recommendedSetup,
    comparabilityWarnings,
  };
}

export function buildAnalysisInputMessage(
  prompt: string,
  analysisData: unknown,
  language?: string | null
): string {
  const locale = resolveAnalysisLocale(language);
  const copy = ANALYSIS_COPY[locale];
  return `${prompt.trim()}\n\n---\n\n${copy.structuredDataHeading}\n\n\`\`\`json\n${JSON.stringify(analysisData, null, 2)}\n\`\`\`\n`;
}

export function buildDefaultAnalysisPrompt(
  language: string,
  scope: EvaluationAnalysisScope
): string {
  const isZh = language.toLowerCase().startsWith('zh');
  const isJa = language.toLowerCase().startsWith('ja');

  if (isZh) {
    return scope === 'single'
      ? '请基于下面的评测统计数据，输出一份面向工程落地的单轮评测分析报告。请使用 Markdown，并明确覆盖：1) 关联 Prompt 与当前版本适配性；2) 被测模型与 OCR 供应商配置是否合理；3) 评价模型（Judge）评分结果分类统计解读（优秀/良好/一般/较差/未知）；4) 关键问题与根因；5) 下一轮建议的模型、OCR、Prompt 调整方案与优先级。'
      : '请基于下面的多轮评测统计数据，输出一份面向工程落地的综合分析报告。请使用 Markdown，并明确覆盖：1) Prompt 差异对比（若存在不同 Prompt/版本，需逐组比较效果）；2) 被测模型差异对比；3) OCR 供应商差异对比；4) 评价模型（Judge）结果分类统计与一致性分析；5) 综合推荐下一阶段应采用的模型、OCR、Prompt 组合及改进计划（按优先级，附风险与验证方案）。';
  }

  if (isJa) {
    return scope === 'single'
      ? '以下の評価統計データに基づき、実装に直結する単一実行の分析レポートを Markdown で作成してください。必ず次を含めてください: 1) 関連 Prompt と現行バージョンの適合性、2) 評価対象モデルと OCR プロバイダー設定の妥当性、3) Judge の評価結果分類（優/良/可/要改善/不明）の解釈、4) 主要課題と根因、5) 次ラウンドで推奨するモデル・OCR・Prompt 改善案（優先度付き）。'
      : '以下の複数実行の評価統計データに基づき、実装に直結する総合分析レポートを Markdown で作成してください。必ず次を含めてください: 1) Prompt 差分比較（Prompt/バージョン差がある場合はグループ別に比較）、2) 評価対象モデル比較、3) OCR プロバイダー比較、4) Judge 結果分類統計と一貫性分析、5) 次フェーズで推奨するモデル・OCR・Prompt 構成と改善計画（優先度、リスク、検証案付き）。';
  }

  return scope === 'single'
    ? 'Please generate a practical single-run evaluation analysis report in Markdown from the metrics below. You must cover: (1) linked Prompt suitability, (2) target model and OCR provider suitability, (3) judge-result category breakdown interpretation (excellent/good/fair/poor/unknown), (4) key issues and root causes, and (5) prioritized next-step recommendations for model/OCR/Prompt changes.'
    : 'Please generate a practical multi-run evaluation analysis report in Markdown from the metrics below. You must cover: (1) Prompt comparison (group by Prompt/version when different), (2) target model comparison, (3) OCR provider comparison, (4) judge-result category statistics and consistency analysis, and (5) a prioritized recommended setup (model/OCR/Prompt) with risks and validation plan.';
}

function formatIso(iso: string | null): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toISOString();
}

type AnalysisMarkdownLabels = {
  title: string;
  evaluation: string;
  scope: string;
  createdAt: string;
  analysisModel: string;
  runs: string;
  locale: string;
  prompt: string;
  aiAnalysis: string;
  scriptMetrics: string;
  singleRun: string;
  multiRun: string;
};

const ANALYSIS_MARKDOWN_LABELS: Record<'en' | 'zh-CN' | 'zh-TW' | 'ja', AnalysisMarkdownLabels> = {
  en: {
    title: 'Evaluation Analysis Report',
    evaluation: 'Evaluation',
    scope: 'Scope',
    createdAt: 'Created At',
    analysisModel: 'Analysis Model',
    runs: 'Runs',
    locale: 'Locale',
    prompt: 'Prompt',
    aiAnalysis: 'AI Analysis',
    scriptMetrics: 'Script Metrics (JSON)',
    singleRun: 'Single Run',
    multiRun: 'Multi Run',
  },
  'zh-CN': {
    title: '评测分析报告',
    evaluation: '评测',
    scope: '分析范围',
    createdAt: '创建时间',
    analysisModel: '分析模型',
    runs: '运行记录',
    locale: '语言',
    prompt: '分析提示词',
    aiAnalysis: 'AI 分析结论',
    scriptMetrics: '脚本统计数据（JSON）',
    singleRun: '单轮分析',
    multiRun: '多轮分析',
  },
  'zh-TW': {
    title: '評測分析報告',
    evaluation: '評測',
    scope: '分析範圍',
    createdAt: '建立時間',
    analysisModel: '分析模型',
    runs: '執行記錄',
    locale: '語言',
    prompt: '分析提示詞',
    aiAnalysis: 'AI 分析結論',
    scriptMetrics: '腳本統計資料（JSON）',
    singleRun: '單輪分析',
    multiRun: '多輪分析',
  },
  ja: {
    title: '評価分析レポート',
    evaluation: '評価',
    scope: '分析範囲',
    createdAt: '作成日時',
    analysisModel: '分析モデル',
    runs: '実行',
    locale: 'ロケール',
    prompt: '分析プロンプト',
    aiAnalysis: 'AI 分析',
    scriptMetrics: 'スクリプト指標（JSON）',
    singleRun: '単一実行分析',
    multiRun: '複数実行分析',
  },
};

function getAnalysisRunScopeLabel(report: EvaluationAnalysisReport): string {
  const labels: string[] = [];

  const appendLabelFromSummary = (summary: unknown) => {
    if (!summary || typeof summary !== 'object') return;
    const record = summary as Record<string, unknown>;
    const runTitle = typeof record.runTitle === 'string' ? record.runTitle.trim() : '';
    const runId = typeof record.runId === 'string' ? record.runId : '';
    if (runTitle) {
      labels.push(runTitle);
      return;
    }
    if (runId) {
      labels.push(runId);
    }
  };

  const analysisData =
    report.analysisData && typeof report.analysisData === 'object'
      ? (report.analysisData as Record<string, unknown>)
      : {};
  const runSummaries = analysisData.runSummaries;
  if (Array.isArray(runSummaries)) {
    runSummaries.forEach(appendLabelFromSummary);
  }

  const singleRunSummary = analysisData.run;
  if (labels.length === 0 && singleRunSummary) {
    appendLabelFromSummary(singleRunSummary);
  }

  if (labels.length === 0) {
    return report.runIds.join(', ');
  }

  return Array.from(new Set(labels)).join(', ');
}

export function buildEvaluationAnalysisMarkdown(
  report: EvaluationAnalysisReport,
  evaluationName: string
): string {
  const sanitizedSummaryMarkdown = sanitizeAnalysisMarkdown(report.summaryMarkdown);
  const labels = ANALYSIS_MARKDOWN_LABELS[resolveAnalysisLocale(report.locale)];
  const scopeLabel = report.scope === 'single' ? labels.singleRun : labels.multiRun;
  const runScope = getAnalysisRunScopeLabel(report);
  const headerLines = [
    `# ${labels.title}`,
    '',
    `- ${labels.evaluation}: ${evaluationName}`,
    `- ${labels.scope}: ${scopeLabel}`,
    `- ${labels.createdAt}: ${formatIso(report.createdAt)}`,
    `- ${labels.analysisModel}: ${report.analysisModelName || report.analysisModelId}`,
    `- ${labels.runs}: ${runScope}`,
    `- ${labels.locale}: ${report.locale || '-'}`,
    '',
  ];

  const promptBlock = [
    `## ${labels.prompt}`,
    '',
    '```text',
    report.prompt,
    '```',
    '',
  ];

  const summaryBlock = [
    `## ${labels.aiAnalysis}`,
    '',
    sanitizedSummaryMarkdown.trim(),
    '',
  ];

  const dataBlock = [
    `## ${labels.scriptMetrics}`,
    '',
    '```json',
    JSON.stringify(report.analysisData, null, 2),
    '```',
    '',
  ];

  return [...headerLines, ...promptBlock, ...summaryBlock, ...dataBlock].join('\n');
}

const INVISIBLE_OR_CONTROL_MARKDOWN_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFFD]/g;
const BASIC_PRIVATE_USE_MARKDOWN_CHARS = /[\uE000-\uF8FF]/g;
const SUPPLEMENTARY_PRIVATE_USE_MARKDOWN_CHARS = /[\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu;

export function sanitizeAnalysisMarkdown(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(INVISIBLE_OR_CONTROL_MARKDOWN_CHARS, '')
    .replace(BASIC_PRIVATE_USE_MARKDOWN_CHARS, '')
    .replace(SUPPLEMENTARY_PRIVATE_USE_MARKDOWN_CHARS, '');
}

