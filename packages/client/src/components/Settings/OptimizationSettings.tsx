import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Save, RotateCcw, Info } from 'lucide-react';
import { Button, useToast } from '../ui';

const STORAGE_KEY = 'ssrprompt_optimization_settings';

export interface OptimizationSettingsData {
  analysisPrompt: string;
}

// 获取默认分析提示词（需要传入翻译函数）
export function getDefaultAnalysisPrompt(t: (key: string) => string): string {
  return t('defaultAnalysisPrompt');
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
  // 返回空字符串，让调用方使用翻译后的默认值
  return { analysisPrompt: '' };
}

export function saveOptimizationSettings(settings: OptimizationSettingsData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function OptimizationSettings() {
  const { t } = useTranslation('settings');
  const { showToast } = useToast();
  const defaultPrompt = t('defaultAnalysisPrompt');
  const [analysisPrompt, setAnalysisPrompt] = useState(defaultPrompt);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    const settings = getOptimizationSettings();
    // 如果存储的值为空，使用翻译后的默认值
    setAnalysisPrompt(settings.analysisPrompt || defaultPrompt);
  }, [defaultPrompt]);

  const handleSave = () => {
    saveOptimizationSettings({ analysisPrompt });
    setHasChanges(false);
    showToast('success', t('settingsSaved'));
  };

  const handleReset = () => {
    setAnalysisPrompt(defaultPrompt);
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
            {t('smartOptimizationSettings')}
          </h2>
          <p className="text-sm text-slate-500 light:text-slate-600">
            {t('configureAnalysisPrompt')}
          </p>
        </div>
      </div>

      <div className="bg-slate-800/30 light:bg-slate-100 rounded-lg p-4 border border-slate-700 light:border-slate-200">
        <div className="flex items-start gap-2 mb-4">
          <Info className="w-4 h-4 text-cyan-400 light:text-cyan-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-slate-400 light:text-slate-600">
            {t('analysisPromptDescription')}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
              {t('analysisSystemPrompt')}
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="text-xs"
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              {t('resetToDefault')}
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
            {t('saveSettings')}
          </Button>
        </div>
      </div>
    </div>
  );
}
