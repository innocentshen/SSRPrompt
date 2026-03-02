import type { PromptMessage, PromptVariable } from '../types';
import { chatApi } from '../api/chat';
import { getOptimizationSettings } from './optimization-settings';
import { inferStructuredOutputSupport } from './model-capabilities';
import {
  OPTIMIZATION_RESULT_SCHEMA,
  OPTIMIZATION_RESULT_JSON_OBJECT_FORMAT,
} from '@ssrprompt/shared';
import i18n from '../i18n';

export type SuggestionType = 'clarity' | 'structure' | 'specificity' | 'examples' | 'constraints';
export type SuggestionSeverity = 'low' | 'medium' | 'high';

export interface OptimizationSuggestion {
  id: string;
  type: SuggestionType;
  title: string;
  description: string;
  originalText?: string;
  suggestedText?: string;
  messageIndex?: number;
  severity: SuggestionSeverity;
  applied?: boolean;
}

/**
 * Evaluation summary for evaluation-driven optimization (Phase 3).
 */
export interface PromptEvaluationSummary {
  evaluationId: string;
  evaluationName: string;
  modelName: string;
  judgeModelName: string;
  totalRuns: number;
  avgPassRate: number;
  avgCriterionScores: Record<string, number>;
  topFailures: Array<{
    testCaseId: string;
    testCaseName: string;
    failCount: number;
    totalCount: number;
    latestModelOutput: string;
    latestAiFeedback: Record<string, string>;
    expectedOutput: string | null;
    latestScores: Record<string, number>;
  }>;
  recentDelta?: {
    passRateChange: number;
    criterionChanges: Record<string, number>;
  };
  criteriaNames?: string[];
}

export interface PromptAnalysisRequest {
  messages: PromptMessage[];
  content: string;
  variables: PromptVariable[];
  evaluationSummary?: PromptEvaluationSummary;
  autoOptimizeContext?: {
    round: number;
    maxRounds: number;
    source: 'evaluation' | 'manual' | 'mixed';
    trainCasesCount: number;
    validationCasesCount: number;
    manualCasesCount: number;
    failedCases: Array<{
      caseName: string;
      input?: string;
      expectedOutput?: string;
      modelOutput?: string;
      score?: number;
      reason?: string;
    }>;
  };
}

export interface PromptAnalysisResult {
  score: number;
  suggestions: OptimizationSuggestion[];
  summary: string;
  strengths: string[];
}

/**
 * Build evaluation context string for the analysis prompt (Phase 3).
 */
function buildEvaluationContext(summary: PromptEvaluationSummary): string {
  if (summary.totalRuns === 0) return '';

  const lines: string[] = [];
  lines.push('\n\n--- EVALUATION DATA ---');
  lines.push(`Configuration: Target Model=[${summary.modelName}], Judge Model=[${summary.judgeModelName}]`);
  if (summary.criteriaNames && summary.criteriaNames.length > 0) {
    lines.push(`Evaluation Criteria: ${summary.criteriaNames.join(', ')}`);
  }
  lines.push(`Total Runs: ${summary.totalRuns}, Average Pass Rate: ${(summary.avgPassRate * 100).toFixed(1)}%`);

  // Criterion scores
  const criterionEntries = Object.entries(summary.avgCriterionScores);
  if (criterionEntries.length > 0) {
    lines.push(`Average Scores by Criterion: ${criterionEntries.map(([k, v]) => `${k}=${v.toFixed(1)}`).join(', ')}`);
  }

  // Recent delta
  if (summary.recentDelta) {
    const delta = summary.recentDelta;
    const direction = delta.passRateChange >= 0 ? '↑' : '↓';
    lines.push(`Recent Trend: Pass Rate ${direction}${Math.abs(delta.passRateChange * 100).toFixed(1)}%`);
  }

  // Top failures (limit to 5, truncate output)
  const failures = summary.topFailures.slice(0, 5);
  if (failures.length > 0) {
    lines.push('\nTop Failure Cases:');
    for (const f of failures) {
      lines.push(`  - "${f.testCaseName}" (failed ${f.failCount}/${f.totalCount} times)`);
      const output = f.latestModelOutput.length > 300
        ? f.latestModelOutput.slice(0, 300) + '...'
        : f.latestModelOutput;
      lines.push(`    Latest Output: ${output}`);
      if (f.expectedOutput) {
        const expected = f.expectedOutput.length > 200
          ? f.expectedOutput.slice(0, 200) + '...'
          : f.expectedOutput;
        lines.push(`    Expected: ${expected}`);
      }
      const feedbackEntries = Object.entries(f.latestAiFeedback);
      if (feedbackEntries.length > 0) {
        const feedbackStr = feedbackEntries.map(([k, v]) => {
          const truncated = typeof v === 'string' && v.length > 150 ? v.slice(0, 150) + '...' : v;
          return `${k}: ${truncated}`;
        }).join('; ');
        lines.push(`    Judge Feedback: ${feedbackStr}`);
      }
    }
  }

  lines.push('--- END EVALUATION DATA ---');

  // Token budget control: limit evaluation context to ~2000 chars
  let result = lines.join('\n');
  if (result.length > 2000) {
    result = result.slice(0, 2000) + '\n... (evaluation data truncated)';
  }

  return result;
}

