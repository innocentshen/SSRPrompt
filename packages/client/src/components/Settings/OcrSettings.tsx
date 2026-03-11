import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, FlaskConical, Loader2, Search } from 'lucide-react';
import { Button, Checkbox, Input, Modal, Toggle, useToast } from '../ui';
import { useOcrSettingsStore } from '../../store/useOcrSettingsStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useGlobalStore } from '../../store/useGlobalStore';
import { ocrApi } from '../../api/ocr';
import type {
  OcrProvider,
  OcrCredentialSource,
  OcrTestResult,
  OcrSystemProviderSettings,
  MineruModelVersion,
  DatalabOcrMode,
  UpdateOcrProviderSettingsDto,
  UpdateOcrSystemProviderSettingsDto,
} from '../../types';

function providerLabel(provider: OcrProvider, t: (k: string) => string): string {
  if (provider === 'paddle') return 'PaddleOCR';
  if (provider === 'paddle_vl') return 'PaddleOCR-VL';
  if (provider === 'paddle_vl_1_5') return 'PaddleOCR-VL-1.5';
  if (provider === 'mineru') return 'MinerU';
  if (provider === 'multimodal_model') return t('ocrProviderMultimodalModel');
  return t('datalabExperimental');
}

function credentialLabel(source: OcrCredentialSource, t: (k: string) => string): string {
  return source === 'system' ? t('credentialSystem') : t('credentialCustom');
}

type TriStateBoolean = 'default' | 'true' | 'false';
type ProviderEnabledState = Record<OcrProvider, boolean>;

const OCR_PROVIDER_ITEMS: OcrProvider[] = ['paddle', 'paddle_vl', 'paddle_vl_1_5', 'datalab', 'mineru', 'multimodal_model'];
const SYSTEM_OCR_PROVIDER_ITEMS: OcrProvider[] = ['paddle', 'paddle_vl', 'paddle_vl_1_5', 'datalab', 'mineru'];
const SYSTEM_OCR_PROVIDER_CONFIG_VISIBLE = import.meta.env.VITE_ENABLE_SYSTEM_OCR_PROVIDER_CONFIG === 'true';

function createProviderEnabledState(
  initial?: Partial<Record<OcrProvider, boolean>>,
  selectedProvider: OcrProvider = 'paddle',
  selectedEnabled = false
): ProviderEnabledState {
  const next: ProviderEnabledState = {
    paddle: false,
    paddle_vl: false,
    paddle_vl_1_5: false,
    datalab: false,
    mineru: false,
    multimodal_model: false,
  };
  for (const provider of OCR_PROVIDER_ITEMS) {
    if (typeof initial?.[provider] === 'boolean') {
      next[provider] = initial[provider];
    }
  }
  if (typeof initial?.[selectedProvider] !== 'boolean') {
    next[selectedProvider] = selectedEnabled;
  }
  return next;
}

function toTriState(value?: boolean | null): TriStateBoolean {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return 'default';
}

function fromTriState(value: TriStateBoolean): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function toOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

