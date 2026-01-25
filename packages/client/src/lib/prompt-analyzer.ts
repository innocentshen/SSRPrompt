import type { PromptMessage, PromptVariable } from '../types';
import { chatApi } from '../api/chat';
import { getOptimizationSettings } from './optimization-settings';
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

export interface PromptAnalysisRequest {
  messages: PromptMessage[];
  content: string;
  variables: PromptVariable[];
}

export interface PromptAnalysisResult {
  score: number;
  suggestions: OptimizationSuggestion[];
  summary: string;
  strengths: string[];
}

export async function analyzePrompt(
  modelId: string,
  request: PromptAnalysisRequest
): Promise<PromptAnalysisResult> {
  // Get the configurable analysis prompt from settings
  const settings = getOptimizationSettings();
  // 如果存储的值为空，使用翻译后的默认值
  const analysisSystemPrompt = settings.analysisPrompt || i18n.t('defaultAnalysisPrompt', { ns: 'settings' });

  const promptContent = request.messages.length > 0
    ? request.messages.map((m, i) => `[消息 ${i + 1} - ${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n')
    : request.content;

  const variablesInfo = request.variables.length > 0
    ? `\n\n变量定义:\n${request.variables.map(v => `- {{${v.name}}}: ${v.type}${v.required ? ' (必需)' : ''} ${v.description || ''}`).join('\n')}`
    : '';

  const userMessage = `请分析以下 Prompt:\n\n${promptContent}${variablesInfo}`;

  const result = await chatApi.complete({
    modelId,
    messages: [
      { role: 'system', content: analysisSystemPrompt },
      { role: 'user', content: userMessage },
    ],
    saveTrace: false,
  });

  try {
    let jsonContent = result.content.trim();

    const jsonMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonContent = jsonMatch[1].trim();
    }

    // Try to parse JSON, with fallback for common issues
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonContent);
    } catch {
      // Try to extract score and other fields using regex as fallback
      const scoreMatch = jsonContent.match(/"score"\s*:\s*(\d+)/);
      const summaryMatch = jsonContent.match(/"summary"\s*:\s*"([^"]+)"/);

      if (scoreMatch) {
        // Extract what we can from malformed JSON
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

      // Re-throw if we couldn't extract anything useful
      throw new Error('Cannot parse JSON');
    }

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
  } catch {
    return {
      score: 0,
      summary: '分析结果解析失败，请重试',
      strengths: [],
      suggestions: [],
    };
  }
}
