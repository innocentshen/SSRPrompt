import { useEffect, useMemo } from 'react';
import type { OcrProvider } from '../types';
import { useOcrSettingsStore } from '../store/useOcrSettingsStore';

export const OCR_PROVIDER_ORDER: OcrProvider[] = ['paddle', 'paddle_vl', 'paddle_vl_1_5', 'datalab', 'mineru', 'multimodal_model'];

export function getOcrProviderOptionLabel(provider: OcrProvider, t: (key: string) => string): string {
  if (provider === 'paddle') return 'PaddleOCR';
  if (provider === 'paddle_vl') return t('ocrProviderPaddleVl');
  if (provider === 'paddle_vl_1_5') return t('ocrProviderPaddleVl15');
  if (provider === 'datalab') return t('ocrProviderDatalab');
  if (provider === 'multimodal_model') return t('ocrProviderMultimodalModel');
  return t('ocrProviderMineru');
}

export function buildOcrProviderOptions(
  enabledProviders: OcrProvider[],
  t: (key: string) => string,
  includeFollow = false
): Array<{ value: OcrProvider | ''; label: string }> {
  const options = enabledProviders.map((provider) => ({
    value: provider,
    label: getOcrProviderOptionLabel(provider, t),
  }));
  if (!includeFollow) return options;
  return [{ value: '', label: t('ocrProviderFollow') }, ...options];
}

export function useEnabledOcrProviders(): { enabledOcrProviders: OcrProvider[] } {
  const { settings, fetchSettings } = useOcrSettingsStore();

  useEffect(() => {
    fetchSettings().catch(() => {});
  }, [fetchSettings]);

  const enabledOcrProviders = useMemo(() => {
    const enabledMap = settings?.providerEnabled;
    if (!enabledMap) return OCR_PROVIDER_ORDER;
    const enabled = OCR_PROVIDER_ORDER.filter((provider) => enabledMap[provider]);
    return enabled.length > 0 ? enabled : OCR_PROVIDER_ORDER;
  }, [settings]);

  return { enabledOcrProviders };
}