export function OcrSettings() {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { showToast } = useToast();
  const { settings, isLoading, fetchSettings, saveSettings } = useOcrSettingsStore();
  const { user } = useAuthStore();
  const { models, providers, fetchProvidersAndModels } = useGlobalStore();
  const isAdmin = user?.roles?.includes('admin') ?? false;

  const [provider, setProvider] = useState<OcrProvider>('paddle');
  const [providerEnabled, setProviderEnabled] = useState<ProviderEnabledState>(() => createProviderEnabledState());
  const [providerQuery, setProviderQuery] = useState('');
  const [credentialSource, setCredentialSource] = useState<OcrCredentialSource>('system');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testOpen, setTestOpen] = useState(false);

  // MinerU request parameters (stored with OCR settings)
  const [mineruUserToken, setMineruUserToken] = useState('');
  const [mineruModelVersion, setMineruModelVersion] = useState<MineruModelVersion>('pipeline');
  const [mineruIsOcr, setMineruIsOcr] = useState(true);
  const [mineruEnableFormula, setMineruEnableFormula] = useState(true);
  const [mineruEnableTable, setMineruEnableTable] = useState(true);
  const [mineruLanguage, setMineruLanguage] = useState('ch');
  const [mineruExtraDocx, setMineruExtraDocx] = useState(false);
  const [mineruExtraHtml, setMineruExtraHtml] = useState(false);
  const [mineruExtraLatex, setMineruExtraLatex] = useState(false);
  const [mineruPageRanges, setMineruPageRanges] = useState('');

  const [datalabMode, setDatalabMode] = useState<DatalabOcrMode>('fast');
  const [datalabMaxPages, setDatalabMaxPages] = useState('');
  const [datalabPageRange, setDatalabPageRange] = useState('');
  const [datalabPaginate, setDatalabPaginate] = useState(false);
  const [datalabAddBlockIds, setDatalabAddBlockIds] = useState(false);
  const [datalabDisableImageExtraction, setDatalabDisableImageExtraction] = useState(false);
  const [datalabDisableImageCaptions, setDatalabDisableImageCaptions] = useState(false);
  const [datalabOutputFormat, setDatalabOutputFormat] = useState('');
  const [datalabSkipCache, setDatalabSkipCache] = useState(false);
  const [datalabSaveCheckpoint, setDatalabSaveCheckpoint] = useState(false);
  const [datalabExtras, setDatalabExtras] = useState('');
  const [datalabAdditionalConfig, setDatalabAdditionalConfig] = useState('');

  const [paddleUseDocOrientationClassify, setPaddleUseDocOrientationClassify] = useState<TriStateBoolean>('default');
  const [paddleUseDocUnwarping, setPaddleUseDocUnwarping] = useState<TriStateBoolean>('default');
  const [paddleUseTextlineOrientation, setPaddleUseTextlineOrientation] = useState<TriStateBoolean>('default');
  const [paddleTextDetLimitSideLen, setPaddleTextDetLimitSideLen] = useState('');
  const [paddleTextDetLimitType, setPaddleTextDetLimitType] = useState<'default' | 'min' | 'max'>('default');
  const [paddleTextDetThresh, setPaddleTextDetThresh] = useState('');
  const [paddleTextDetBoxThresh, setPaddleTextDetBoxThresh] = useState('');
  const [paddleTextDetUnclipRatio, setPaddleTextDetUnclipRatio] = useState('');
  const [paddleTextRecScoreThresh, setPaddleTextRecScoreThresh] = useState('');
  const [paddleVisualize, setPaddleVisualize] = useState<TriStateBoolean>('default');

  const [paddleVlUseDocOrientationClassify, setPaddleVlUseDocOrientationClassify] = useState<TriStateBoolean>('default');
  const [paddleVlUseDocUnwarping, setPaddleVlUseDocUnwarping] = useState<TriStateBoolean>('default');
  const [paddleVlUseLayoutDetection, setPaddleVlUseLayoutDetection] = useState<TriStateBoolean>('default');
  const [paddleVlUseChartRecognition, setPaddleVlUseChartRecognition] = useState<TriStateBoolean>('default');
  const [paddleVlLayoutThreshold, setPaddleVlLayoutThreshold] = useState('');
  const [paddleVlLayoutNms, setPaddleVlLayoutNms] = useState<TriStateBoolean>('default');
  const [paddleVlLayoutUnclipRatio, setPaddleVlLayoutUnclipRatio] = useState('');
  const [paddleVlLayoutMergeBboxesMode, setPaddleVlLayoutMergeBboxesMode] = useState<'default' | 'large' | 'small' | 'union'>('default');
  const [paddleVlPromptLabel, setPaddleVlPromptLabel] = useState('');
  const [paddleVlRepetitionPenalty, setPaddleVlRepetitionPenalty] = useState('');
  const [paddleVlTemperature, setPaddleVlTemperature] = useState('');
  const [paddleVlTopP, setPaddleVlTopP] = useState('');
  const [paddleVlMinPixels, setPaddleVlMinPixels] = useState('');
  const [paddleVlMaxPixels, setPaddleVlMaxPixels] = useState('');
  const [paddleVlShowFormulaNumber, setPaddleVlShowFormulaNumber] = useState<TriStateBoolean>('default');
  const [paddleVlPrettifyMarkdown, setPaddleVlPrettifyMarkdown] = useState<TriStateBoolean>('default');
  const [paddleVlVisualize, setPaddleVlVisualize] = useState<TriStateBoolean>('default');

  const [multimodalModelId, setMultimodalModelId] = useState('');
  const [multimodalPrompt, setMultimodalPrompt] = useState('');
  const [multimodalTemperature, setMultimodalTemperature] = useState('0');
  const [multimodalTopP, setMultimodalTopP] = useState('');
  const [multimodalMaxTokens, setMultimodalMaxTokens] = useState('');
  const [multimodalFrequencyPenalty, setMultimodalFrequencyPenalty] = useState('');
  const [multimodalPresencePenalty, setMultimodalPresencePenalty] = useState('');
  const [multimodalPdfToImages, setMultimodalPdfToImages] = useState(false);

  const [systemSettings, setSystemSettings] = useState<OcrSystemProviderSettings | null>(null);
  const [systemLoading, setSystemLoading] = useState(false);
  const [systemSaving, setSystemSaving] = useState(false);
  const [systemPaddleBaseUrl, setSystemPaddleBaseUrl] = useState('');
  const [systemPaddleApiKey, setSystemPaddleApiKey] = useState('');
  const [systemPaddleVlBaseUrl, setSystemPaddleVlBaseUrl] = useState('');
  const [systemPaddleVlApiKey, setSystemPaddleVlApiKey] = useState('');
  const [systemPaddleVl15BaseUrl, setSystemPaddleVl15BaseUrl] = useState('');
  const [systemPaddleVl15ApiKey, setSystemPaddleVl15ApiKey] = useState('');
  const [systemDatalabBaseUrl, setSystemDatalabBaseUrl] = useState('');
  const [systemDatalabApiKey, setSystemDatalabApiKey] = useState('');
  const [systemMineruBaseUrl, setSystemMineruBaseUrl] = useState('');
  const [systemMineruApiKey, setSystemMineruApiKey] = useState('');
  const [clearSystemPaddleKey, setClearSystemPaddleKey] = useState(false);
  const [clearSystemPaddleVlKey, setClearSystemPaddleVlKey] = useState(false);
  const [clearSystemPaddleVl15Key, setClearSystemPaddleVl15Key] = useState(false);
  const [clearSystemDatalabKey, setClearSystemDatalabKey] = useState(false);
  const [clearSystemMineruKey, setClearSystemMineruKey] = useState(false);
  const [systemEditingProvider, setSystemEditingProvider] = useState<OcrProvider>('paddle');
  const [showSystemProviderConfig, setShowSystemProviderConfig] = useState(false);

  useEffect(() => {
    fetchSettings().catch(() => {});
  }, [fetchSettings]);

  useEffect(() => {
    fetchProvidersAndModels().catch(() => {});
  }, [fetchProvidersAndModels]);

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.provider);
    setProviderEnabled(createProviderEnabledState(settings.providerEnabled, settings.provider, settings.enabled));
    setCredentialSource(settings.credentialSource);
    setBaseUrl(settings.baseUrl || '');
    // Never hydrate stored key back into the input; show last4 as a hint.
    setApiKey('');

    setMineruUserToken(settings.mineru?.userToken || '');
    setMineruModelVersion(settings.mineru?.modelVersion || 'pipeline');
    setMineruIsOcr(settings.mineru?.isOcr ?? true);
    setMineruEnableFormula(settings.mineru?.enableFormula ?? true);
    setMineruEnableTable(settings.mineru?.enableTable ?? true);
    setMineruLanguage(settings.mineru?.language || 'ch');
    const extra = settings.mineru?.extraFormats || [];
    setMineruExtraDocx(extra.includes('docx'));
    setMineruExtraHtml(extra.includes('html'));
    setMineruExtraLatex(extra.includes('latex'));
    setMineruPageRanges(settings.mineru?.pageRanges || '');

    setDatalabMode(settings.datalab?.mode || 'fast');
    setDatalabMaxPages(settings.datalab?.maxPages != null ? String(settings.datalab.maxPages) : '');
    setDatalabPageRange(settings.datalab?.pageRange || '');
    setDatalabPaginate(settings.datalab?.paginate ?? false);
    setDatalabAddBlockIds(settings.datalab?.addBlockIds ?? false);
    setDatalabDisableImageExtraction(settings.datalab?.disableImageExtraction ?? false);
    setDatalabDisableImageCaptions(settings.datalab?.disableImageCaptions ?? false);
    setDatalabOutputFormat(settings.datalab?.outputFormat || '');
    setDatalabSkipCache(settings.datalab?.skipCache ?? false);
    setDatalabSaveCheckpoint(settings.datalab?.saveCheckpoint ?? false);
    setDatalabExtras(settings.datalab?.extras || '');
    setDatalabAdditionalConfig(settings.datalab?.additionalConfig || '');

    setPaddleUseDocOrientationClassify(toTriState(settings.paddle?.useDocOrientationClassify));
    setPaddleUseDocUnwarping(toTriState(settings.paddle?.useDocUnwarping));
    setPaddleUseTextlineOrientation(toTriState(settings.paddle?.useTextlineOrientation));
    setPaddleTextDetLimitSideLen(settings.paddle?.textDetLimitSideLen != null ? String(settings.paddle.textDetLimitSideLen) : '');
    setPaddleTextDetLimitType(settings.paddle?.textDetLimitType || 'default');
    setPaddleTextDetThresh(settings.paddle?.textDetThresh != null ? String(settings.paddle.textDetThresh) : '');
    setPaddleTextDetBoxThresh(settings.paddle?.textDetBoxThresh != null ? String(settings.paddle.textDetBoxThresh) : '');
    setPaddleTextDetUnclipRatio(settings.paddle?.textDetUnclipRatio != null ? String(settings.paddle.textDetUnclipRatio) : '');
    setPaddleTextRecScoreThresh(settings.paddle?.textRecScoreThresh != null ? String(settings.paddle.textRecScoreThresh) : '');
    setPaddleVisualize(toTriState(settings.paddle?.visualize));

    setPaddleVlUseDocOrientationClassify(toTriState(settings.paddle_vl?.useDocOrientationClassify));
    setPaddleVlUseDocUnwarping(toTriState(settings.paddle_vl?.useDocUnwarping));
    setPaddleVlUseLayoutDetection(toTriState(settings.paddle_vl?.useLayoutDetection));
    setPaddleVlUseChartRecognition(toTriState(settings.paddle_vl?.useChartRecognition));
    setPaddleVlLayoutThreshold(settings.paddle_vl?.layoutThreshold != null ? String(settings.paddle_vl.layoutThreshold) : '');
    setPaddleVlLayoutNms(toTriState(settings.paddle_vl?.layoutNms));
    setPaddleVlLayoutUnclipRatio(settings.paddle_vl?.layoutUnclipRatio != null ? String(settings.paddle_vl.layoutUnclipRatio) : '');
    setPaddleVlLayoutMergeBboxesMode(settings.paddle_vl?.layoutMergeBboxesMode || 'default');
    setPaddleVlPromptLabel(settings.paddle_vl?.promptLabel || '');
    setPaddleVlRepetitionPenalty(settings.paddle_vl?.repetitionPenalty != null ? String(settings.paddle_vl.repetitionPenalty) : '');
    setPaddleVlTemperature(settings.paddle_vl?.temperature != null ? String(settings.paddle_vl.temperature) : '');
    setPaddleVlTopP(settings.paddle_vl?.topP != null ? String(settings.paddle_vl.topP) : '');
    setPaddleVlMinPixels(settings.paddle_vl?.minPixels != null ? String(settings.paddle_vl.minPixels) : '');
    setPaddleVlMaxPixels(settings.paddle_vl?.maxPixels != null ? String(settings.paddle_vl.maxPixels) : '');
    setPaddleVlShowFormulaNumber(toTriState(settings.paddle_vl?.showFormulaNumber));
    setPaddleVlPrettifyMarkdown(toTriState(settings.paddle_vl?.prettifyMarkdown));
    setPaddleVlVisualize(toTriState(settings.paddle_vl?.visualize));

    setMultimodalModelId(settings.multimodal?.modelId || '');
    setMultimodalPrompt(settings.multimodal?.prompt || '');
    setMultimodalTemperature(settings.multimodal?.temperature != null ? String(settings.multimodal.temperature) : '0');
    setMultimodalTopP(settings.multimodal?.topP != null ? String(settings.multimodal.topP) : '');
    setMultimodalMaxTokens(settings.multimodal?.maxTokens != null ? String(settings.multimodal.maxTokens) : '');
    setMultimodalFrequencyPenalty(settings.multimodal?.frequencyPenalty != null ? String(settings.multimodal.frequencyPenalty) : '');
    setMultimodalPresencePenalty(settings.multimodal?.presencePenalty != null ? String(settings.multimodal.presencePenalty) : '');
    setMultimodalPdfToImages(settings.multimodal?.pdfToImages ?? false);
  }, [settings]);

  useEffect(() => {
    if (!SYSTEM_OCR_PROVIDER_CONFIG_VISIBLE || !isAdmin) return;
    setSystemLoading(true);
    ocrApi.getSystemSettings()
      .then((s) => {
        setSystemSettings(s);
        setSystemPaddleBaseUrl(s.paddle.baseUrl || '');
        setSystemPaddleVlBaseUrl(s.paddle_vl.baseUrl || '');
        setSystemPaddleVl15BaseUrl(s.paddle_vl_1_5.baseUrl || '');
        setSystemDatalabBaseUrl(s.datalab.baseUrl || '');
        setSystemMineruBaseUrl(s.mineru.baseUrl || '');
      })
      .catch((e) => {
        showToast('error', e instanceof Error ? e.message : t('loadFailed'));
      })
      .finally(() => setSystemLoading(false));
  }, [isAdmin, showToast, t]);

  const enabled = providerEnabled[provider] ?? false;
  const isMultimodalProvider = provider === 'multimodal_model';

  useEffect(() => {
    if (!SYSTEM_OCR_PROVIDER_CONFIG_VISIBLE || provider === 'multimodal_model') {
      setShowSystemProviderConfig(false);
    }
    setSystemEditingProvider(provider === 'multimodal_model' ? 'paddle' : provider);
  }, [provider]);

  const filteredOcrProviders = useMemo(() => {
    const query = providerQuery.trim().toLowerCase();
    if (!query) return OCR_PROVIDER_ITEMS;
    return OCR_PROVIDER_ITEMS.filter((item) => providerLabel(item, t).toLowerCase().includes(query));
  }, [providerQuery, t]);

  const enabledProviderIds = useMemo(
    () => new Set(providers.filter((item) => item.enabled).map((item) => item.id)),
    [providers]
  );
  const multimodalModels = useMemo(
    () =>
      models
        .filter((item) => item.supportsVision && enabledProviderIds.has(item.providerId))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [enabledProviderIds, models]
  );
  const selectedMultimodalModel = useMemo(
    () => multimodalModels.find((item) => item.id === multimodalModelId) ?? null,
    [multimodalModelId, multimodalModels]
  );

  const effectiveBaseUrl = useMemo(() => {
    if (!settings) return baseUrl || '';
    if (credentialSource === 'custom') return baseUrl || '';
    const sys = settings.systemDefaults[provider];
    return sys.baseUrl || '';
  }, [settings, credentialSource, provider, baseUrl]);

  const apiKeyHint = useMemo(() => {
    if (!settings) return '';
    if (credentialSource !== 'custom') return '';
    if (!settings.hasApiKey || !settings.apiKeyLast4) return '';
    return t('apiKeyLast4', { last4: settings.apiKeyLast4 });
  }, [settings, credentialSource, t]);

  const booleanOptions = [
    { value: 'default', label: t('optionDefault') },
    { value: 'true', label: t('optionEnable') },
    { value: 'false', label: t('optionDisable') },
  ];
  const defaultValueHint = (value: string) => t('defaultValue', { value });
  const withDefaultHint = (hint: string, value: string) => `${hint} ${defaultValueHint(value)}`;

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: UpdateOcrProviderSettingsDto = {
        enabled,
        providerEnabled,
        provider,
        credentialSource,
      };

      const datalabMaxPagesValue = toOptionalNumber(datalabMaxPages);
      payload.datalab = {
        mode: datalabMode,
        maxPages: datalabMaxPagesValue != null ? Math.trunc(datalabMaxPagesValue) : null,
        pageRange: datalabPageRange.trim() ? datalabPageRange.trim() : null,
        paginate: datalabPaginate,
        addBlockIds: datalabAddBlockIds,
        disableImageExtraction: datalabDisableImageExtraction,
        disableImageCaptions: datalabDisableImageCaptions,
        outputFormat: datalabOutputFormat.trim() ? datalabOutputFormat.trim() : null,
        skipCache: datalabSkipCache,
        saveCheckpoint: datalabSaveCheckpoint,
        extras: datalabExtras.trim() ? datalabExtras.trim() : null,
        additionalConfig: datalabAdditionalConfig.trim() ? datalabAdditionalConfig.trim() : null,
      };

      payload.paddle = {
        useDocOrientationClassify: fromTriState(paddleUseDocOrientationClassify),
        useDocUnwarping: fromTriState(paddleUseDocUnwarping),
        useTextlineOrientation: fromTriState(paddleUseTextlineOrientation),
        textDetLimitSideLen: toOptionalNumber(paddleTextDetLimitSideLen),
        textDetLimitType: paddleTextDetLimitType === 'min' || paddleTextDetLimitType === 'max' ? paddleTextDetLimitType : null,
        textDetThresh: toOptionalNumber(paddleTextDetThresh),
        textDetBoxThresh: toOptionalNumber(paddleTextDetBoxThresh),
        textDetUnclipRatio: toOptionalNumber(paddleTextDetUnclipRatio),
        textRecScoreThresh: toOptionalNumber(paddleTextRecScoreThresh),
        visualize: fromTriState(paddleVisualize),
      };

      payload.paddle_vl = {
        useDocOrientationClassify: fromTriState(paddleVlUseDocOrientationClassify),
        useDocUnwarping: fromTriState(paddleVlUseDocUnwarping),
        useLayoutDetection: fromTriState(paddleVlUseLayoutDetection),
        useChartRecognition: fromTriState(paddleVlUseChartRecognition),
        layoutThreshold: toOptionalNumber(paddleVlLayoutThreshold),
        layoutNms: fromTriState(paddleVlLayoutNms),
        layoutUnclipRatio: toOptionalNumber(paddleVlLayoutUnclipRatio),
        layoutMergeBboxesMode: paddleVlLayoutMergeBboxesMode === 'large' || paddleVlLayoutMergeBboxesMode === 'small' || paddleVlLayoutMergeBboxesMode === 'union'
          ? paddleVlLayoutMergeBboxesMode
          : null,
        promptLabel: paddleVlPromptLabel.trim() ? paddleVlPromptLabel.trim() : null,
        repetitionPenalty: toOptionalNumber(paddleVlRepetitionPenalty),
        temperature: toOptionalNumber(paddleVlTemperature),
        topP: toOptionalNumber(paddleVlTopP),
        minPixels: toOptionalNumber(paddleVlMinPixels),
        maxPixels: toOptionalNumber(paddleVlMaxPixels),
        showFormulaNumber: fromTriState(paddleVlShowFormulaNumber),
        prettifyMarkdown: fromTriState(paddleVlPrettifyMarkdown),
        visualize: fromTriState(paddleVlVisualize),
      };

      const mineruExtraFormats: string[] = [];
      if (mineruExtraDocx) mineruExtraFormats.push('docx');
      if (mineruExtraHtml) mineruExtraFormats.push('html');
      if (mineruExtraLatex) mineruExtraFormats.push('latex');

      payload.mineru = {
        userToken: mineruUserToken.trim() ? mineruUserToken.trim() : null,
        modelVersion: mineruModelVersion,
        isOcr: mineruIsOcr,
        enableFormula: mineruEnableFormula,
        enableTable: mineruEnableTable,
        language: mineruLanguage.trim() || 'ch',
        extraFormats: mineruExtraFormats,
        pageRanges: mineruPageRanges.trim() ? mineruPageRanges.trim() : null,
      };

      payload.multimodal = {
        modelId: multimodalModelId || null,
        prompt: multimodalPrompt.trim() ? multimodalPrompt.trim() : null,
        temperature: toOptionalNumber(multimodalTemperature),
        topP: toOptionalNumber(multimodalTopP),
        maxTokens: toOptionalNumber(multimodalMaxTokens),
        frequencyPenalty: toOptionalNumber(multimodalFrequencyPenalty),
        presencePenalty: toOptionalNumber(multimodalPresencePenalty),
        pdfToImages: multimodalPdfToImages,
      };

      if (!isMultimodalProvider && credentialSource === 'custom') {
        payload.baseUrl = baseUrl || null;
        const trimmed = apiKey.trim();
        if (trimmed) payload.apiKey = trimmed;
      }

      await saveSettings(payload);
      showToast('success', t('settingsSaved'));
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : t('saveConfigFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSystem = async () => {
    setSystemSaving(true);
    try {
      const payload: UpdateOcrSystemProviderSettingsDto = {
        paddle: {
          baseUrl: systemPaddleBaseUrl || null,
          ...(clearSystemPaddleKey ? { apiKey: null } : (systemPaddleApiKey.trim() ? { apiKey: systemPaddleApiKey.trim() } : {})),
        },
        paddle_vl: {
          baseUrl: systemPaddleVlBaseUrl || null,
          ...(clearSystemPaddleVlKey ? { apiKey: null } : (systemPaddleVlApiKey.trim() ? { apiKey: systemPaddleVlApiKey.trim() } : {})),
        },
        paddle_vl_1_5: {
          baseUrl: systemPaddleVl15BaseUrl || null,
          ...(clearSystemPaddleVl15Key ? { apiKey: null } : (systemPaddleVl15ApiKey.trim() ? { apiKey: systemPaddleVl15ApiKey.trim() } : {})),
        },
        datalab: {
          baseUrl: systemDatalabBaseUrl || null,
          ...(clearSystemDatalabKey ? { apiKey: null } : (systemDatalabApiKey.trim() ? { apiKey: systemDatalabApiKey.trim() } : {})),
        },
        mineru: {
          baseUrl: systemMineruBaseUrl || null,
          ...(clearSystemMineruKey ? { apiKey: null } : (systemMineruApiKey.trim() ? { apiKey: systemMineruApiKey.trim() } : {})),
        },
      };

      const next = await ocrApi.updateSystemSettings(payload);
      setSystemSettings(next);
      setSystemPaddleBaseUrl(next.paddle.baseUrl || '');
      setSystemPaddleVlBaseUrl(next.paddle_vl.baseUrl || '');
      setSystemPaddleVl15BaseUrl(next.paddle_vl_1_5.baseUrl || '');
      setSystemDatalabBaseUrl(next.datalab.baseUrl || '');
      setSystemMineruBaseUrl(next.mineru.baseUrl || '');
      setSystemPaddleApiKey('');
      setSystemPaddleVlApiKey('');
      setSystemPaddleVl15ApiKey('');
      setSystemDatalabApiKey('');
      setSystemMineruApiKey('');
      setClearSystemPaddleKey(false);
      setClearSystemPaddleVlKey(false);
      setClearSystemPaddleVl15Key(false);
      setClearSystemDatalabKey(false);
      setClearSystemMineruKey(false);

      // Refresh user-visible systemDefaults / effective config
      fetchSettings(true).catch(() => {});
      showToast('success', t('settingsSaved'));
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : t('saveConfigFailed'));
    } finally {
      setSystemSaving(false);
    }
  };

  const systemProviderItems: OcrProvider[] = SYSTEM_OCR_PROVIDER_ITEMS;

  const renderSystemProviderEditor = () => {
    if (systemEditingProvider === 'paddle') {
      return (
        <SystemProviderCard
          title={providerLabel('paddle', t)}
          baseUrlLabel={`${providerLabel('paddle', t)} ${t('baseUrl')}`}
          baseUrlPlaceholder={t('baseUrlPlaceholder')}
          baseUrl={systemPaddleBaseUrl}
          onBaseUrlChange={setSystemPaddleBaseUrl}
          apiKeyLabel={`${providerLabel('paddle', t)} ${t('apiKey')}`}
          apiKey={systemPaddleApiKey}
          onApiKeyChange={setSystemPaddleApiKey}
          apiKeyPlaceholder={
            systemSettings?.paddle?.hasApiKey && systemSettings.paddle.apiKeyLast4
              ? t('apiKeyLast4', { last4: systemSettings.paddle.apiKeyLast4 })
              : t('apiKeyPlaceholder')
          }
          clearMarked={clearSystemPaddleKey}
          onClear={() => {
            setClearSystemPaddleKey(true);
            setSystemPaddleApiKey('');
          }}
          clearText={tCommon('clear')}
          clearHint={t('apiKeyWillBeCleared')}
        />
      );
    }

    if (systemEditingProvider === 'paddle_vl') {
      return (
        <SystemProviderCard
          title={providerLabel('paddle_vl', t)}
          baseUrlLabel={`${providerLabel('paddle_vl', t)} ${t('baseUrl')}`}
          baseUrlPlaceholder={t('baseUrlPlaceholder')}
          baseUrl={systemPaddleVlBaseUrl}
          onBaseUrlChange={setSystemPaddleVlBaseUrl}
          apiKeyLabel={`${providerLabel('paddle_vl', t)} ${t('apiKey')}`}
          apiKey={systemPaddleVlApiKey}
          onApiKeyChange={setSystemPaddleVlApiKey}
          apiKeyPlaceholder={
            systemSettings?.paddle_vl?.hasApiKey && systemSettings.paddle_vl.apiKeyLast4
              ? t('apiKeyLast4', { last4: systemSettings.paddle_vl.apiKeyLast4 })
              : t('apiKeyPlaceholder')
          }
          clearMarked={clearSystemPaddleVlKey}
          onClear={() => {
            setClearSystemPaddleVlKey(true);
            setSystemPaddleVlApiKey('');
          }}
          clearText={tCommon('clear')}
          clearHint={t('apiKeyWillBeCleared')}
        />
      );
    }

    if (systemEditingProvider === 'paddle_vl_1_5') {
      return (
        <SystemProviderCard
          title={providerLabel('paddle_vl_1_5', t)}
          baseUrlLabel={`${providerLabel('paddle_vl_1_5', t)} ${t('baseUrl')}`}
          baseUrlPlaceholder={t('baseUrlPlaceholder')}
          baseUrl={systemPaddleVl15BaseUrl}
          onBaseUrlChange={setSystemPaddleVl15BaseUrl}
          apiKeyLabel={`${providerLabel('paddle_vl_1_5', t)} ${t('apiKey')}`}
          apiKey={systemPaddleVl15ApiKey}
          onApiKeyChange={setSystemPaddleVl15ApiKey}
          apiKeyPlaceholder={
            systemSettings?.paddle_vl_1_5?.hasApiKey && systemSettings.paddle_vl_1_5.apiKeyLast4
              ? t('apiKeyLast4', { last4: systemSettings.paddle_vl_1_5.apiKeyLast4 })
              : t('apiKeyPlaceholder')
          }
          clearMarked={clearSystemPaddleVl15Key}
          onClear={() => {
            setClearSystemPaddleVl15Key(true);
            setSystemPaddleVl15ApiKey('');
          }}
          clearText={tCommon('clear')}
          clearHint={t('apiKeyWillBeCleared')}
        />
      );
    }

    if (systemEditingProvider === 'datalab') {
      return (
        <SystemProviderCard
          title={providerLabel('datalab', t)}
          baseUrlLabel={`${providerLabel('datalab', t)} ${t('baseUrl')}`}
          baseUrlPlaceholder={t('baseUrlPlaceholder')}
          baseUrl={systemDatalabBaseUrl}
          onBaseUrlChange={setSystemDatalabBaseUrl}
          apiKeyLabel={`${providerLabel('datalab', t)} ${t('apiKey')}`}
          apiKey={systemDatalabApiKey}
          onApiKeyChange={setSystemDatalabApiKey}
          apiKeyPlaceholder={
            systemSettings?.datalab?.hasApiKey && systemSettings.datalab.apiKeyLast4
              ? t('apiKeyLast4', { last4: systemSettings.datalab.apiKeyLast4 })
              : t('apiKeyPlaceholder')
          }
          clearMarked={clearSystemDatalabKey}
          onClear={() => {
            setClearSystemDatalabKey(true);
            setSystemDatalabApiKey('');
          }}
          clearText={tCommon('clear')}
          clearHint={t('apiKeyWillBeCleared')}
        />
      );
    }

    return (
      <SystemProviderCard
        title={providerLabel('mineru', t)}
        baseUrlLabel={`${providerLabel('mineru', t)} ${t('baseUrl')}`}
        baseUrlPlaceholder={t('baseUrlPlaceholder')}
        baseUrl={systemMineruBaseUrl}
        onBaseUrlChange={setSystemMineruBaseUrl}
        apiKeyLabel={`${providerLabel('mineru', t)} ${t('apiKey')}`}
        apiKey={systemMineruApiKey}
        onApiKeyChange={setSystemMineruApiKey}
        apiKeyPlaceholder={
          systemSettings?.mineru?.hasApiKey && systemSettings.mineru.apiKeyLast4
            ? t('apiKeyLast4', { last4: systemSettings.mineru.apiKeyLast4 })
            : t('apiKeyPlaceholder')
        }
        clearMarked={clearSystemMineruKey}
        onClear={() => {
          setClearSystemMineruKey(true);
          setSystemMineruApiKey('');
        }}
        clearText={tCommon('clear')}
        clearHint={t('apiKeyWillBeCleared')}
      />
    );
  };

  return (
    <>
      <div className="flex-1 flex overflow-hidden">
          <div className="w-64 bg-slate-900/50 light:bg-white border-r border-slate-700 light:border-slate-200 flex flex-col">
            <div className="p-4 border-b border-slate-700 light:border-slate-200">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-300 light:text-slate-700 flex-1 min-w-0 whitespace-nowrap">
                  {t('ocrProvider')}
                </h2>
                <div className="relative w-32">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 light:text-slate-400" />
                  <input
                    type="text"
                    value={providerQuery}
                    onChange={(e) => setProviderQuery(e.target.value)}
                    placeholder={t('searchProviders')}
                    aria-label={t('searchProviders')}
                    className="w-full pl-7 pr-2 py-1.5 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-md text-xs text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredOcrProviders.map((item) => {
                const selected = provider === item;
                const itemEnabled = providerEnabled[item] ?? false;
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setProvider(item)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                      selected
                        ? 'bg-slate-800 light:bg-cyan-50 border border-slate-600 light:border-cyan-200 text-slate-100 light:text-slate-900'
                        : 'text-slate-300 light:text-slate-700 hover:bg-slate-800/50 light:hover:bg-slate-100'
                    }`}
                  >
                    <span className="truncate">{providerLabel(item, t)}</span>
                    <span className={`w-2 h-2 rounded-full ${itemEnabled ? 'bg-emerald-500' : 'bg-slate-600 light:bg-slate-400'}`} />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            <div className="w-full h-full max-w-5xl mx-auto p-6 flex flex-col gap-6 overflow-hidden">
              <div className="rounded-xl border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-white p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold text-white light:text-slate-900">{t('fileOcrSettingsTitle')}</h2>
                  <div className="flex items-center gap-3">
                    <span className="px-2 py-1 rounded-md bg-slate-800 light:bg-slate-100 border border-slate-700 light:border-slate-300 text-xs text-slate-300 light:text-slate-700">
                      {providerLabel(provider, t)}
                    </span>
                    {!isMultimodalProvider && (
                      <span className="px-2 py-1 rounded-md bg-slate-800 light:bg-slate-100 border border-slate-700 light:border-slate-300 text-xs text-slate-400 light:text-slate-600">
                        {credentialLabel(credentialSource, t)}
                      </span>
                    )}
                    <Toggle enabled={enabled} onChange={(value) => setProviderEnabled((prev) => ({ ...prev, [provider]: value }))} label={t('enable')} />
                  </div>
                </div>

                <p className="text-xs text-slate-500 light:text-slate-600">{t('enableFileOcrHint')}</p>

                {isLoading && (
                  <div className="flex items-center gap-2 text-sm text-slate-400 light:text-slate-600">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('loading')}
                  </div>
                )}

                {isMultimodalProvider ? (
                  <div className="rounded-lg border border-cyan-900/60 light:border-cyan-200 bg-cyan-950/30 light:bg-cyan-50/80 p-4 text-sm text-slate-300 light:text-slate-700">
                    {t('multimodalModelUsesConfiguredLlm')}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-1">
                        {t('credentialSource')}
                      </label>
                      <select
                        value={credentialSource}
                        onChange={(e) => setCredentialSource(e.target.value as OcrCredentialSource)}
                        className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                      >
                        <option value="system">{t('credentialSystem')}</option>
                        <option value="custom">{t('credentialCustom')}</option>
                      </select>
                    </div>
                    <Input
                      label={t('baseUrl')}
                      value={effectiveBaseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      disabled={credentialSource === 'system'}
                      placeholder={t('baseUrlPlaceholder')}
                    />
                    <div className="md:col-span-2">
                      <Input
                        label={t('apiKey')}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        disabled={credentialSource === 'system'}
                        placeholder={apiKeyHint || t('apiKeyPlaceholder')}
                        type="password"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-white p-5 flex flex-col gap-4 min-h-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-200 light:text-slate-800">
                    {t('ocrProvider')}: {providerLabel(provider, t)}
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-slate-500 light:text-slate-600">
                      {t('providerParamsTitle', { defaultValue: 'Provider Parameters' })}
                    </p>
                    {SYSTEM_OCR_PROVIDER_CONFIG_VISIBLE && isAdmin && !isMultimodalProvider && (
                      <Button
                        variant="secondary"
                        onClick={() => setShowSystemProviderConfig((prev) => !prev)}
                        title={t('systemOcrProviderConfigTitle')}
                      >
                        {showSystemProviderConfig ? tCommon('collapse') : t('systemOcrProviderConfigTitle')}
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => setTestOpen(true)} disabled={!settings || isLoading}>
                      <FlaskConical className="w-4 h-4 mr-1" />
                      {t('testProvider')}
                    </Button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">

        {provider === 'multimodal_model' && (
          <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white/60 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 light:text-slate-800">
                {t('multimodalModelParamsTitle')}
              </h3>
              <p className="text-xs text-slate-500 light:text-slate-600">
                {t('multimodalModelParamsDesc')}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('multimodalModelId')}
                </label>
                <select
                  value={multimodalModelId}
                  onChange={(e) => setMultimodalModelId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  <option value="">{t('multimodalModelPlaceholder')}</option>
                  {multimodalModels.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 light:text-slate-600">
                  {selectedMultimodalModel
                    ? t('multimodalModelSelectedHint', { model: selectedMultimodalModel.name })
                    : t('multimodalModelUsesConfiguredLlm')}
                </p>
                {multimodalModels.length === 0 && (
                  <p className="text-xs text-amber-400 light:text-amber-700">
                    {t('multimodalModelNoVisionModels')}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('multimodalModelPrompt')}
                </label>
                <textarea
                  value={multimodalPrompt}
                  onChange={(e) => setMultimodalPrompt(e.target.value)}
                  placeholder={t('multimodalModelPromptPlaceholder')}
                  className="w-full min-h-[180px] px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all resize-y"
                />
                <p className="text-xs text-slate-500 light:text-slate-600">
                  {t('multimodalModelPromptHint')}
                </p>
              </div>

              <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-slate-50 px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-slate-200 light:text-slate-800">
                      {t('multimodalPdfToImages')}
                    </p>
                    <p className="text-xs text-slate-500 light:text-slate-600">
                      {t('multimodalPdfToImagesHint')}
                    </p>
                  </div>
                  <Toggle enabled={multimodalPdfToImages} onChange={setMultimodalPdfToImages} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={t('multimodalModelTemperature')}
                value={multimodalTemperature}
                onChange={(e) => setMultimodalTemperature(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
                hint={defaultValueHint('0')}
              />
              <Input
                label={t('multimodalModelTopP')}
                value={multimodalTopP}
                onChange={(e) => setMultimodalTopP(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
                hint={defaultValueHint(t('optionDefault'))}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input
                label={t('multimodalModelMaxTokens')}
                value={multimodalMaxTokens}
                onChange={(e) => setMultimodalMaxTokens(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
                hint={defaultValueHint(t('defaultUnlimited'))}
              />
              <Input
                label={t('multimodalModelFrequencyPenalty')}
                value={multimodalFrequencyPenalty}
                onChange={(e) => setMultimodalFrequencyPenalty(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
              />
              <Input
                label={t('multimodalModelPresencePenalty')}
                value={multimodalPresencePenalty}
                onChange={(e) => setMultimodalPresencePenalty(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
              />
            </div>
          </div>
        )}

        {provider === 'datalab' && (
          <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white/60 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 light:text-slate-800">
                {t('datalabParamsTitle')}
              </h3>
              <p className="text-xs text-slate-500 light:text-slate-600">
                {t('datalabParamsDesc')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('datalabMode')}
                </label>
                <select
                  value={datalabMode}
                  onChange={(e) => setDatalabMode(e.target.value as DatalabOcrMode)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  <option value="fast">{t('datalabModeFast')}</option>
                  <option value="balanced">{t('datalabModeBalanced')}</option>
                  <option value="accurate">{t('datalabModeAccurate')}</option>
                </select>
                <p className="text-xs text-slate-500 light:text-slate-600">
                  {defaultValueHint(t('datalabModeFast'))}
                </p>
              </div>
              <Input
                label={t('datalabOutputFormat')}
                value={datalabOutputFormat}
                onChange={(e) => setDatalabOutputFormat(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                hint={withDefaultHint(t('datalabOutputFormatHint'), t('defaultAuto'))}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={t('datalabMaxPages')}
                value={datalabMaxPages}
                onChange={(e) => setDatalabMaxPages(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                hint={defaultValueHint(t('defaultUnlimited'))}
                type="number"
              />
              <Input
                label={t('datalabPageRange')}
                value={datalabPageRange}
                onChange={(e) => setDatalabPageRange(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                hint={defaultValueHint(t('defaultAllPages'))}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              <Toggle checked={datalabPaginate} onChange={setDatalabPaginate} label={t('datalabPaginate')} />
              <Toggle checked={datalabAddBlockIds} onChange={setDatalabAddBlockIds} label={t('datalabAddBlockIds')} />
              <Toggle checked={datalabDisableImageExtraction} onChange={setDatalabDisableImageExtraction} label={t('datalabDisableImageExtraction')} />
              <Toggle checked={datalabDisableImageCaptions} onChange={setDatalabDisableImageCaptions} label={t('datalabDisableImageCaptions')} />
              <Toggle checked={datalabSkipCache} onChange={setDatalabSkipCache} label={t('datalabSkipCache')} />
              <Toggle checked={datalabSaveCheckpoint} onChange={setDatalabSaveCheckpoint} label={t('datalabSaveCheckpoint')} />
            </div>
            <p className="text-xs text-slate-500 light:text-slate-600">
              {t('datalabToggleDefaults')}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={t('datalabExtras')}
                value={datalabExtras}
                onChange={(e) => setDatalabExtras(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                hint={withDefaultHint(t('datalabExtrasHint'), t('defaultNone'))}
              />
              <Input
                label={t('datalabAdditionalConfig')}
                value={datalabAdditionalConfig}
                onChange={(e) => setDatalabAdditionalConfig(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                hint={withDefaultHint(t('datalabAdditionalConfigHint'), t('defaultNone'))}
              />
            </div>
          </div>
        )}

        {provider === 'paddle' && (
          <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white/60 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 light:text-slate-800">
                {t('paddleParamsTitle')}
              </h3>
              <p className="text-xs text-slate-500 light:text-slate-600">
                {t('paddleParamsDesc')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('paddleUseDocOrientationClassify')}
                </label>
                <select
                  value={paddleUseDocOrientationClassify}
                  onChange={(e) => setPaddleUseDocOrientationClassify(e.target.value as TriStateBoolean)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  {booleanOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('paddleUseDocUnwarping')}
                </label>
                <select
                  value={paddleUseDocUnwarping}
                  onChange={(e) => setPaddleUseDocUnwarping(e.target.value as TriStateBoolean)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  {booleanOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('paddleUseTextlineOrientation')}
                </label>
                <select
                  value={paddleUseTextlineOrientation}
                  onChange={(e) => setPaddleUseTextlineOrientation(e.target.value as TriStateBoolean)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  {booleanOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('paddleVisualize')}
                </label>
                <select
                  value={paddleVisualize}
                  onChange={(e) => setPaddleVisualize(e.target.value as TriStateBoolean)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  {booleanOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={t('paddleTextDetLimitSideLen')}
                value={paddleTextDetLimitSideLen}
                onChange={(e) => setPaddleTextDetLimitSideLen(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
              />
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('paddleTextDetLimitType')}
                </label>
                <select
                  value={paddleTextDetLimitType}
                  onChange={(e) => setPaddleTextDetLimitType(e.target.value as 'default' | 'min' | 'max')}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  <option value="default">{t('optionDefault')}</option>
                  <option value="min">min</option>
                  <option value="max">max</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={t('paddleTextDetThresh')}
                value={paddleTextDetThresh}
                onChange={(e) => setPaddleTextDetThresh(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
              />
              <Input
                label={t('paddleTextDetBoxThresh')}
                value={paddleTextDetBoxThresh}
                onChange={(e) => setPaddleTextDetBoxThresh(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={t('paddleTextDetUnclipRatio')}
                value={paddleTextDetUnclipRatio}
                onChange={(e) => setPaddleTextDetUnclipRatio(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
              />
              <Input
                label={t('paddleTextRecScoreThresh')}
                value={paddleTextRecScoreThresh}
                onChange={(e) => setPaddleTextRecScoreThresh(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
              />
            </div>
          </div>
        )}

        {(provider === 'paddle_vl' || provider === 'paddle_vl_1_5') && (
          <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white/60 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 light:text-slate-800">
                {t('paddleVlParamsTitle')}
              </h3>
              <p className="text-xs text-slate-500 light:text-slate-600">
                {t('paddleVlParamsDesc')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('paddleVlUseDocOrientationClassify')}
                </label>
                <select
                  value={paddleVlUseDocOrientationClassify}
                  onChange={(e) => setPaddleVlUseDocOrientationClassify(e.target.value as TriStateBoolean)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  {booleanOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('paddleVlUseDocUnwarping')}
                </label>
                <select
                  value={paddleVlUseDocUnwarping}
                  onChange={(e) => setPaddleVlUseDocUnwarping(e.target.value as TriStateBoolean)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  {booleanOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('paddleVlUseLayoutDetection')}
                </label>
                <select
                  value={paddleVlUseLayoutDetection}
                  onChange={(e) => setPaddleVlUseLayoutDetection(e.target.value as TriStateBoolean)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  {booleanOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('paddleVlUseChartRecognition')}
                </label>
                <select
                  value={paddleVlUseChartRecognition}
                  onChange={(e) => setPaddleVlUseChartRecognition(e.target.value as TriStateBoolean)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  {booleanOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('paddleVlLayoutNms')}
                </label>
                <select
                  value={paddleVlLayoutNms}
                  onChange={(e) => setPaddleVlLayoutNms(e.target.value as TriStateBoolean)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  {booleanOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('paddleVlShowFormulaNumber')}
                </label>
                <select
                  value={paddleVlShowFormulaNumber}
                  onChange={(e) => setPaddleVlShowFormulaNumber(e.target.value as TriStateBoolean)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  {booleanOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('paddleVlPrettifyMarkdown')}
                </label>
                <select
                  value={paddleVlPrettifyMarkdown}
                  onChange={(e) => setPaddleVlPrettifyMarkdown(e.target.value as TriStateBoolean)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  {booleanOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('paddleVlVisualize')}
                </label>
                <select
                  value={paddleVlVisualize}
                  onChange={(e) => setPaddleVlVisualize(e.target.value as TriStateBoolean)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  {booleanOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={t('paddleVlLayoutThreshold')}
                value={paddleVlLayoutThreshold}
                onChange={(e) => setPaddleVlLayoutThreshold(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
              />
              <Input
                label={t('paddleVlLayoutUnclipRatio')}
                value={paddleVlLayoutUnclipRatio}
                onChange={(e) => setPaddleVlLayoutUnclipRatio(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('paddleVlLayoutMergeBboxesMode')}
                </label>
                <select
                  value={paddleVlLayoutMergeBboxesMode}
                  onChange={(e) => setPaddleVlLayoutMergeBboxesMode(e.target.value as 'default' | 'large' | 'small' | 'union')}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  <option value="default">{t('optionDefault')}</option>
                  <option value="large">large</option>
                  <option value="small">small</option>
                  <option value="union">union</option>
                </select>
              </div>
              <Input
                label={t('paddleVlPromptLabel')}
                value={paddleVlPromptLabel}
                onChange={(e) => setPaddleVlPromptLabel(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={t('paddleVlRepetitionPenalty')}
                value={paddleVlRepetitionPenalty}
                onChange={(e) => setPaddleVlRepetitionPenalty(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
              />
              <Input
                label={t('paddleVlTemperature')}
                value={paddleVlTemperature}
                onChange={(e) => setPaddleVlTemperature(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={t('paddleVlTopP')}
                value={paddleVlTopP}
                onChange={(e) => setPaddleVlTopP(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
              />
              <Input
                label={t('paddleVlMinPixels')}
                value={paddleVlMinPixels}
                onChange={(e) => setPaddleVlMinPixels(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={t('paddleVlMaxPixels')}
                value={paddleVlMaxPixels}
                onChange={(e) => setPaddleVlMaxPixels(e.target.value)}
                placeholder={t('paramOptionalPlaceholder')}
                type="number"
              />
            </div>
          </div>
        )}

        {provider === 'mineru' && (
          <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white/60 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 light:text-slate-800">
                {t('mineruParamsTitle')}
              </h3>
              <p className="text-xs text-slate-500 light:text-slate-600">
                {t('mineruParamsDesc')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={t('mineruUserToken')}
                value={mineruUserToken}
                onChange={(e) => setMineruUserToken(e.target.value)}
                placeholder={t('mineruUserTokenPlaceholder')}
              />

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('mineruModelVersion')}
                </label>
                <select
                  value={mineruModelVersion}
                  onChange={(e) => setMineruModelVersion(e.target.value as MineruModelVersion)}
                  className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                >
                  <option value="pipeline">{t('mineruModelPipeline')}</option>
                  <option value="vlm">{t('mineruModelVlm')}</option>
                </select>
                <p className="text-xs text-slate-500 light:text-slate-600">
                  {defaultValueHint(t('mineruModelPipeline'))}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              <Toggle checked={mineruIsOcr} onChange={setMineruIsOcr} label={t('mineruIsOcr')} />
              <Toggle checked={mineruEnableFormula} onChange={setMineruEnableFormula} label={t('mineruEnableFormula')} />
              <Toggle checked={mineruEnableTable} onChange={setMineruEnableTable} label={t('mineruEnableTable')} />
            </div>
            <p className="text-xs text-slate-500 light:text-slate-600">
              {t('mineruToggleDefaults')}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={t('mineruLanguage')}
                value={mineruLanguage}
                onChange={(e) => setMineruLanguage(e.target.value)}
                placeholder="ch"
                hint={defaultValueHint('ch')}
              />
              <Input
                label={t('mineruPageRanges')}
                value={mineruPageRanges}
                onChange={(e) => setMineruPageRanges(e.target.value)}
                placeholder={t('mineruPageRangesPlaceholder')}
                hint={withDefaultHint(t('mineruPageRangesHint'), t('defaultAllPages'))}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                {t('mineruExtraFormats')}
              </label>
              <div className="flex items-center gap-4 text-sm text-slate-300 light:text-slate-700">
                <label className="inline-flex items-center gap-2">
                  <Checkbox
                    checked={mineruExtraDocx}
                    onChange={(e) => setMineruExtraDocx(e.target.checked)}
                  />
                  docx
                </label>
                <label className="inline-flex items-center gap-2">
                  <Checkbox
                    checked={mineruExtraHtml}
                    onChange={(e) => setMineruExtraHtml(e.target.checked)}
                  />
                  html
                </label>
                <label className="inline-flex items-center gap-2">
                  <Checkbox
                    checked={mineruExtraLatex}
                    onChange={(e) => setMineruExtraLatex(e.target.checked)}
                  />
                  latex
                </label>
              </div>
              <p className="text-xs text-slate-500 light:text-slate-600">
                {withDefaultHint(t('mineruExtraFormatsHint'), t('defaultNone'))}
              </p>
            </div>
          </div>
        )}

        {SYSTEM_OCR_PROVIDER_CONFIG_VISIBLE && isAdmin && !isMultimodalProvider && showSystemProviderConfig && (
          <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white/60 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 light:text-slate-800">
                {t('systemOcrProviderConfigTitle')}
              </h3>
              <p className="text-xs text-slate-500 light:text-slate-600">
                {t('systemOcrProviderConfigDesc')}
              </p>
            </div>

            {systemLoading && (
              <div className="flex items-center gap-2 text-sm text-slate-400 light:text-slate-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('loading')}
              </div>
            )}

            <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white/60 overflow-hidden">
              <div className="flex flex-col lg:flex-row min-h-[320px]">
                <div className="w-full lg:w-64 lg:border-r border-slate-700 light:border-slate-200 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 light:text-slate-600 mb-2">
                    {t('ocrProvider')}
                  </p>
                  <div className="space-y-1">
                    {systemProviderItems.map((item) => {
                      const selected = systemEditingProvider === item;
                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setSystemEditingProvider(item)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                            selected
                              ? 'bg-slate-800 light:bg-cyan-50 border border-slate-600 light:border-cyan-200 text-slate-100 light:text-slate-900'
                              : 'text-slate-300 light:text-slate-700 hover:bg-slate-800/50 light:hover:bg-slate-100 border border-transparent'
                          }`}
                        >
                          <span className="truncate">{providerLabel(item, t)}</span>
                          <span className={`w-2 h-2 rounded-full ${selected ? 'bg-cyan-500' : 'bg-slate-600 light:bg-slate-400'}`} />
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex-1 p-4">
                  {renderSystemProviderEditor()}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-700 light:border-slate-200 flex justify-end">
              <Button variant="primary" onClick={handleSaveSystem} loading={systemSaving} disabled={systemLoading}>
                <Save className="w-4 h-4 mr-1" />
                {t('saveSettings')}
              </Button>
            </div>
          </div>
        )}
                </div>

        <div className="pt-3 border-t border-slate-700 light:border-slate-200 flex justify-end">
          <Button variant="primary" onClick={handleSave} loading={saving}>
            <Save className="w-4 h-4 mr-1" />
            {t('saveSettings')}
          </Button>
        </div>
                </div>
            </div>
          </div>
      </div>

      <OcrTestModal
        isOpen={testOpen}
        onClose={() => setTestOpen(false)}
        provider={provider}
        credentialSource={credentialSource}
        baseUrl={baseUrl}
        apiKey={apiKey}
        multimodalModelId={multimodalModelId}
        multimodalPrompt={multimodalPrompt}
        multimodalTemperature={multimodalTemperature}
        multimodalTopP={multimodalTopP}
        multimodalMaxTokens={multimodalMaxTokens}
        multimodalFrequencyPenalty={multimodalFrequencyPenalty}
        multimodalPresencePenalty={multimodalPresencePenalty}
        multimodalPdfToImages={multimodalPdfToImages}
        multimodalModelName={selectedMultimodalModel?.name || ''}
        tCommon={tCommon}
      />
    </>
  );
}

