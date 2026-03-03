import { resetPromptTestPanelCaches } from '../components/Prompt/PromptTestPanel';
import { useAnalysisTaskStore } from '../store/useAnalysisTaskStore';
import { useEvaluationStore } from '../store/useEvaluationStore';
import { useGlobalStore } from '../store/useGlobalStore';
import { useOcrSettingsStore } from '../store/useOcrSettingsStore';
import { usePromptsStore } from '../store/usePromptsStore';
import { useTracesStore } from '../store/useTracesStore';

async function resetLazyPageCaches(): Promise<void> {
  const [{ resetPromptsPageCaches }, { resetEvaluationPageCaches }] = await Promise.all([
    import('../pages/PromptsPage'),
    import('../pages/EvaluationPage'),
  ]);
  resetPromptsPageCaches();
  resetEvaluationPageCaches();
}

export function resetUserSessionState(): void {
  resetPromptTestPanelCaches();
  void resetLazyPageCaches().catch((error) => {
    console.error('Failed to reset page-local caches:', error);
  });
  useGlobalStore.getState().clear();
  usePromptsStore.getState().resetStore();
  useTracesStore.getState().resetStore();
  useEvaluationStore.getState().resetStore();
  useAnalysisTaskStore.getState().clearTask();
  useOcrSettingsStore.getState().clear();
}
