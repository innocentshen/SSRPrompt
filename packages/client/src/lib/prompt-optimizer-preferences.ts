const STORAGE_KEY = 'ssrprompt_prompt_optimizer_preferences';

export interface PromptOptimizerPreference {
  modelId?: string;
  templateId?: string;
  evaluationId?: string;
}

type PromptOptimizerPreferenceStore = Record<string, PromptOptimizerPreference>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readPreferenceStore(): PromptOptimizerPreferenceStore {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return {};

    const normalized: PromptOptimizerPreferenceStore = {};
    for (const [promptId, value] of Object.entries(parsed)) {
      if (!isRecord(value)) continue;
      normalized[promptId] = {
        modelId: typeof value.modelId === 'string' ? value.modelId : undefined,
        templateId: typeof value.templateId === 'string' ? value.templateId : undefined,
        evaluationId: typeof value.evaluationId === 'string' ? value.evaluationId : undefined,
      };
    }
    return normalized;
  } catch {
    return {};
  }
}

function writePreferenceStore(store: PromptOptimizerPreferenceStore): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage write errors so UI remains functional.
  }
}

export function getPromptOptimizerPreference(promptId?: string | null): PromptOptimizerPreference {
  if (!promptId) return {};
  const store = readPreferenceStore();
  return store[promptId] || {};
}

export function savePromptOptimizerPreference(
  promptId: string,
  patch: PromptOptimizerPreference
): void {
  if (!promptId) return;

  const store = readPreferenceStore();
  const current = store[promptId] || {};
  const next: PromptOptimizerPreference = {
    ...current,
    ...patch,
  };

  store[promptId] = next;
  writePreferenceStore(store);
}