function SystemProviderCard({
  title,
  baseUrlLabel,
  baseUrlPlaceholder,
  baseUrl,
  onBaseUrlChange,
  apiKeyLabel,
  apiKey,
  onApiKeyChange,
  apiKeyPlaceholder,
  clearMarked,
  onClear,
  clearText,
  clearHint,
}: {
  title: string;
  baseUrlLabel: string;
  baseUrlPlaceholder: string;
  baseUrl: string;
  onBaseUrlChange: (value: string) => void;
  apiKeyLabel: string;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  apiKeyPlaceholder: string;
  clearMarked: boolean;
  onClear: () => void;
  clearText: string;
  clearHint: string;
}) {
  return (
    <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white/60 p-4 space-y-3">
      <h4 className="text-sm font-semibold text-slate-200 light:text-slate-800">{title}</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input
          label={baseUrlLabel}
          value={baseUrl}
          onChange={(e) => onBaseUrlChange(e.target.value)}
          placeholder={baseUrlPlaceholder}
        />
        <Input
          label={apiKeyLabel}
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder={apiKeyPlaceholder}
          type="password"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={onClear}>
          {clearText}
        </Button>
        {clearMarked && (
          <span className="text-xs text-slate-500 light:text-slate-600">{clearHint}</span>
        )}
      </div>
    </div>
  );
}

