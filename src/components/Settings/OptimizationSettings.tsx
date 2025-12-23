import { useState, useEffect } from 'react';
import { Sparkles, Save, RotateCcw, Info } from 'lucide-react';
import { Button, useToast } from '../ui';

const DEFAULT_ANALYSIS_PROMPT = `你是一个专业的 Prompt 工程师，擅长分析和优化 AI Prompt。
请分析用户提供的 Prompt，并从以下维度给出改进建议:

1. **Clarity (清晰度)**: Prompt 是否表达清晰，有无歧义
2. **Structure (结构)**: Prompt 的结构是否合理，是否有清晰的分段
3. **Specificity (具体性)**: 指令是否足够具体，是否有明确的约束
4. **Examples (示例)**: 是否需要添加示例来帮助模型理解
5. **Constraints (约束)**: 是否有必要的输出格式、长度、风格约束

评分标准 (0-100):
- 90-100: 优秀，几乎不需要改进
- 70-89: 良好，有一些小的改进空间
- 50-69: 一般，有明显的改进空间
- 0-49: 需要较大改进

请严格按照以下 JSON 格式返回分析结果，不要包含其他内容:
{
  "score": number,
  "summary": "总体评价（1-2句话）",
  "strengths": ["优点1", "优点2"],
  "suggestions": [
    {
      "type": "clarity|structure|specificity|examples|constraints",
      "title": "建议标题（简短）",
      "description": "详细说明为什么需要这个改进",
      "originalText": "需要改进的原文片段（如有具体文本）",
      "suggestedText": "建议替换的文本（如有具体建议）",
      "severity": "low|medium|high"
    }
  ]
}

注意:
- originalText 和 suggestedText 是可选的，只有在有具体的文本替换建议时才提供
- severity 表示改进的重要性: high=必须改进, medium=建议改进, low=可选改进
- 建议数量控制在 3-6 条，按重要性排序
- 如果 Prompt 已经很好，可以只返回 1-2 条低优先级建议或空数组`;

const STORAGE_KEY = 'ssrprompt_optimization_settings';

export interface OptimizationSettingsData {
  analysisPrompt: string;
}

export function getOptimizationSettings(): OptimizationSettingsData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return { analysisPrompt: DEFAULT_ANALYSIS_PROMPT };
}

export function saveOptimizationSettings(settings: OptimizationSettingsData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function OptimizationSettings() {
  const { showToast } = useToast();
  const [analysisPrompt, setAnalysisPrompt] = useState(DEFAULT_ANALYSIS_PROMPT);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    const settings = getOptimizationSettings();
    setAnalysisPrompt(settings.analysisPrompt);
  }, []);

  const handleSave = () => {
    saveOptimizationSettings({ analysisPrompt });
    setHasChanges(false);
    showToast('success', '设置已保存');
  };

  const handleReset = () => {
    setAnalysisPrompt(DEFAULT_ANALYSIS_PROMPT);
    setHasChanges(true);
  };

  const handleChange = (value: string) => {
    setAnalysisPrompt(value);
    setHasChanges(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-200 light:text-slate-800">
            智能优化设置
          </h2>
          <p className="text-sm text-slate-500 light:text-slate-600">
            配置 AI 分析 Prompt 时使用的系统提示词
          </p>
        </div>
      </div>

      <div className="bg-slate-800/30 light:bg-slate-100 rounded-lg p-4 border border-slate-700 light:border-slate-200">
        <div className="flex items-start gap-2 mb-4">
          <Info className="w-4 h-4 text-cyan-400 light:text-cyan-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-slate-400 light:text-slate-600">
            此提示词用于指导 AI 如何分析和评估你的 Prompt。你可以根据需要自定义分析维度、评分标准和输出格式。
            修改后请确保 AI 仍能返回有效的 JSON 格式。
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
              分析系统提示词
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="text-xs"
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              重置为默认
            </Button>
          </div>
          <textarea
            value={analysisPrompt}
            onChange={(e) => handleChange(e.target.value)}
            rows={20}
            className="w-full p-3 bg-slate-900 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 font-mono resize-y focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex justify-end mt-4">
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!hasChanges}
          >
            <Save className="w-4 h-4 mr-1" />
            保存设置
          </Button>
        </div>
      </div>
    </div>
  );
}
