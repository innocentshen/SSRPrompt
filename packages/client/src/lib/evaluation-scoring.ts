import type { EvaluationCriterion } from '@ssrprompt/shared';
import { chatApi } from '../api/chat';

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

export function parseJudgeEvaluationResponse(
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

export function buildJudgePrompt(
  criterionPrompt: string,
  testInput: string,
  expectedOutput: string | null | undefined,
  modelOutput: string
): string {
  let evalPrompt = criterionPrompt || '';
  evalPrompt = evalPrompt.replace(/{{input}}/g, testInput || '');
  evalPrompt = evalPrompt.replace(/{{output}}/g, modelOutput || '');
  if (expectedOutput) {
    evalPrompt = evalPrompt.replace(
      /{{#expected}}[\s\S]*?{{\/expected}}/g,
      evalPrompt.match(/{{#expected}}([\s\S]*?){{\/expected}}/)?.[1]?.replace(/{{expected}}/g, expectedOutput) || ''
    );
    evalPrompt = evalPrompt.replace(/{{expected}}/g, expectedOutput);
  } else {
    evalPrompt = evalPrompt.replace(/{{#expected}}[\s\S]*?{{\/expected}}/g, '');
  }
  return evalPrompt;
}

export function computeWeightedScore(
  scores: Record<string, number>,
  enabledCriteria: EvaluationCriterion[]
): number {
  if (enabledCriteria.length === 0) return 1;
  const weightSum = enabledCriteria.reduce((sum, criterion) => sum + (criterion.weight || 1), 0) || 1;
  const weighted = enabledCriteria.reduce((sum, criterion) => {
    return sum + (scores[criterion.name] || 0) * (criterion.weight || 1);
  }, 0);
  return weighted / weightSum;
}

export function computeWeightedPass(
  scores: Record<string, number>,
  enabledCriteria: EvaluationCriterion[],
  passThreshold: number
): boolean {
  if (enabledCriteria.length === 0) return true;
  return computeWeightedScore(scores, enabledCriteria) >= passThreshold;
}

type EvaluateOutputWithCriteriaInput = {
  judgeModelId: string;
  criteria: EvaluationCriterion[];
  passThreshold: number;
  testInput: string;
  expectedOutput?: string | null;
  modelOutput: string;
  fallbackReason: string;
  signal?: AbortSignal;
};

type EvaluateOutputWithCriteriaResult = {
  scores: Record<string, number>;
  feedback: Record<string, string>;
  weightedScore: number;
  passed: boolean;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export async function evaluateOutputWithCriteria(
  input: EvaluateOutputWithCriteriaInput
): Promise<EvaluateOutputWithCriteriaResult> {
  const enabledCriteria = input.criteria.filter((criterion) => criterion.enabled && (criterion.prompt || '').trim().length > 0);
  if (enabledCriteria.length === 0) {
    return {
      scores: {},
      feedback: {},
      weightedScore: 1,
      passed: true,
    };
  }

  const scores: Record<string, number> = {};
  const feedback: Record<string, string> = {};

  for (const criterion of enabledCriteria) {
    if (input.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      const evalPrompt = buildJudgePrompt(
        criterion.prompt || '',
        input.testInput,
        input.expectedOutput,
        input.modelOutput
      );
      const response = await chatApi.complete({
        modelId: input.judgeModelId,
        messages: [{ role: 'user', content: evalPrompt }],
        saveTrace: false,
        isEvalCase: true,
      }, input.signal);

      const parsed = parseJudgeEvaluationResponse(response.content, input.fallbackReason);
      scores[criterion.name] = parsed.score;
      feedback[criterion.name] = parsed.reason;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      scores[criterion.name] = 0;
      feedback[criterion.name] = input.fallbackReason;
    }
  }

  const weightedScore = computeWeightedScore(scores, enabledCriteria);
  const passed = computeWeightedPass(scores, enabledCriteria, input.passThreshold);

  return {
    scores,
    feedback,
    weightedScore,
    passed,
  };
}

type EvaluateOutputWithExpectedSemanticInput = {
  judgeModelId: string;
  passThreshold: number;
  testInput: string;
  expectedOutput: string;
  modelOutput: string;
  fallbackReason: string;
  signal?: AbortSignal;
};

type EvaluateOutputWithExpectedSemanticResult = {
  score: number;
  reason: string;
  passed: boolean;
};

function buildExpectedSemanticJudgePrompt(
  testInput: string,
  expectedOutput: string,
  modelOutput: string
): string {
  return [
    'You are an impartial evaluator.',
    'Judge whether the model output satisfies the expected output requirement based on semantic understanding.',
    'Focus on meaning equivalence, key information coverage, constraints, and required structure.',
    'Ignore wording differences when intent and required details are preserved.',
    'Return JSON only with this schema: {"score": number (0-10), "reason": string}.',
    'User Input:',
    testInput || '(empty)',
    'Expected Output Requirement:',
    expectedOutput || '(empty)',
    'Model Output:',
    modelOutput || '(empty)',
  ].join('\n\n');
}

export async function evaluateOutputWithExpectedSemantic(
  input: EvaluateOutputWithExpectedSemanticInput
): Promise<EvaluateOutputWithExpectedSemanticResult> {
  if (!input.expectedOutput.trim()) {
    return {
      score: 0,
      reason: input.fallbackReason,
      passed: false,
    };
  }

  try {
    const evalPrompt = buildExpectedSemanticJudgePrompt(
      input.testInput,
      input.expectedOutput,
      input.modelOutput
    );
    const response = await chatApi.complete({
      modelId: input.judgeModelId,
      messages: [{ role: 'user', content: evalPrompt }],
      saveTrace: false,
      isEvalCase: true,
    }, input.signal);

    const parsed = parseJudgeEvaluationResponse(response.content, input.fallbackReason);
    const normalizedScore = clampScore(parsed.score);
    return {
      score: normalizedScore,
      reason: parsed.reason || input.fallbackReason,
      passed: normalizedScore >= input.passThreshold,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return {
      score: 0,
      reason: input.fallbackReason,
      passed: false,
    };
  }
}
