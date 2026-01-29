import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export type OutputRenderFormat = 'auto' | 'json' | 'html' | 'markdown' | 'text';

export interface OutputRenderPreferences {
  format: OutputRenderFormat;
}

const DEFAULT_PREFERENCES: OutputRenderPreferences = {
  format: 'auto',
};

const VALID_FORMATS: OutputRenderFormat[] = ['auto', 'json', 'html', 'markdown', 'text'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizePreferences(
  value: unknown,
  defaults: OutputRenderPreferences
): OutputRenderPreferences {
  if (!isRecord(value)) return defaults;

  const candidate = value.format as unknown;
  if (typeof candidate === 'string' && VALID_FORMATS.includes(candidate as OutputRenderFormat)) {
    return { format: candidate as OutputRenderFormat };
  }
  return defaults;
}

export function loadOutputRenderPreferences(
  storageKey: string,
  defaults?: Partial<OutputRenderPreferences>
): OutputRenderPreferences {
  const mergedDefaults: OutputRenderPreferences = { ...DEFAULT_PREFERENCES, ...(defaults ?? {}) };

  if (typeof window === 'undefined') return mergedDefaults;

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return mergedDefaults;
    const parsed = JSON.parse(stored) as unknown;
    return normalizePreferences(parsed, mergedDefaults);
  } catch {
    return mergedDefaults;
  }
}

export function useOutputRenderPreferences(
  storageKey: string,
  defaults?: Partial<OutputRenderPreferences>
): [OutputRenderPreferences, Dispatch<SetStateAction<OutputRenderPreferences>>] {
  const [preferences, setPreferences] = useState<OutputRenderPreferences>(() =>
    loadOutputRenderPreferences(storageKey, defaults)
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
      // Ignore quota / privacy mode errors.
    }
  }, [preferences, storageKey]);

  return [preferences, setPreferences];
}
