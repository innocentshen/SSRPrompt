import { resetPromptTestPanelCaches } from '../components/Prompt/PromptTestPanel';
import { useEvaluationStore } from '../store/useEvaluationStore';
import { useGlobalStore } from '../store/useGlobalStore';
import { useOcrSettingsStore } from '../store/useOcrSettingsStore';
import { usePromptsStore } from '../store/usePromptsStore';
import { useTracesStore } from '../store/useTracesStore';
import { resetEvaluationPageCaches } from '../pages/EvaluationPage';
import { resetPromptsPageCaches } from '../pages/PromptsPage';

export function resetUserSessionState(): void {
  resetPromptTestPanelCaches();
  resetPromptsPageCaches();
  resetEvaluationPageCaches();
  useGlobalStore.getState().clear();
  usePromptsStore.getState().resetStore();
  useTracesStore.getState().resetStore();
  useEvaluationStore.getState().resetStore();
  useOcrSettingsStore.getState().clear();
}