function buildAutoOptimizeContext(context: NonNullable<PromptAnalysisRequest['autoOptimizeContext']>): string {
  const lines: string[] = [];
  lines.push('\n\n--- AUTO OPTIMIZATION LOOP CONTEXT ---');
  lines.push(
    `Round: ${context.round}/${context.maxRounds}, Source=${context.source}, Train=${context.trainCasesCount}, Validation=${context.validationCasesCount}, Manual=${context.manualCasesCount}`
  );

  const failedCases = context.failedCases.slice(0, 10);
  if (failedCases.length > 0) {
    lines.push('\nFailed/Target Cases For This Round:');
    failedCases.forEach((item, index) => {
      lines.push(`${index + 1}. Case="${item.caseName}"`);
      if (item.input) {
        const input = item.input.length > 250 ? `${item.input.slice(0, 250)}...` : item.input;
        lines.push(`   Input: ${input}`);
      }
      if (item.expectedOutput) {
        const expected = item.expectedOutput.length > 250 ? `${item.expectedOutput.slice(0, 250)}...` : item.expectedOutput;
        lines.push(`   Expected: ${expected}`);
      }
      if (item.modelOutput) {
        const output = item.modelOutput.length > 300 ? `${item.modelOutput.slice(0, 300)}...` : item.modelOutput;
        lines.push(`   Current Output: ${output}`);
      }
      if (typeof item.score === 'number') {
        lines.push(`   Score: ${item.score}`);
      }
      if (item.reason) {
        const reason = item.reason.length > 280 ? `${item.reason.slice(0, 280)}...` : item.reason;
        lines.push(`   Failure Reason: ${reason}`);
      }
    });
  }

  lines.push('--- END AUTO CONTEXT ---');

  let result = lines.join('\n');
  if (result.length > 2600) {
    result = `${result.slice(0, 2600)}\n... (auto optimize context truncated)`;
  }
  return result;
}

