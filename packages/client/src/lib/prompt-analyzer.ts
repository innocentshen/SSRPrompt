import type { Provider, PromptMessage, PromptVariable } from '../types';
import { callAIModel } from './ai-service';
import { getOptimizationSettings } from '../components/Settings/OptimizationSettings';
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
  provider: Provider,
  modelName: string,
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

  const result = await callAIModel(
    provider,
    modelName,
    analysisSystemPrompt,
    userMessage
  );

  try {
    let jsonContent = result.content.trim();

    const jsonMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonContent = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonContent);

    const suggestions: OptimizationSuggestion[] = (parsed.suggestions || []).map(
      (s: Omit<OptimizationSuggestion, 'id'>, i: number) => ({
        ...s,
        id: `suggestion_${Date.now()}_${i}`,
        severity: s.severity || 'medium',
        applied: false,
      })
    );

    return {
      score: Math.min(100, Math.max(0, parsed.score || 0)),
      summary: parsed.summary || '分析完成',
      strengths: parsed.strengths || [],
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
