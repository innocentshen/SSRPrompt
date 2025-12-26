// Global store - providers, models (shared across pages)
export { useGlobalStore } from './useGlobalStore';

// UI store - toasts, modals, sidebar
export { useUIStore, useToast } from './useUIStore';
export type { ToastType, Toast } from './useUIStore';

// Prompts store - prompt editing, versions, compare, debug
export { usePromptsStore } from './usePromptsStore';

// Traces store - history with pagination
export { useTracesStore } from './useTracesStore';

// Evaluation store - evaluations, test cases, runs
export { useEvaluationStore } from './useEvaluationStore';

// Selectors - optimized state access
export {
  // Global
  useEnabledProviders,
  useEnabledModels,
  useModelById,
  useProviderById,
  useModelName,
  // Prompts
  useFilteredPrompts,
  useSelectedPrompt,
  usePromptEditState,
  useCompareState,
  // Traces
  useSelectedTrace,
  useFilteredTraces,
  // Evaluation
  useSelectedEvaluation,
  useSelectedRun,
  useRunResults,
  usePassRate,
} from './selectors';