function OcrTestModal({
  isOpen,
  onClose,
  provider,
  credentialSource,
  baseUrl,
  apiKey,
  multimodalModelId,
  multimodalPrompt,
  multimodalTemperature,
  multimodalTopP,
  multimodalMaxTokens,
  multimodalFrequencyPenalty,
  multimodalPresencePenalty,
  multimodalPdfToImages,
  multimodalModelName,
  tCommon,
}: {
  isOpen: boolean;
  onClose: () => void;
  provider: OcrProvider;
  credentialSource: OcrCredentialSource;
  baseUrl: string;
  apiKey: string;
  multimodalModelId: string;
  multimodalPrompt: string;
  multimodalTemperature: string;
  multimodalTopP: string;
  multimodalMaxTokens: string;
  multimodalFrequencyPenalty: string;
  multimodalPresencePenalty: string;
  multimodalPdfToImages: boolean;
  multimodalModelName: string;
  tCommon: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { t } = useTranslation('settings');
  const { showToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OcrTestResult | null>(null);

  const handleRun = async () => {
    if (!file) {
      showToast('error', t('chooseFileFirst'));
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const override = {
        provider,
        credentialSource,
        ...(provider !== 'multimodal_model' && credentialSource === 'custom'
          ? { baseUrl: baseUrl || null, apiKey: apiKey.trim() || null }
          : {}),
        ...(provider === 'multimodal_model'
          ? {
              multimodal: {
                modelId: multimodalModelId || null,
                prompt: multimodalPrompt.trim() || null,
                temperature: toOptionalNumber(multimodalTemperature),
                topP: toOptionalNumber(multimodalTopP),
                maxTokens: toOptionalNumber(multimodalMaxTokens),
                frequencyPenalty: toOptionalNumber(multimodalFrequencyPenalty),
                presencePenalty: toOptionalNumber(multimodalPresencePenalty),
                pdfToImages: multimodalPdfToImages,
              },
            }
          : {}),
      };
      const r = await ocrApi.test(file, override);
      setResult(r);
      showToast(r.success ? 'success' : 'error', r.success ? t('testSuccess') : (r.error || t('testFailed')));
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : t('testFailed'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setFile(null);
        setResult(null);
        onClose();
      }}
      title={t('testProvider')}
      size="xl"
    >
      <div className="space-y-4">
        <div className="text-sm text-slate-400 light:text-slate-600">
          <div>{t('ocrProvider')}: {providerLabel(provider, t)}</div>
          {provider === 'multimodal_model' ? (
            <>
              <div>{t('multimodalModelId')}: {multimodalModelName || t('multimodalModelPlaceholder')}</div>
              <div>{t('multimodalPdfToImages')}: {multimodalPdfToImages ? tCommon('enabled') : tCommon('disabled')}</div>
            </>
          ) : (
            <div>{t('credentialSource')}: {credentialLabel(credentialSource, t)}</div>
          )}
        </div>

        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-slate-300 light:text-slate-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 light:file:bg-slate-200 light:file:text-slate-800 light:hover:file:bg-slate-300"
        />

        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{tCommon('close')}</Button>
          <Button variant="primary" onClick={handleRun} loading={running}>
            {t('runTest')}
          </Button>
        </div>

        {result && (
          <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/50 light:bg-white p-4 space-y-2">
            <div className="text-sm text-slate-300 light:text-slate-700">
              <span className={result.success ? 'text-green-400 light:text-green-600' : 'text-rose-400 light:text-rose-600'}>
                {result.success ? tCommon('success') : tCommon('error')}
              </span>
              <span className="ml-3 text-slate-500 light:text-slate-600">
                {t('latencyMs', { ms: result.latencyMs })}
              </span>
              {typeof result.pageCount === 'number' && (
                <span className="ml-3 text-slate-500 light:text-slate-600">
                  {t('pages', { count: result.pageCount })}
                </span>
              )}
              {typeof result.charCount === 'number' && (
                <span className="ml-3 text-slate-500 light:text-slate-600">
                  {t('chars', { count: result.charCount })}
                </span>
              )}
            </div>

            {result.error && (
              <div className="text-sm text-rose-300 light:text-rose-700">
                {result.error}
              </div>
            )}

            {result.previewText && (
              <pre className="max-h-64 overflow-auto text-xs text-slate-300 light:text-slate-700 whitespace-pre-wrap font-mono">
                {result.previewText}
              </pre>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