export async function analyzePrompt(
  modelId: string,
  request: PromptAnalysisRequest
): Promise<PromptAnalysisResult> {
  // Get the configurable analysis prompt from settings
  const settings = getOptimizationSettings();
  // Use the selected template's prompt if set, otherwise use the stored/default
  let analysisSystemPrompt = settings.analysisPrompt || i18n.t('defaultAnalysisPrompt', { ns: 'settings' });

  // Use 0-indexed [MSG-N] tags for message identification
  const promptContent = request.messages.length > 0
    ? request.messages.map((m, i) => `[MSG-${i}] (${m.role.toUpperCase()})\n${m.content}`).join('\n\n---\n\n')
    : request.content;

  const variablesInfo = request.variables.length > 0
    ? `\n\nVariable Definitions:\n${request.variables.map(v => `- {{${v.name}}}: ${v.type}${v.required ? ' (required)' : ''} ${v.description || ''}`).join('\n')}`
    : '';

  let userMessage = `Please analyze the following Prompt:\n\n${promptContent}${variablesInfo}`;

  // Append evaluation data if available (Phase 3)
  if (request.evaluationSummary && request.evaluationSummary.totalRuns > 0) {
    const evalContext = buildEvaluationContext(request.evaluationSummary);
    userMessage += evalContext;

    // Append evaluation-specific instructions to system prompt
    analysisSystemPrompt += `\n\nIMPORTANT: Evaluation data is provided. When making suggestions:
1. Prioritize suggestions that address the high-frequency failure cases
2. For each suggestion, explain which failure case(s) it is expected to resolve
3. If a problem cannot be fixed by prompt changes alone (e.g., model capability limits), note this explicitly
4. The messageIndex field must correspond to the [MSG-N] tags in the prompt content`;
  }

  if (request.autoOptimizeContext && request.autoOptimizeContext.failedCases.length > 0) {
    userMessage += buildAutoOptimizeContext(request.autoOptimizeContext);
    analysisSystemPrompt += `\n\nIMPORTANT: You are in an iterative auto-optimization loop.
1. Treat AUTO OPTIMIZATION LOOP CONTEXT as the highest-priority evidence.
2. Provide concrete rewrite suggestions that directly fix the listed failed/target cases.
3. Prefer suggestions with explicit before/after text and stable output constraints.
4. Reduce the chance of regression on already-satisfied requirements.
5. The messageIndex field must correspond to the [MSG-N] tags in the prompt content.`;
  }

  // Determine structured output support
  const structuredSupport = inferStructuredOutputSupport(modelId);

  // Build responseFormat based on model capabilities
  let responseFormat: object | undefined;
  if (structuredSupport === 'json_schema') {
    responseFormat = OPTIMIZATION_RESULT_SCHEMA;
  } else if (structuredSupport === 'json_object') {
    responseFormat = OPTIMIZATION_RESULT_JSON_OBJECT_FORMAT;
  }

  const result = await chatApi.complete({
    modelId,
    messages: [
      { role: 'system', content: analysisSystemPrompt },
      { role: 'user', content: userMessage },
    ],
    saveTrace: false,
    responseFormat,
  });

  // Parse the result based on structured output mode
  if (structuredSupport === 'json_schema') {
    // json_schema mode: output should be valid JSON directly
    return parseJsonResponse(result.content);
  }

  // json_object or none: try JSON.parse with fallback
  return parseWithFallback(result.content);
}

/**
 * Parse response assuming it's valid JSON (for json_schema mode).
 */
function parseJsonResponse(content: string): PromptAnalysisResult {
  try {
    const parsed = JSON.parse(content.trim());
    return normalizeResult(parsed);
  } catch {
    // Fallback to full parsing pipeline
    return parseWithFallback(content);
  }
}

/**
 * Parse response with code block extraction and regex fallback.
 */
function parseWithFallback(content: string): PromptAnalysisResult {
  try {
    let jsonContent = content.trim();

    // Try to extract from code block
    const jsonMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonContent = jsonMatch[1].trim();
    }

    // Try to parse JSON
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonContent);
    } catch {
      // Try to extract score and other fields using regex as fallback
      const scoreMatch = jsonContent.match(/"score"\s*:\s*(\d+)/);
      const summaryMatch = jsonContent.match(/"summary"\s*:\s*"([^"]+)"/);

      if (scoreMatch) {
        const score = parseInt(scoreMatch[1], 10);
        const summary = summaryMatch ? summaryMatch[1] : '分析完成';

        // Try to extract strengths array
        const strengthsMatch = jsonContent.match(/"strengths"\s*:\s*\[([\s\S]*?)\]/);
        let strengths: string[] = [];
        if (strengthsMatch) {
          const strengthsContent = strengthsMatch[1];
          const strengthItems = strengthsContent.match(/"([^"]+)"/g);
          if (strengthItems) {
            strengths = strengthItems.map(s => s.replace(/^"|"$/g, ''));
          }
        }

        return {
          score: Math.min(100, Math.max(0, score)),
          summary,
          strengths,
          suggestions: [],
        };
      }

      throw new Error('Cannot parse JSON');
    }

    return normalizeResult(parsed);
  } catch {
    return {
      score: 0,
      summary: '分析结果解析失败，请重试',
      strengths: [],
      suggestions: [],
    };
  }
}

/**
 * Normalize parsed result into a clean PromptAnalysisResult.
 */
function normalizeResult(parsed: Record<string, unknown>): PromptAnalysisResult {
  const suggestions: OptimizationSuggestion[] = (parsed.suggestions as Array<Omit<OptimizationSuggestion, 'id'>> || []).map(
    (s: Omit<OptimizationSuggestion, 'id'>, i: number) => ({
      ...s,
      id: `suggestion_${Date.now()}_${i}`,
      severity: s.severity || 'medium',
      applied: false,
    })
  );

  return {
    score: Math.min(100, Math.max(0, (parsed.score as number) || 0)),
    summary: (parsed.summary as string) || '分析完成',
    strengths: (parsed.strengths as string[]) || [],
    suggestions,
  };
}
