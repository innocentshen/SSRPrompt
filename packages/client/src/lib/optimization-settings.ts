const STORAGE_KEY = 'ssrprompt_optimization_settings';

export interface OptimizationSettingsData {
  analysisPrompt: string;
}

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
    return { analysisPrompt: '' };
  }
  return { analysisPrompt: '' };
}

export function saveOptimizationSettings(settings: OptimizationSettingsData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
