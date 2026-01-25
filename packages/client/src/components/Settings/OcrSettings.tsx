import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Save, FlaskConical, Loader2 } from 'lucide-react';
import { Button, Input, Modal, Toggle, useToast } from '../ui';
import { useOcrSettingsStore } from '../../store/useOcrSettingsStore';
import { useAuthStore } from '../../store/useAuthStore';
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
  if (provider === 'mineru') return 'MinerU';
  return t('datalabExperimental');
}

function credentialLabel(source: OcrCredentialSource, t: (k: string) => string): string {
  return source === 'system' ? t('credentialSystem') : t('credentialCustom');
}

type TriStateBoolean = 'default' | 'true' | 'false';

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
  const isAdmin = user?.roles?.includes('admin') ?? false;

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<OcrProvider>('paddle');
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

  const [systemSettings, setSystemSettings] = useState<OcrSystemProviderSettings | null>(null);
  const [systemLoading, setSystemLoading] = useState(false);
  const [systemSaving, setSystemSaving] = useState(false);
  const [systemPaddleBaseUrl, setSystemPaddleBaseUrl] = useState('');
  const [systemPaddleApiKey, setSystemPaddleApiKey] = useState('');
  const [systemPaddleVlBaseUrl, setSystemPaddleVlBaseUrl] = useState('');
  const [systemPaddleVlApiKey, setSystemPaddleVlApiKey] = useState('');
  const [systemDatalabBaseUrl, setSystemDatalabBaseUrl] = useState('');
  const [systemDatalabApiKey, setSystemDatalabApiKey] = useState('');
  const [systemMineruBaseUrl, setSystemMineruBaseUrl] = useState('');
  const [systemMineruApiKey, setSystemMineruApiKey] = useState('');
  const [clearSystemPaddleKey, setClearSystemPaddleKey] = useState(false);
  const [clearSystemPaddleVlKey, setClearSystemPaddleVlKey] = useState(false);
  const [clearSystemDatalabKey, setClearSystemDatalabKey] = useState(false);
  const [clearSystemMineruKey, setClearSystemMineruKey] = useState(false);

  useEffect(() => {
    fetchSettings().catch(() => {});
  }, [fetchSettings]);

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setProvider(settings.provider);
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
  }, [settings]);

  useEffect(() => {
    if (!isAdmin) return;
    setSystemLoading(true);
    ocrApi.getSystemSettings()
      .then((s) => {
        setSystemSettings(s);
        setSystemPaddleBaseUrl(s.paddle.baseUrl || '');
        setSystemPaddleVlBaseUrl(s.paddle_vl.baseUrl || '');
        setSystemDatalabBaseUrl(s.datalab.baseUrl || '');
        setSystemMineruBaseUrl(s.mineru.baseUrl || '');
      })
      .catch((e) => {
        showToast('error', e instanceof Error ? e.message : t('loadFailed'));
      })
      .finally(() => setSystemLoading(false));
  }, [isAdmin, showToast, t]);

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
      if (credentialSource === 'custom') {
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
      setSystemDatalabBaseUrl(next.datalab.baseUrl || '');
      setSystemMineruBaseUrl(next.mineru.baseUrl || '');
      setSystemPaddleApiKey('');
      setSystemPaddleVlApiKey('');
      setSystemDatalabApiKey('');
      setSystemMineruApiKey('');
      setClearSystemPaddleKey(false);
      setClearSystemPaddleVlKey(false);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
          <FileText className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-slate-200 light:text-slate-800">
            {t('fileOcrSettingsTitle')}
          </h2>
          <p className="text-sm text-slate-500 light:text-slate-600">
            {t('fileOcrSettingsDesc')}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setTestOpen(true)} disabled={!settings || isLoading}>
          <FlaskConical className="w-4 h-4 mr-1" />
          {t('testProvider')}
        </Button>
      </div>

      <div className="bg-slate-800/30 light:bg-slate-100 rounded-lg p-4 border border-slate-700 light:border-slate-200 space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-slate-400 light:text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('loading')}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-200 light:text-slate-800">{t('enableFileOcr')}</p>
            <p className="text-xs text-slate-500 light:text-slate-600">{t('enableFileOcrHint')}</p>
          </div>
          <button
            onClick={() => setEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              enabled ? 'bg-cyan-600' : 'bg-slate-700 light:bg-slate-300'
            }`}
            aria-label={t('enableFileOcr')}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-1">
              {t('ocrProvider')}
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as OcrProvider)}
              className="w-full px-3 py-2 bg-slate-900 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:border-cyan-500"
            >
              <option value="paddle">PaddleOCR</option>
              <option value="paddle_vl">PaddleOCR-VL</option>
              <option value="datalab">{t('datalabExperimental')}</option>
              <option value="mineru">MinerU</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-1">
              {t('credentialSource')}
            </label>
            <select
              value={credentialSource}
              onChange={(e) => setCredentialSource(e.target.value as OcrCredentialSource)}
              className="w-full px-3 py-2 bg-slate-900 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 focus:outline-none focus:border-cyan-500"
            >
              <option value="system">{t('credentialSystem')}</option>
              <option value="custom">{t('credentialCustom')}</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t('baseUrl')}
            value={effectiveBaseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={credentialSource === 'system'}
            placeholder={t('baseUrlPlaceholder')}
          />
          <Input
            label={t('apiKey')}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={credentialSource === 'system'}
            placeholder={apiKeyHint || t('apiKeyPlaceholder')}
            type="password"
          />
        </div>

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

            <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3">
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

            <div className="flex flex-wrap gap-6">
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

            <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3">
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

        {provider === 'paddle_vl' && (
          <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white/60 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 light:text-slate-800">
                {t('paddleVlParamsTitle')}
              </h3>
              <p className="text-xs text-slate-500 light:text-slate-600">
                {t('paddleVlParamsDesc')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3">
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

            <div className="flex flex-wrap gap-6">
              <Toggle checked={mineruIsOcr} onChange={setMineruIsOcr} label={t('mineruIsOcr')} />
              <Toggle checked={mineruEnableFormula} onChange={setMineruEnableFormula} label={t('mineruEnableFormula')} />
              <Toggle checked={mineruEnableTable} onChange={setMineruEnableTable} label={t('mineruEnableTable')} />
            </div>
            <p className="text-xs text-slate-500 light:text-slate-600">
              {t('mineruToggleDefaults')}
            </p>

            <div className="grid grid-cols-2 gap-3">
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
                  <input
                    type="checkbox"
                    checked={mineruExtraDocx}
                    onChange={(e) => setMineruExtraDocx(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-600 text-cyan-500 focus:ring-cyan-500/50"
                  />
                  docx
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={mineruExtraHtml}
                    onChange={(e) => setMineruExtraHtml(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-600 text-cyan-500 focus:ring-cyan-500/50"
                  />
                  html
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={mineruExtraLatex}
                    onChange={(e) => setMineruExtraLatex(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-600 text-cyan-500 focus:ring-cyan-500/50"
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

        <div className="flex justify-end">
          <Button variant="primary" onClick={handleSave} loading={saving}>
            <Save className="w-4 h-4 mr-1" />
            {t('saveSettings')}
          </Button>
        </div>
      </div>

      <OcrTestModal
        isOpen={testOpen}
        onClose={() => setTestOpen(false)}
        provider={provider}
        credentialSource={credentialSource}
        baseUrl={baseUrl}
        apiKey={apiKey}
        tCommon={tCommon}
      />

      {isAdmin && (
        <div className="bg-slate-800/30 light:bg-slate-100 rounded-lg p-4 border border-slate-700 light:border-slate-200 space-y-4">
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

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={`PaddleOCR ${t('baseUrl')}`}
              value={systemPaddleBaseUrl}
              onChange={(e) => setSystemPaddleBaseUrl(e.target.value)}
              placeholder={t('baseUrlPlaceholder')}
            />
            <div className="space-y-2">
              <Input
                label={`PaddleOCR ${t('apiKey')}`}
                value={systemPaddleApiKey}
                onChange={(e) => setSystemPaddleApiKey(e.target.value)}
                placeholder={systemSettings?.paddle?.hasApiKey && systemSettings.paddle.apiKeyLast4 ? t('apiKeyLast4', { last4: systemSettings.paddle.apiKeyLast4 }) : t('apiKeyPlaceholder')}
                type="password"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setClearSystemPaddleKey(true);
                    setSystemPaddleApiKey('');
                  }}
                >
                  {tCommon('clear')}
                </Button>
                {clearSystemPaddleKey && (
                  <span className="text-xs text-slate-500 light:text-slate-600">{t('apiKeyWillBeCleared')}</span>
                )}
              </div>
            </div>

            <Input
              label={`PaddleOCR-VL ${t('baseUrl')}`}
              value={systemPaddleVlBaseUrl}
              onChange={(e) => setSystemPaddleVlBaseUrl(e.target.value)}
              placeholder={t('baseUrlPlaceholder')}
            />
            <div className="space-y-2">
              <Input
                label={`PaddleOCR-VL ${t('apiKey')}`}
                value={systemPaddleVlApiKey}
                onChange={(e) => setSystemPaddleVlApiKey(e.target.value)}
                placeholder={systemSettings?.paddle_vl?.hasApiKey && systemSettings.paddle_vl.apiKeyLast4 ? t('apiKeyLast4', { last4: systemSettings.paddle_vl.apiKeyLast4 }) : t('apiKeyPlaceholder')}
                type="password"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setClearSystemPaddleVlKey(true);
                    setSystemPaddleVlApiKey('');
                  }}
                >
                  {tCommon('clear')}
                </Button>
                {clearSystemPaddleVlKey && (
                  <span className="text-xs text-slate-500 light:text-slate-600">{t('apiKeyWillBeCleared')}</span>
                )}
              </div>
            </div>

            <Input
              label={`${t('datalabExperimental')} ${t('baseUrl')}`}
              value={systemDatalabBaseUrl}
              onChange={(e) => setSystemDatalabBaseUrl(e.target.value)}
              placeholder={t('baseUrlPlaceholder')}
            />
            <div className="space-y-2">
              <Input
                label={`${t('datalabExperimental')} ${t('apiKey')}`}
                value={systemDatalabApiKey}
                onChange={(e) => setSystemDatalabApiKey(e.target.value)}
                placeholder={systemSettings?.datalab?.hasApiKey && systemSettings.datalab.apiKeyLast4 ? t('apiKeyLast4', { last4: systemSettings.datalab.apiKeyLast4 }) : t('apiKeyPlaceholder')}
                type="password"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setClearSystemDatalabKey(true);
                    setSystemDatalabApiKey('');
                  }}
                >
                  {tCommon('clear')}
                </Button>
                {clearSystemDatalabKey && (
                  <span className="text-xs text-slate-500 light:text-slate-600">{t('apiKeyWillBeCleared')}</span>
                )}
              </div>
            </div>

            <Input
              label={`MinerU ${t('baseUrl')}`}
              value={systemMineruBaseUrl}
              onChange={(e) => setSystemMineruBaseUrl(e.target.value)}
              placeholder={t('baseUrlPlaceholder')}
            />
            <div className="space-y-2">
              <Input
                label={`MinerU ${t('apiKey')}`}
                value={systemMineruApiKey}
                onChange={(e) => setSystemMineruApiKey(e.target.value)}
                placeholder={systemSettings?.mineru?.hasApiKey && systemSettings.mineru.apiKeyLast4 ? t('apiKeyLast4', { last4: systemSettings.mineru.apiKeyLast4 }) : t('apiKeyPlaceholder')}
                type="password"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setClearSystemMineruKey(true);
                    setSystemMineruApiKey('');
                  }}
                >
                  {tCommon('clear')}
                </Button>
                {clearSystemMineruKey && (
                  <span className="text-xs text-slate-500 light:text-slate-600">{t('apiKeyWillBeCleared')}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="primary" onClick={handleSaveSystem} loading={systemSaving} disabled={systemLoading}>
              <Save className="w-4 h-4 mr-1" />
              {t('saveSettings')}
            </Button>
          </div>
        </div>
      )}
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
  tCommon,
}: {
  isOpen: boolean;
  onClose: () => void;
  provider: OcrProvider;
  credentialSource: OcrCredentialSource;
  baseUrl: string;
  apiKey: string;
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
        ...(credentialSource === 'custom' ? { baseUrl: baseUrl || null, apiKey: apiKey.trim() || null } : {}),
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
          <div>{t('credentialSource')}: {credentialLabel(credentialSource, t)}</div>
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
