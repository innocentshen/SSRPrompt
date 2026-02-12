import { prisma } from '../config/database.js';
import { getS3Client, isS3Configured } from '../config/s3.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { filesService } from './files.service.js';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from '@ssrprompt/shared';
import { Prisma } from '@prisma/client';
import { unzipSync } from 'fflate';
import { randomUUID } from 'node:crypto';

import type {
  OcrProvider,
  OcrCredentialSource,
  OcrTestResult,
  UpdateOcrProviderSettingsDto,
  OcrProviderSettings,
  OcrSystemProviderSettings,
  UpdateOcrSystemProviderSettingsDto,
  MineruOcrParams,
  MineruModelVersion,
  DatalabOcrParams,
  DatalabOcrMode,
  PaddleOcrParams,
  PaddleVlOcrParams,
} from '@ssrprompt/shared';

type EffectiveOcrConfig = {
  enabled: boolean;
  provider: OcrProvider;
  baseUrl: string | null;
  apiKey: string | null;
  credentialSource: OcrCredentialSource;
  mineru: MineruOcrParams;
  datalab: DatalabOcrParams;
  paddle: PaddleOcrParams;
  paddle_vl: PaddleVlOcrParams;
};

type OcrProviderEnabledMap = Record<OcrProvider, boolean>;

const OCR_TEST_PREVIEW_LIMIT = 100_000;
const OCR_PROVIDERS: OcrProvider[] = ['paddle', 'paddle_vl', 'paddle_vl_1_5', 'datalab', 'mineru'];

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().replace(/\/+$/, '') || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function joinUrl(baseUrl: string, path: string): string {
  const cleanedBase = baseUrl.replace(/\/+$/, '');
  const cleanedPath = path.startsWith('/') ? path : `/${path}`;
  try {
    const u = new URL(cleanedBase);
    const basePath = u.pathname.replace(/\/+$/, '');
    u.pathname = `${basePath}${cleanedPath}`;
    return u.toString();
  } catch {
    return `${cleanedBase}${cleanedPath}`;
  }
}

function normalizeMineruZipUrl(value: string): string {
  try {
    const u = new URL(value);
    if (u.hostname === 'cdn-mineru.openxlab.org.cn') {
      u.hostname = 'mineru.oss-cn-shanghai.aliyuncs.com';
    }
    return u.toString();
  } catch {
    return value;
  }
}

const MINERU_DEFAULT_PARAMS: MineruOcrParams = {
  userToken: null,
  modelVersion: 'pipeline',
  // This is a file OCR feature; default to OCR enabled so image/scanned PDFs work out of the box.
  isOcr: true,
  enableFormula: true,
  enableTable: true,
  language: 'ch',
  extraFormats: [],
  pageRanges: null,
};

const DATALAB_DEFAULT_PARAMS: DatalabOcrParams = {
  mode: 'fast',
  maxPages: null,
  pageRange: null,
  paginate: false,
  addBlockIds: false,
  disableImageExtraction: false,
  disableImageCaptions: false,
  outputFormat: null,
  skipCache: false,
  saveCheckpoint: false,
  extras: null,
  additionalConfig: null,
};

const PADDLE_DEFAULT_PARAMS: PaddleOcrParams = {
  useDocOrientationClassify: null,
  useDocUnwarping: null,
  useTextlineOrientation: null,
  textDetLimitSideLen: null,
  textDetLimitType: null,
  textDetThresh: null,
  textDetBoxThresh: null,
  textDetUnclipRatio: null,
  textRecScoreThresh: null,
  visualize: null,
};

const PADDLE_VL_DEFAULT_PARAMS: PaddleVlOcrParams = {
  useDocOrientationClassify: null,
  useDocUnwarping: null,
  useLayoutDetection: null,
  useChartRecognition: null,
  layoutThreshold: null,
  layoutNms: null,
  layoutUnclipRatio: null,
  layoutMergeBboxesMode: null,
  promptLabel: null,
  repetitionPenalty: null,
  temperature: null,
  topP: null,
  minPixels: null,
  maxPixels: null,
  showFormulaNumber: null,
  prettifyMarkdown: null,
  visualize: null,
};

function normalizeMineruParams(_userId: string, raw: unknown): MineruOcrParams {
  const defaults = MINERU_DEFAULT_PARAMS;
  if (!raw || typeof raw !== 'object') return defaults;

  const record = raw as Record<string, unknown>;
  const mineruRaw = record.mineru;
  if (!mineruRaw || typeof mineruRaw !== 'object') return defaults;
  const mineru = mineruRaw as Record<string, unknown>;

  const userToken = (() => {
    if (mineru.userToken === null) return null;
    if (typeof mineru.userToken === 'string') {
      const v = mineru.userToken.trim();
      return v ? v : null;
    }
    return defaults.userToken;
  })();

  const modelVersion: MineruModelVersion = mineru.modelVersion === 'vlm' ? 'vlm' : 'pipeline';
  const isOcr = typeof mineru.isOcr === 'boolean' ? mineru.isOcr : defaults.isOcr;
  const enableFormula = typeof mineru.enableFormula === 'boolean' ? mineru.enableFormula : defaults.enableFormula;
  const enableTable = typeof mineru.enableTable === 'boolean' ? mineru.enableTable : defaults.enableTable;
  const language = typeof mineru.language === 'string' && mineru.language.trim() ? mineru.language.trim() : defaults.language;
  const extraFormats = Array.isArray(mineru.extraFormats) ? mineru.extraFormats.filter((x) => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : defaults.extraFormats;
  const pageRanges = typeof mineru.pageRanges === 'string' && mineru.pageRanges.trim() ? mineru.pageRanges.trim() : null;

  // If userToken isn't configured, MinerU still needs a per-user identifier. We'll fallback to the SSRPrompt userId at call-site.
  // Keep the returned setting null so UI can show it as "unset" and avoid exposing internal IDs by default.
  return {
    userToken,
    modelVersion,
    isOcr,
    enableFormula,
    enableTable,
    language,
    extraFormats: Array.from(new Set(extraFormats)),
    pageRanges,
  };
}

function normalizeDatalabParams(raw: unknown): DatalabOcrParams {
  const defaults = DATALAB_DEFAULT_PARAMS;
  if (!raw || typeof raw !== 'object') return defaults;

  const record = raw as Record<string, unknown>;
  const datalabRaw = record.datalab;
  if (!datalabRaw || typeof datalabRaw !== 'object') return defaults;
  const datalab = datalabRaw as Record<string, unknown>;

  const toNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  const toBoolean = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;
  const toString = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };
  const toMode = (value: unknown): DatalabOcrMode =>
    value === 'balanced' || value === 'accurate' || value === 'fast' ? value : defaults.mode;

  return {
    mode: toMode(datalab.mode),
    maxPages: toNumber(datalab.maxPages) ?? defaults.maxPages,
    pageRange: toString(datalab.pageRange) ?? defaults.pageRange,
    paginate: toBoolean(datalab.paginate, defaults.paginate),
    addBlockIds: toBoolean(datalab.addBlockIds, defaults.addBlockIds),
    disableImageExtraction: toBoolean(datalab.disableImageExtraction, defaults.disableImageExtraction),
    disableImageCaptions: toBoolean(datalab.disableImageCaptions, defaults.disableImageCaptions),
    outputFormat: toString(datalab.outputFormat) ?? defaults.outputFormat,
    skipCache: toBoolean(datalab.skipCache, defaults.skipCache),
    saveCheckpoint: toBoolean(datalab.saveCheckpoint, defaults.saveCheckpoint),
    extras: toString(datalab.extras) ?? defaults.extras,
    additionalConfig: toString(datalab.additionalConfig) ?? defaults.additionalConfig,
  };
}

function normalizePaddleParams(raw: unknown): PaddleOcrParams {
  const defaults = PADDLE_DEFAULT_PARAMS;
  if (!raw || typeof raw !== 'object') return defaults;

  const record = raw as Record<string, unknown>;
  const paddleRaw = record.paddle;
  if (!paddleRaw || typeof paddleRaw !== 'object') return defaults;
  const paddle = paddleRaw as Record<string, unknown>;

  const toNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  const toBoolean = (value: unknown): boolean | null =>
    typeof value === 'boolean' ? value : null;
  const toLimitType = (value: unknown): 'min' | 'max' | null =>
    value === 'min' || value === 'max' ? value : null;

  return {
    useDocOrientationClassify: toBoolean(paddle.useDocOrientationClassify) ?? defaults.useDocOrientationClassify,
    useDocUnwarping: toBoolean(paddle.useDocUnwarping) ?? defaults.useDocUnwarping,
    useTextlineOrientation: toBoolean(paddle.useTextlineOrientation) ?? defaults.useTextlineOrientation,
    textDetLimitSideLen: toNumber(paddle.textDetLimitSideLen) ?? defaults.textDetLimitSideLen,
    textDetLimitType: toLimitType(paddle.textDetLimitType) ?? defaults.textDetLimitType,
    textDetThresh: toNumber(paddle.textDetThresh) ?? defaults.textDetThresh,
    textDetBoxThresh: toNumber(paddle.textDetBoxThresh) ?? defaults.textDetBoxThresh,
    textDetUnclipRatio: toNumber(paddle.textDetUnclipRatio) ?? defaults.textDetUnclipRatio,
    textRecScoreThresh: toNumber(paddle.textRecScoreThresh) ?? defaults.textRecScoreThresh,
    visualize: toBoolean(paddle.visualize) ?? defaults.visualize,
  };
}

function normalizePaddleVlParams(raw: unknown): PaddleVlOcrParams {
  const defaults = PADDLE_VL_DEFAULT_PARAMS;
  if (!raw || typeof raw !== 'object') return defaults;

  const record = raw as Record<string, unknown>;
  const paddleRaw = record.paddle_vl;
  if (!paddleRaw || typeof paddleRaw !== 'object') return defaults;
  const paddle = paddleRaw as Record<string, unknown>;

  const toNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  const toBoolean = (value: unknown): boolean | null =>
    typeof value === 'boolean' ? value : null;
  const toString = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };
  const toMergeMode = (value: unknown): 'large' | 'small' | 'union' | null =>
    value === 'large' || value === 'small' || value === 'union' ? value : null;

  return {
    useDocOrientationClassify: toBoolean(paddle.useDocOrientationClassify) ?? defaults.useDocOrientationClassify,
    useDocUnwarping: toBoolean(paddle.useDocUnwarping) ?? defaults.useDocUnwarping,
    useLayoutDetection: toBoolean(paddle.useLayoutDetection) ?? defaults.useLayoutDetection,
    useChartRecognition: toBoolean(paddle.useChartRecognition) ?? defaults.useChartRecognition,
    layoutThreshold: toNumber(paddle.layoutThreshold) ?? defaults.layoutThreshold,
    layoutNms: toBoolean(paddle.layoutNms) ?? defaults.layoutNms,
    layoutUnclipRatio: toNumber(paddle.layoutUnclipRatio) ?? defaults.layoutUnclipRatio,
    layoutMergeBboxesMode: toMergeMode(paddle.layoutMergeBboxesMode) ?? defaults.layoutMergeBboxesMode,
    promptLabel: toString(paddle.promptLabel) ?? defaults.promptLabel,
    repetitionPenalty: toNumber(paddle.repetitionPenalty) ?? defaults.repetitionPenalty,
    temperature: toNumber(paddle.temperature) ?? defaults.temperature,
    topP: toNumber(paddle.topP) ?? defaults.topP,
    minPixels: toNumber(paddle.minPixels) ?? defaults.minPixels,
    maxPixels: toNumber(paddle.maxPixels) ?? defaults.maxPixels,
    showFormulaNumber: toBoolean(paddle.showFormulaNumber) ?? defaults.showFormulaNumber,
    prettifyMarkdown: toBoolean(paddle.prettifyMarkdown) ?? defaults.prettifyMarkdown,
    visualize: toBoolean(paddle.visualize) ?? defaults.visualize,
  };
}

function normalizeProviderEnabledMap(
  rawProviderParams: unknown,
  selectedProvider: OcrProvider,
  legacyEnabled: boolean
): OcrProviderEnabledMap {
  const defaults: OcrProviderEnabledMap = {
    paddle: false,
    paddle_vl: false,
    paddle_vl_1_5: false,
    datalab: false,
    mineru: false,
  };
  defaults[selectedProvider] = legacyEnabled;

  if (!isRecord(rawProviderParams)) return defaults;
  const rawMap = rawProviderParams.providerEnabled;
  if (!isRecord(rawMap)) return defaults;

  const next: OcrProviderEnabledMap = { ...defaults };
  for (const provider of OCR_PROVIDERS) {
    const rawValue = rawMap[provider];
    if (typeof rawValue === 'boolean') {
      next[provider] = rawValue;
    }
  }
  return next;
}

function pickFirstEnabledProvider(enabledByProvider: OcrProviderEnabledMap): OcrProvider | null {
  for (const provider of OCR_PROVIDERS) {
    if (enabledByProvider[provider]) return provider;
  }
  return null;
}

function mergePaddleParams(base: PaddleOcrParams, override?: Partial<PaddleOcrParams>): PaddleOcrParams {
  if (!override) return base;
  const next = { ...base };

  if (Object.prototype.hasOwnProperty.call(override, 'useDocOrientationClassify')) {
    next.useDocOrientationClassify = typeof override.useDocOrientationClassify === 'boolean' ? override.useDocOrientationClassify : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'useDocUnwarping')) {
    next.useDocUnwarping = typeof override.useDocUnwarping === 'boolean' ? override.useDocUnwarping : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'useTextlineOrientation')) {
    next.useTextlineOrientation = typeof override.useTextlineOrientation === 'boolean' ? override.useTextlineOrientation : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'textDetLimitSideLen')) {
    next.textDetLimitSideLen = typeof override.textDetLimitSideLen === 'number' && Number.isFinite(override.textDetLimitSideLen)
      ? override.textDetLimitSideLen
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'textDetLimitType')) {
    next.textDetLimitType = override.textDetLimitType === 'min' || override.textDetLimitType === 'max' ? override.textDetLimitType : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'textDetThresh')) {
    next.textDetThresh = typeof override.textDetThresh === 'number' && Number.isFinite(override.textDetThresh)
      ? override.textDetThresh
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'textDetBoxThresh')) {
    next.textDetBoxThresh = typeof override.textDetBoxThresh === 'number' && Number.isFinite(override.textDetBoxThresh)
      ? override.textDetBoxThresh
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'textDetUnclipRatio')) {
    next.textDetUnclipRatio = typeof override.textDetUnclipRatio === 'number' && Number.isFinite(override.textDetUnclipRatio)
      ? override.textDetUnclipRatio
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'textRecScoreThresh')) {
    next.textRecScoreThresh = typeof override.textRecScoreThresh === 'number' && Number.isFinite(override.textRecScoreThresh)
      ? override.textRecScoreThresh
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'visualize')) {
    next.visualize = typeof override.visualize === 'boolean' ? override.visualize : null;
  }

  return next;
}

function mergePaddleVlParams(base: PaddleVlOcrParams, override?: Partial<PaddleVlOcrParams>): PaddleVlOcrParams {
  if (!override) return base;
  const next = { ...base };

  if (Object.prototype.hasOwnProperty.call(override, 'useDocOrientationClassify')) {
    next.useDocOrientationClassify = typeof override.useDocOrientationClassify === 'boolean' ? override.useDocOrientationClassify : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'useDocUnwarping')) {
    next.useDocUnwarping = typeof override.useDocUnwarping === 'boolean' ? override.useDocUnwarping : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'useLayoutDetection')) {
    next.useLayoutDetection = typeof override.useLayoutDetection === 'boolean' ? override.useLayoutDetection : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'useChartRecognition')) {
    next.useChartRecognition = typeof override.useChartRecognition === 'boolean' ? override.useChartRecognition : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'layoutThreshold')) {
    next.layoutThreshold = typeof override.layoutThreshold === 'number' && Number.isFinite(override.layoutThreshold)
      ? override.layoutThreshold
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'layoutNms')) {
    next.layoutNms = typeof override.layoutNms === 'boolean' ? override.layoutNms : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'layoutUnclipRatio')) {
    next.layoutUnclipRatio = typeof override.layoutUnclipRatio === 'number' && Number.isFinite(override.layoutUnclipRatio)
      ? override.layoutUnclipRatio
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'layoutMergeBboxesMode')) {
    next.layoutMergeBboxesMode =
      override.layoutMergeBboxesMode === 'large' || override.layoutMergeBboxesMode === 'small' || override.layoutMergeBboxesMode === 'union'
        ? override.layoutMergeBboxesMode
        : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'promptLabel')) {
    next.promptLabel = typeof override.promptLabel === 'string' && override.promptLabel.trim() ? override.promptLabel.trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'repetitionPenalty')) {
    next.repetitionPenalty = typeof override.repetitionPenalty === 'number' && Number.isFinite(override.repetitionPenalty)
      ? override.repetitionPenalty
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'temperature')) {
    next.temperature = typeof override.temperature === 'number' && Number.isFinite(override.temperature)
      ? override.temperature
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'topP')) {
    next.topP = typeof override.topP === 'number' && Number.isFinite(override.topP) ? override.topP : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'minPixels')) {
    next.minPixels = typeof override.minPixels === 'number' && Number.isFinite(override.minPixels) ? override.minPixels : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'maxPixels')) {
    next.maxPixels = typeof override.maxPixels === 'number' && Number.isFinite(override.maxPixels) ? override.maxPixels : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'showFormulaNumber')) {
    next.showFormulaNumber = typeof override.showFormulaNumber === 'boolean' ? override.showFormulaNumber : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'prettifyMarkdown')) {
    next.prettifyMarkdown = typeof override.prettifyMarkdown === 'boolean' ? override.prettifyMarkdown : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'visualize')) {
    next.visualize = typeof override.visualize === 'boolean' ? override.visualize : null;
  }

  return next;
}

function mergeDatalabParams(base: DatalabOcrParams, override?: Partial<DatalabOcrParams>): DatalabOcrParams {
  if (!override) return base;
  const next = { ...base };

  if (Object.prototype.hasOwnProperty.call(override, 'mode')) {
    next.mode = override.mode === 'balanced' || override.mode === 'accurate' || override.mode === 'fast'
      ? override.mode
      : base.mode;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'maxPages')) {
    next.maxPages = typeof override.maxPages === 'number' && Number.isFinite(override.maxPages) && override.maxPages > 0
      ? Math.trunc(override.maxPages)
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'pageRange')) {
    next.pageRange = typeof override.pageRange === 'string' && override.pageRange.trim() ? override.pageRange.trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'paginate')) {
    next.paginate = typeof override.paginate === 'boolean' ? override.paginate : base.paginate;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'addBlockIds')) {
    next.addBlockIds = typeof override.addBlockIds === 'boolean' ? override.addBlockIds : base.addBlockIds;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'disableImageExtraction')) {
    next.disableImageExtraction = typeof override.disableImageExtraction === 'boolean'
      ? override.disableImageExtraction
      : base.disableImageExtraction;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'disableImageCaptions')) {
    next.disableImageCaptions = typeof override.disableImageCaptions === 'boolean'
      ? override.disableImageCaptions
      : base.disableImageCaptions;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'outputFormat')) {
    next.outputFormat = typeof override.outputFormat === 'string' && override.outputFormat.trim() ? override.outputFormat.trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'skipCache')) {
    next.skipCache = typeof override.skipCache === 'boolean' ? override.skipCache : base.skipCache;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'saveCheckpoint')) {
    next.saveCheckpoint = typeof override.saveCheckpoint === 'boolean' ? override.saveCheckpoint : base.saveCheckpoint;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'extras')) {
    next.extras = typeof override.extras === 'string' && override.extras.trim() ? override.extras.trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(override, 'additionalConfig')) {
    next.additionalConfig = typeof override.additionalConfig === 'string' && override.additionalConfig.trim() ? override.additionalConfig.trim() : null;
  }

  return next;
}

function toMineruDataId(value: string): string {
  const v = value.trim().replace(/[^A-Za-z0-9_.-]/g, '_');
  return (v || 'ssrprompt').slice(0, 128);
}

function paddleRequiresToken(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host.endsWith('aistudio-app.com') || host.endsWith('aistudio.baidu.com') || host.endsWith('ai.baidu.com');
  } catch {
    return false;
  }
}

function last4(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return trimmed;
  return trimmed.slice(-4);
}

function safeDecrypt(ciphertext: string | null): string | null {
  if (!ciphertext) return null;
  try {
    return decrypt(ciphertext);
  } catch {
    return null;
  }
}

function mimeToPaddleFileType(mimeType: string): 0 | 1 {
  if (mimeType === 'application/pdf') return 0;
  if (mimeType.startsWith('image/')) return 1;
  throw new AppError(400, 'VALIDATION_ERROR', `Unsupported OCR mime type: ${mimeType}`);
}

function applyPaddleParams(target: Record<string, unknown>, params: PaddleOcrParams): void {
  if (typeof params.useDocOrientationClassify === 'boolean') target.useDocOrientationClassify = params.useDocOrientationClassify;
  if (typeof params.useDocUnwarping === 'boolean') target.useDocUnwarping = params.useDocUnwarping;
  if (typeof params.useTextlineOrientation === 'boolean') target.useTextlineOrientation = params.useTextlineOrientation;
  if (typeof params.textDetLimitSideLen === 'number') target.textDetLimitSideLen = params.textDetLimitSideLen;
  if (params.textDetLimitType === 'min' || params.textDetLimitType === 'max') target.textDetLimitType = params.textDetLimitType;
  if (typeof params.textDetThresh === 'number') target.textDetThresh = params.textDetThresh;
  if (typeof params.textDetBoxThresh === 'number') target.textDetBoxThresh = params.textDetBoxThresh;
  if (typeof params.textDetUnclipRatio === 'number') target.textDetUnclipRatio = params.textDetUnclipRatio;
  if (typeof params.textRecScoreThresh === 'number') target.textRecScoreThresh = params.textRecScoreThresh;
  if (typeof params.visualize === 'boolean') target.visualize = params.visualize;
}

function applyPaddleVlParams(target: Record<string, unknown>, params: PaddleVlOcrParams): void {
  if (typeof params.useDocOrientationClassify === 'boolean') target.useDocOrientationClassify = params.useDocOrientationClassify;
  if (typeof params.useDocUnwarping === 'boolean') target.useDocUnwarping = params.useDocUnwarping;
  if (typeof params.useLayoutDetection === 'boolean') target.useLayoutDetection = params.useLayoutDetection;
  if (typeof params.useChartRecognition === 'boolean') target.useChartRecognition = params.useChartRecognition;
  if (typeof params.layoutThreshold === 'number') target.layoutThreshold = params.layoutThreshold;
  if (typeof params.layoutNms === 'boolean') target.layoutNms = params.layoutNms;
  if (typeof params.layoutUnclipRatio === 'number') target.layoutUnclipRatio = params.layoutUnclipRatio;
  if (params.layoutMergeBboxesMode === 'large' || params.layoutMergeBboxesMode === 'small' || params.layoutMergeBboxesMode === 'union') {
    target.layoutMergeBboxesMode = params.layoutMergeBboxesMode;
  }
  if (typeof params.promptLabel === 'string' && params.promptLabel.trim()) target.promptLabel = params.promptLabel.trim();
  if (typeof params.repetitionPenalty === 'number') target.repetitionPenalty = params.repetitionPenalty;
  if (typeof params.temperature === 'number') target.temperature = params.temperature;
  if (typeof params.topP === 'number') target.topP = params.topP;
  if (typeof params.minPixels === 'number') target.minPixels = params.minPixels;
  if (typeof params.maxPixels === 'number') target.maxPixels = params.maxPixels;
  if (typeof params.showFormulaNumber === 'boolean') target.showFormulaNumber = params.showFormulaNumber;
  if (typeof params.prettifyMarkdown === 'boolean') target.prettifyMarkdown = params.prettifyMarkdown;
  if (typeof params.visualize === 'boolean') target.visualize = params.visualize;
}

function buildAuthorization(value: string, defaultScheme: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  // If caller already provided an auth scheme (e.g. "token xxx", "Bearer yyy"), keep it as-is.
  if (/^[A-Za-z][A-Za-z0-9_-]*\s+/.test(trimmed)) return trimmed;
  return `${defaultScheme} ${trimmed}`;
}

function extractStringsDeep(value: unknown, out: string[], depth = 0): void {
  if (depth > 6) return;
  if (typeof value === 'string') {
    const v = value.trim();
    if (v) out.push(v);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractStringsDeep(item, out, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Prefer well-known keys first
      if (k === 'text' || k === 'texts' || k === 'rec_texts' || k === 'recTexts') {
        extractStringsDeep(v, out, depth + 1);
        continue;
      }
      extractStringsDeep(v, out, depth + 1);
    }
  }
}

function extractPaddleText(prunedResult: unknown): string {
  if (!prunedResult) return '';
  if (typeof prunedResult === 'string') return prunedResult.trim();

  if (prunedResult && typeof prunedResult === 'object') {
    const record = prunedResult as Record<string, unknown>;
    const candidates = [
      record.rec_texts,
      record.recTexts,
      record.texts,
      record.text,
    ];

    for (const c of candidates) {
      if (Array.isArray(c) && c.every((x) => typeof x === 'string')) {
        return (c as string[]).map((s) => s.trim()).filter(Boolean).join('\n');
      }
      if (typeof c === 'string') {
        const v = c.trim();
        if (v) return v;
      }
    }
  }

  const strings: string[] = [];
  extractStringsDeep(prunedResult, strings);
  // Deduplicate while preserving order.
  const seen = new Set<string>();
  const deduped = strings.filter((s) => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
  return deduped.join('\n');
}

function extractPaddleVlText(layoutParsingResult: unknown): string {
  if (!layoutParsingResult) return '';
  if (typeof layoutParsingResult === 'string') return layoutParsingResult.trim();

  if (layoutParsingResult && typeof layoutParsingResult === 'object') {
    const record = layoutParsingResult as Record<string, unknown>;
    const markdown = record.markdown;
    if (markdown && typeof markdown === 'object' && 'text' in markdown) {
      const markdownText = (markdown as { text?: unknown }).text;
      if (typeof markdownText === 'string') {
        const v = markdownText.trim();
        if (v) return v;
      }
    }
    return extractPaddleText(record.prunedResult);
  }

  return '';
}

async function paddleOcrExtract(
  config: { baseUrl: string; apiKey?: string | null },
  file: { buffer: Buffer; mimeType: string },
  params: PaddleOcrParams
): Promise<{ pages: string[]; fullText: string }> {
  const url = (() => {
    try {
      const u = new URL(config.baseUrl);
      const segments = u.pathname.split('/').filter(Boolean);
      if (segments.includes('ocr')) return u.toString();
      u.pathname = `${u.pathname.replace(/\/+$/, '')}/ocr`;
      return u.toString();
    } catch {
      return config.baseUrl.endsWith('/ocr') ? config.baseUrl : `${config.baseUrl}/ocr`;
    }
  })();

  console.log(`[OCR:Paddle] Starting request to ${url}, file size: ${file.buffer.byteLength} bytes`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (config.apiKey && config.apiKey.trim()) {
    // Baidu AI Studio PaddleOCR expects: Authorization: token <TOKEN>
    headers['Authorization'] = buildAuthorization(config.apiKey, 'token');
  }

  const body: Record<string, unknown> = {
    file: file.buffer.toString('base64'),
    fileType: mimeToPaddleFileType(file.mimeType),
  };
  applyPaddleParams(body, params);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  const requestStart = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    console.log(`[OCR:Paddle] Response received in ${Date.now() - requestStart}ms, status: ${res.status}`);

    const text = await res.text();
    const sanitizedText = text.replace(/^\uFEFF/, '');
    let json: unknown;
    try {
      json = JSON.parse(sanitizedText);
    } catch {
      const contentType = res.headers.get('content-type');
      const snippet = sanitizedText.trim().replace(/\s+/g, ' ').slice(0, 240);
      const message = `PaddleOCR returned non-JSON response (status ${res.status}${contentType ? `, content-type ${contentType}` : ''}${snippet ? `, snippet ${JSON.stringify(snippet)}` : ''})`;
      throw new AppError(502, 'PROVIDER_ERROR', message, {
        status: res.status,
        contentType: res.headers.get('content-type'),
        body: text.slice(0, 2000),
      });
    }

    const jsonRecord = asRecord(json);

    if (!res.ok) {
      throw new AppError(502, 'PROVIDER_ERROR', 'PaddleOCR request failed', { status: res.status, body: jsonRecord });
    }

    if (jsonRecord.errorCode !== 0) {
      const errorMsg = typeof jsonRecord.errorMsg === 'string' ? jsonRecord.errorMsg : 'PaddleOCR returned error';
      throw new AppError(502, 'PROVIDER_ERROR', errorMsg, { body: jsonRecord });
    }

    const resultRecord = asRecord(jsonRecord.result);
    const ocrResults = resultRecord.ocrResults;
    if (!Array.isArray(ocrResults) || ocrResults.length === 0) {
      return { pages: [], fullText: '' };
    }

    const pages = ocrResults.map((item) => {
      const record = isRecord(item) ? item : null;
      return extractPaddleText(record ? record.prunedResult : item);
    });
    const fullText = pages.filter(Boolean).join('\n\n');
    return { pages, fullText };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('abort')) {
      throw new AppError(504, 'PROVIDER_ERROR', 'PaddleOCR timeout (120s)');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function paddleOcrVlExtract(
  config: { baseUrl: string; apiKey?: string | null },
  file: { buffer: Buffer; mimeType: string },
  params: PaddleVlOcrParams
): Promise<{ pages: string[]; fullText: string }> {
  const url = (() => {
    try {
      const u = new URL(config.baseUrl);
      const segments = u.pathname.split('/').filter(Boolean);
      if (segments.includes('layout-parsing')) return u.toString();
      u.pathname = `${u.pathname.replace(/\/+$/, '')}/layout-parsing`;
      return u.toString();
    } catch {
      return config.baseUrl.endsWith('/layout-parsing') ? config.baseUrl : `${config.baseUrl}/layout-parsing`;
    }
  })();

  console.log(`[OCR:Paddle-VL] Starting request to ${url}, file size: ${file.buffer.byteLength} bytes`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (config.apiKey && config.apiKey.trim()) {
    // Baidu AI Studio PaddleOCR expects: Authorization: token <TOKEN>
    headers['Authorization'] = buildAuthorization(config.apiKey, 'token');
  }

  const body: Record<string, unknown> = {
    file: file.buffer.toString('base64'),
    fileType: mimeToPaddleFileType(file.mimeType),
    // Avoid returning large base64 images in the response; we only need text.
    visualize: false,
  };
  applyPaddleVlParams(body, params);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);

  const requestStart = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    console.log(`[OCR:Paddle-VL] Response received in ${Date.now() - requestStart}ms, status: ${res.status}`);

    const text = await res.text();
    const sanitizedText = text.replace(/^\uFEFF/, '');
    let json: unknown;
    try {
      json = JSON.parse(sanitizedText);
    } catch {
      const contentType = res.headers.get('content-type');
      const snippet = sanitizedText.trim().replace(/\s+/g, ' ').slice(0, 240);
      const message = `PaddleOCR-VL returned non-JSON response (status ${res.status}${contentType ? `, content-type ${contentType}` : ''}${snippet ? `, snippet ${JSON.stringify(snippet)}` : ''})`;
      throw new AppError(502, 'PROVIDER_ERROR', message, {
        status: res.status,
        contentType: res.headers.get('content-type'),
        body: text.slice(0, 2000),
      });
    }

    const jsonRecord = asRecord(json);

    if (!res.ok) {
      throw new AppError(502, 'PROVIDER_ERROR', 'PaddleOCR-VL request failed', { status: res.status, body: jsonRecord });
    }

    if (jsonRecord.errorCode !== 0) {
      const errorMsg = typeof jsonRecord.errorMsg === 'string' ? jsonRecord.errorMsg : 'PaddleOCR-VL returned error';
      throw new AppError(502, 'PROVIDER_ERROR', errorMsg, { body: jsonRecord });
    }

    const resultRecord = asRecord(jsonRecord.result);
    const layoutParsingResults = resultRecord.layoutParsingResults;
    if (!Array.isArray(layoutParsingResults) || layoutParsingResults.length === 0) {
      return { pages: [], fullText: '' };
    }

    const pages = layoutParsingResults
      .map((item) => extractPaddleVlText(item))
      .map((page) => page.trim())
      .filter(Boolean);
    const fullText = pages.join('\n\n');
    return { pages, fullText };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('abort')) {
      throw new AppError(504, 'PROVIDER_ERROR', 'PaddleOCR-VL timeout (180s)');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function datalabExtract(
  config: { baseUrl: string; apiKey: string },
  params: DatalabOcrParams,
  file: { buffer: Buffer; mimeType: string; filename: string }
): Promise<{ pages: string[]; fullText: string; pageCount?: number }> {
  const baseUrl = config.baseUrl;
  const markerUrl = baseUrl.endsWith('/marker') ? baseUrl : `${baseUrl}/marker`;
  const headers: Record<string, string> = {
    'X-API-Key': config.apiKey,
  };

  console.log(`[OCR:Datalab] Starting upload to ${markerUrl}, file: ${file.filename}, size: ${file.buffer.byteLength} bytes`);

  const form = new FormData();
  // Copy into a plain Uint8Array to avoid SharedArrayBuffer typing issues in Node fetch types.
  const bytes = new Uint8Array(file.buffer.byteLength);
  bytes.set(file.buffer);
  form.append('file', new Blob([bytes], { type: file.mimeType }), file.filename);

  if (params.mode) form.append('mode', params.mode);
  if (typeof params.maxPages === 'number') form.append('max_pages', String(params.maxPages));
  if (params.pageRange) form.append('page_range', params.pageRange);
  form.append('paginate', String(params.paginate));
  form.append('add_block_ids', String(params.addBlockIds));
  form.append('disable_image_extraction', String(params.disableImageExtraction));
  form.append('disable_image_captions', String(params.disableImageCaptions));
  if (params.outputFormat) form.append('output_format', params.outputFormat);
  form.append('skip_cache', String(params.skipCache));
  form.append('save_checkpoint', String(params.saveCheckpoint));
  if (params.extras) form.append('extras', params.extras);
  if (params.additionalConfig) form.append('additional_config', params.additionalConfig);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);

  const uploadStart = Date.now();
  try {
    const startRes = await fetch(markerUrl, {
      method: 'POST',
      headers,
      body: form,
      signal: controller.signal,
    });

    console.log(`[OCR:Datalab] Upload completed in ${Date.now() - uploadStart}ms, status: ${startRes.status}`);

    const startText = await startRes.text();
    let startJson: Record<string, unknown>;
    try {
      const parsed = JSON.parse(startText);
      startJson = asRecord(parsed);
    } catch {
      throw new AppError(502, 'PROVIDER_ERROR', 'Datalab returned non-JSON response', { status: startRes.status, body: startText.slice(0, 2000) });
    }

    if (!startRes.ok) {
      throw new AppError(502, 'PROVIDER_ERROR', 'Datalab request failed', { status: startRes.status, body: startJson });
    }

    const requestId =
      typeof startJson.request_id === 'string'
        ? startJson.request_id
        : (typeof startJson.requestId === 'string' ? startJson.requestId : null);
    const requestCheckUrl =
      typeof startJson.request_check_url === 'string'
        ? startJson.request_check_url
        : (typeof startJson.requestCheckUrl === 'string' ? startJson.requestCheckUrl : null);
    console.log(`[OCR:Datalab] Got request_id: ${requestId}, polling...`);

    const checkUrl: string | null =
      typeof requestCheckUrl === 'string'
        ? requestCheckUrl
        : (typeof requestId === 'string' ? `${markerUrl}/${requestId}` : null);

    if (!checkUrl) {
      throw new AppError(502, 'PROVIDER_ERROR', 'Datalab did not return request_id');
    }

    const pollStart = Date.now();
    while (true) {
      if (Date.now() - pollStart > 180_000) {
        throw new AppError(504, 'PROVIDER_ERROR', 'Datalab timeout (180s)');
      }

      const pollRes = await fetch(checkUrl, { method: 'GET', headers, signal: controller.signal });
      const pollText = await pollRes.text();
      let pollJson: Record<string, unknown>;
      try {
        const parsed = JSON.parse(pollText);
        pollJson = asRecord(parsed);
      } catch {
        throw new AppError(502, 'PROVIDER_ERROR', 'Datalab returned non-JSON response (poll)', { status: pollRes.status, body: pollText.slice(0, 2000) });
      }

      if (!pollRes.ok) {
        throw new AppError(502, 'PROVIDER_ERROR', 'Datalab poll failed', { status: pollRes.status, body: pollJson });
      }

      const status = String(pollJson.status || '').toLowerCase();
      console.log(`[OCR:Datalab] Poll status: ${status}, elapsed: ${Date.now() - pollStart}ms`);

      if (status === 'completed' || status === 'complete' || status === 'success') {
        const outputText = (() => {
          if (typeof pollJson.markdown === 'string' && pollJson.markdown.trim()) return pollJson.markdown;
          if (typeof pollJson.html === 'string' && pollJson.html.trim()) return pollJson.html;
          if (typeof pollJson.json === 'string' && pollJson.json.trim()) return pollJson.json;
          if (pollJson.json && typeof pollJson.json === 'object') {
            return JSON.stringify(pollJson.json, null, 2);
          }
          if (typeof pollJson.chunks === 'string' && pollJson.chunks.trim()) return pollJson.chunks;
          if (pollJson.chunks && typeof pollJson.chunks === 'object') {
            return JSON.stringify(pollJson.chunks, null, 2);
          }
          if (typeof pollJson.extraction_schema_json === 'string' && pollJson.extraction_schema_json.trim()) {
            return pollJson.extraction_schema_json;
          }
          return '';
        })();
        const pageCount = typeof pollJson.page_count === 'number' ? pollJson.page_count : undefined;
        const pagesValue = pollJson.pages;
        const pages = Array.isArray(pagesValue) && pagesValue.every((page) => typeof page === 'string')
          ? pagesValue
          : (outputText ? [outputText] : []);
        return {
          pages,
          fullText: pages.filter(Boolean).join('\n\n'),
          pageCount,
        };
      }

      if (status === 'failed' || status === 'error') {
        const err = pollJson.error || pollJson.message || pollJson.detail || 'Datalab OCR failed';
        throw new AppError(502, 'PROVIDER_ERROR', String(err), { body: pollJson });
      }

      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('abort')) {
      throw new AppError(504, 'PROVIDER_ERROR', 'Datalab timeout');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJsonOrThrow(res: Response, providerName: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  const sanitizedText = text.replace(/^\uFEFF/, '');
  try {
    const parsed = JSON.parse(sanitizedText);
    return asRecord(parsed);
  } catch {
    const contentType = res.headers.get('content-type');
    const snippet = sanitizedText.trim().replace(/\s+/g, ' ').slice(0, 240);
    const message = `${providerName} returned non-JSON response (status ${res.status}${contentType ? `, content-type ${contentType}` : ''}${snippet ? `, snippet ${JSON.stringify(snippet)}` : ''})`;
    throw new AppError(502, 'PROVIDER_ERROR', message, {
      status: res.status,
      contentType,
      body: text.slice(0, 2000),
    });
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  // TextDecoder is globally available in Node 18+.
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

function mineruHeaders(config: { apiKey: string; userToken: string }): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: buildAuthorization(config.apiKey, 'Bearer'),
    token: config.userToken,
  };
}

async function mineruExtract(
  config: { baseUrl: string; apiKey: string; userToken: string },
  params: MineruOcrParams,
  file: { buffer: Buffer; mimeType: string; filename: string; dataId: string }
): Promise<{ pages: string[]; fullText: string; pageCount?: number }> {
  const headers = mineruHeaders({ apiKey: config.apiKey, userToken: config.userToken });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  const started = Date.now();

  let tempObjectKey: string | null = null;
  let s3: ReturnType<typeof getS3Client> | null = null;

  try {
    if (!isS3Configured()) {
      throw new AppError(500, 'INTERNAL_ERROR', 'S3 storage is not configured (required for MinerU file OCR)');
    }

    s3 = getS3Client();

    const ext = (() => {
      const parts = file.filename.split('.');
      const raw = parts.length > 1 ? parts[parts.length - 1].trim().toLowerCase() : '';
      const cleaned = raw.replace(/[^a-z0-9]/g, '');
      return cleaned && cleaned.length <= 10 ? cleaned : '';
    })();

    tempObjectKey = `tmp/ocr/mineru/${file.dataId}_${randomUUID()}${ext ? `.${ext}` : ''}`;

    await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: tempObjectKey,
        Body: file.buffer,
        ContentType: file.mimeType || 'application/octet-stream',
      })
    );

    const sourceUrl = await getSignedUrl(
      s3.client,
      new GetObjectCommand({
        Bucket: s3.bucket,
        Key: tempObjectKey,
      }),
      { expiresIn: 3600 }
    );

    const extractUrl = joinUrl(config.baseUrl, '/extract/task');
    const body: Record<string, unknown> = {
      url: sourceUrl,
      model_version: params.modelVersion,
      data_id: file.dataId,
    };

    // These flags only apply to the pipeline model (and non-html files), but MinerU safely ignores unsupported fields.
    body.is_ocr = params.isOcr;
    body.enable_formula = params.enableFormula;
    body.enable_table = params.enableTable;
    if (params.language) body.language = params.language;
    if (params.pageRanges) body.page_ranges = params.pageRanges;
    if (Array.isArray(params.extraFormats) && params.extraFormats.length > 0) body.extra_formats = params.extraFormats;

    console.log(`[OCR:MinerU] Submitting extract task: ${extractUrl}`);

    const submitRes = await fetch(extractUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    let submitJson = await parseJsonOrThrow(submitRes, 'MinerU');
    const submitCode = submitJson.code as number | string | undefined;
    if (!submitRes.ok || submitCode !== 0) {
      const message = typeof submitJson.msg === 'string' ? submitJson.msg : 'MinerU extract task submit failed';
      throw new AppError(502, 'PROVIDER_ERROR', message, { status: submitRes.status, body: submitJson });
    }

    const submitData = asRecord(submitJson.data);
    const taskId =
      typeof submitData.task_id === 'string'
        ? submitData.task_id
        : (typeof submitData.taskId === 'string' ? submitData.taskId : null);
    if (typeof taskId !== 'string' || !taskId.trim()) {
      throw new AppError(502, 'PROVIDER_ERROR', 'MinerU did not return task_id', { body: submitJson });
    }

    while (true) {
      const currentData = asRecord(submitJson.data);
      const state = String(currentData.state || '').toLowerCase();
      const fullZipUrl = currentData.full_zip_url ?? currentData.fullZipUrl;

      if (state === 'done') {
        if (typeof fullZipUrl !== 'string' || !fullZipUrl) {
          throw new AppError(502, 'PROVIDER_ERROR', 'MinerU task completed without full_zip_url', { body: submitJson });
        }

        console.log(`[OCR:MinerU] Task done in ${Date.now() - started}ms, downloading zip...`);
        const zipRes = await fetch(normalizeMineruZipUrl(fullZipUrl), { method: 'GET', signal: controller.signal });
        if (!zipRes.ok) {
          const zipText = await zipRes.text().catch(() => '');
          throw new AppError(502, 'PROVIDER_ERROR', `MinerU zip download failed (status ${zipRes.status})`, { status: zipRes.status, body: zipText.slice(0, 2000) });
        }

        const zipBytes = new Uint8Array(await zipRes.arrayBuffer());
        const extracted = unzipSync(zipBytes);
        const entries = Object.entries(extracted);

        const pickLargestTextFile = (suffix: string) =>
          entries
            .filter(([name]) => name.toLowerCase().endsWith(suffix))
            .sort((a, b) => (b[1]?.length ?? 0) - (a[1]?.length ?? 0))[0];

        const md = pickLargestTextFile('.md') || pickLargestTextFile('.txt');
        if (!md) {
          const names = entries.map(([n]) => n).slice(0, 50);
          throw new AppError(502, 'PROVIDER_ERROR', 'MinerU zip does not contain markdown/text output', { files: names });
        }

        const markdown = decodeUtf8(md[1]).trim();
        return {
          pages: markdown ? [markdown] : [],
          fullText: markdown,
        };
      }

      if (state === 'failed' || state === 'error') {
        const err = currentData.err_msg ?? currentData.errMsg ?? submitJson.msg ?? 'MinerU OCR failed';
        throw new AppError(502, 'PROVIDER_ERROR', String(err), { body: submitJson });
      }

      if (Date.now() - started > 180_000) {
        throw new AppError(504, 'PROVIDER_ERROR', 'MinerU timeout (180s)');
      }

      // pending / running / converting
      await new Promise((r) => setTimeout(r, 1000));

      const pollUrl = joinUrl(config.baseUrl, `/extract/task/${encodeURIComponent(taskId)}`);
      const pollRes = await fetch(pollUrl, { method: 'GET', headers, signal: controller.signal });
      submitJson = await parseJsonOrThrow(pollRes, 'MinerU');
      const pollCode = submitJson.code as number | string | undefined;
      if (!pollRes.ok || pollCode !== 0) {
        const message = typeof submitJson.msg === 'string' ? submitJson.msg : 'MinerU task poll failed';
        throw new AppError(502, 'PROVIDER_ERROR', message, { status: pollRes.status, body: submitJson });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('abort')) {
      throw new AppError(504, 'PROVIDER_ERROR', 'MinerU timeout (180s)');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    if (s3 && tempObjectKey) {
      try {
        await s3.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: tempObjectKey }));
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

export class OcrService {
  private async getSettingRow(userId: string) {
    return prisma.ocrProviderSetting.findUnique({ where: { userId } });
  }

  private async getSystemDefaults(): Promise<{
    paddle: { baseUrl: string | null; apiKey: string | null };
    paddle_vl: { baseUrl: string | null; apiKey: string | null };
    paddle_vl_1_5: { baseUrl: string | null; apiKey: string | null };
    datalab: { baseUrl: string | null; apiKey: string | null };
    mineru: { baseUrl: string | null; apiKey: string | null };
  }> {
    const rows = await prisma.ocrSystemProviderConfig.findMany();
    const byProvider = new Map(rows.map((r) => [r.provider as OcrProvider, r]));

    const paddleRow = byProvider.get('paddle') ?? null;
    const paddleVlRow = byProvider.get('paddle_vl') ?? null;
    const paddleVl15Row = byProvider.get('paddle_vl_1_5') ?? null;
    const datalabRow = byProvider.get('datalab') ?? null;
    const mineruRow = byProvider.get('mineru') ?? null;

    return {
      paddle: {
        baseUrl: normalizeBaseUrl(paddleRow?.baseUrl ?? null),
        apiKey: safeDecrypt(paddleRow?.apiKey ?? null),
      },
      paddle_vl: {
        baseUrl: normalizeBaseUrl(paddleVlRow?.baseUrl ?? null),
        apiKey: safeDecrypt(paddleVlRow?.apiKey ?? null),
      },
      paddle_vl_1_5: {
        baseUrl: normalizeBaseUrl(paddleVl15Row?.baseUrl ?? null),
        apiKey: safeDecrypt(paddleVl15Row?.apiKey ?? null),
      },
      datalab: {
        baseUrl: normalizeBaseUrl(datalabRow?.baseUrl ?? null),
        apiKey: safeDecrypt(datalabRow?.apiKey ?? null),
      },
      mineru: {
        baseUrl: normalizeBaseUrl(mineruRow?.baseUrl ?? null),
        apiKey: safeDecrypt(mineruRow?.apiKey ?? null),
      },
    };
  }

  private async resolveEffectiveConfig(
    userId: string,
    override?: Partial<{
      provider: OcrProvider;
      credentialSource: OcrCredentialSource;
      baseUrl: string | null;
      apiKey: string | null;
      enabled: boolean;
      datalab: Partial<DatalabOcrParams>;
      paddle: Partial<PaddleOcrParams>;
      paddle_vl: Partial<PaddleVlOcrParams>;
      mineru: Partial<MineruOcrParams>;
    }>
  ): Promise<EffectiveOcrConfig> {
    const system = await this.getSystemDefaults();
    const row = await this.getSettingRow(userId);

    const rowProvider = (row?.provider as OcrProvider | undefined) ?? 'paddle';
    const requestedProvider = override?.provider ?? rowProvider;
    const credentialSource = override?.credentialSource ?? (row?.credentialSource as OcrCredentialSource | undefined) ?? 'system';
    const providerParams = row?.providerParams ?? null;
    const enabledByProvider = normalizeProviderEnabledMap(providerParams, rowProvider, row?.enabled ?? false);
    const provider = override?.provider
      ? requestedProvider
      : (enabledByProvider[requestedProvider] ? requestedProvider : (pickFirstEnabledProvider(enabledByProvider) ?? requestedProvider));
    const enabled = override?.enabled ?? enabledByProvider[provider];

    const mineruFromRow = normalizeMineruParams(userId, providerParams);
    const mineruOverride = override?.mineru;
    const mineru: MineruOcrParams = mineruOverride
      ? {
          ...mineruFromRow,
          ...(mineruOverride.userToken !== undefined ? { userToken: mineruOverride.userToken ? mineruOverride.userToken.trim() : null } : {}),
          ...(mineruOverride.modelVersion === 'vlm' || mineruOverride.modelVersion === 'pipeline' ? { modelVersion: mineruOverride.modelVersion } : {}),
          ...(typeof mineruOverride.isOcr === 'boolean' ? { isOcr: mineruOverride.isOcr } : {}),
          ...(typeof mineruOverride.enableFormula === 'boolean' ? { enableFormula: mineruOverride.enableFormula } : {}),
          ...(typeof mineruOverride.enableTable === 'boolean' ? { enableTable: mineruOverride.enableTable } : {}),
          ...(typeof mineruOverride.language === 'string' && mineruOverride.language.trim() ? { language: mineruOverride.language.trim() } : {}),
          ...(Array.isArray(mineruOverride.extraFormats) ? { extraFormats: mineruOverride.extraFormats } : {}),
          ...(mineruOverride.pageRanges !== undefined
            ? { pageRanges: typeof mineruOverride.pageRanges === 'string' && mineruOverride.pageRanges.trim() ? mineruOverride.pageRanges.trim() : null }
            : {}),
        }
      : mineruFromRow;

    const datalabFromRow = normalizeDatalabParams(providerParams);
    const datalab = mergeDatalabParams(datalabFromRow, override?.datalab);

    const paddleFromRow = normalizePaddleParams(providerParams);
    const paddle = mergePaddleParams(paddleFromRow, override?.paddle);

    const paddleVlFromRow = normalizePaddleVlParams(providerParams);
    const paddle_vl = mergePaddleVlParams(paddleVlFromRow, override?.paddle_vl);

    if (credentialSource === 'system') {
      const defaults = provider === 'datalab'
        ? system.datalab
        : (provider === 'mineru'
          ? system.mineru
          : (provider === 'paddle_vl'
            ? system.paddle_vl
            : (provider === 'paddle_vl_1_5' ? system.paddle_vl_1_5 : system.paddle)));
      return {
        enabled,
        provider,
        credentialSource,
        baseUrl: defaults.baseUrl,
        apiKey: defaults.apiKey,
        datalab,
        paddle,
        paddle_vl,
        mineru,
      };
    }

    const baseUrl = normalizeBaseUrl(override?.baseUrl ?? (row?.baseUrl ?? null));
    const apiKeyEncrypted = row?.apiKey ?? null;
    const overrideApiKey = override?.apiKey ?? null;

    const apiKey = overrideApiKey && overrideApiKey.trim()
      ? overrideApiKey.trim()
      : (apiKeyEncrypted ? decrypt(apiKeyEncrypted) : null);

    return {
      enabled,
      provider,
      credentialSource,
      baseUrl,
      apiKey,
      datalab,
      paddle,
      paddle_vl,
      mineru,
    };
  }

  async getSettings(userId: string): Promise<OcrProviderSettings> {
    const system = await this.getSystemDefaults();
    const row = await this.getSettingRow(userId);
    const provider = (row?.provider as OcrProvider | undefined) ?? 'paddle';
    const credentialSource = (row?.credentialSource as OcrCredentialSource | undefined) ?? 'system';
    const providerEnabled = normalizeProviderEnabledMap(row?.providerParams ?? null, provider, row?.enabled ?? false);

    const effective = await this.resolveEffectiveConfig(userId, { provider });

    const hasApiKey = effective.credentialSource === 'system'
      ? !!effective.apiKey
      : !!(row?.apiKey);

    return {
      enabled: providerEnabled[provider],
      providerEnabled,
      provider,
      credentialSource,
      baseUrl: effective.baseUrl,
      hasApiKey,
      apiKeyLast4: row?.apiKeyLast4 ?? null,
      datalab: effective.datalab,
      paddle: effective.paddle,
      paddle_vl: effective.paddle_vl,
      mineru: effective.mineru,
      systemDefaults: {
        paddle: { baseUrl: system.paddle.baseUrl },
        paddle_vl: { baseUrl: system.paddle_vl.baseUrl },
        paddle_vl_1_5: { baseUrl: system.paddle_vl_1_5.baseUrl },
        datalab: { baseUrl: system.datalab.baseUrl },
        mineru: { baseUrl: system.mineru.baseUrl },
      },
    };
  }

  async updateSettings(userId: string, data: UpdateOcrProviderSettingsDto): Promise<OcrProviderSettings> {
    const row = await this.getSettingRow(userId);

    const rowProvider = (row?.provider as OcrProvider | undefined) ?? 'paddle';
    const nextProvider: OcrProvider = (data.provider ?? (row?.provider as OcrProvider | undefined) ?? 'paddle');
    const nextCredentialSource: OcrCredentialSource = (data.credentialSource ?? (row?.credentialSource as OcrCredentialSource | undefined) ?? 'system');

    const update: {
      enabled?: boolean;
      provider?: OcrProvider;
      credentialSource?: OcrCredentialSource;
      baseUrl?: string | null;
      apiKey?: string | null;
      apiKeyLast4?: string | null;
      providerParams?: Prisma.JsonObject;
    } = {};
    if (data.provider) update.provider = data.provider;
    if (data.credentialSource) update.credentialSource = data.credentialSource;

    const existingParams = row?.providerParams ?? null;
    const nextProviderParams: Record<string, unknown> =
      existingParams && typeof existingParams === 'object' && !Array.isArray(existingParams)
        ? { ...(existingParams as Record<string, unknown>) }
        : {};
    let hasProviderParamsUpdate = false;
    const nextProviderEnabled = normalizeProviderEnabledMap(existingParams, rowProvider, row?.enabled ?? false);
    let providerEnabledChanged = false;

    if (isRecord(data.providerEnabled)) {
      for (const provider of OCR_PROVIDERS) {
        const raw = data.providerEnabled[provider];
        if (typeof raw === 'boolean') {
          nextProviderEnabled[provider] = raw;
          providerEnabledChanged = true;
        }
      }
    }

    if (typeof data.enabled === 'boolean') {
      nextProviderEnabled[nextProvider] = data.enabled;
      providerEnabledChanged = true;
    }

    if (providerEnabledChanged) {
      nextProviderParams.providerEnabled = nextProviderEnabled;
      hasProviderParamsUpdate = true;
    }

    if (
      providerEnabledChanged ||
      (data.provider !== undefined && data.provider !== rowProvider) ||
      (row?.enabled ?? false) !== nextProviderEnabled[nextProvider]
    ) {
      update.enabled = nextProviderEnabled[nextProvider];
    }

    if (data.mineru) {
      const current = normalizeMineruParams(userId, existingParams);
      const next: MineruOcrParams = {
        ...current,
        ...(data.mineru.userToken !== undefined ? { userToken: typeof data.mineru.userToken === 'string' ? (data.mineru.userToken.trim() || null) : null } : {}),
        ...(data.mineru.modelVersion === 'vlm' || data.mineru.modelVersion === 'pipeline' ? { modelVersion: data.mineru.modelVersion } : {}),
        ...(typeof data.mineru.isOcr === 'boolean' ? { isOcr: data.mineru.isOcr } : {}),
        ...(typeof data.mineru.enableFormula === 'boolean' ? { enableFormula: data.mineru.enableFormula } : {}),
        ...(typeof data.mineru.enableTable === 'boolean' ? { enableTable: data.mineru.enableTable } : {}),
        ...(typeof data.mineru.language === 'string' && data.mineru.language.trim() ? { language: data.mineru.language.trim() } : {}),
        ...(Array.isArray(data.mineru.extraFormats) ? { extraFormats: Array.from(new Set(data.mineru.extraFormats)) } : {}),
        ...(data.mineru.pageRanges !== undefined
          ? { pageRanges: typeof data.mineru.pageRanges === 'string' && data.mineru.pageRanges.trim() ? data.mineru.pageRanges.trim() : null }
          : {}),
      };

      nextProviderParams.mineru = next;
      hasProviderParamsUpdate = true;
    }

    if (data.paddle) {
      const current = normalizePaddleParams(existingParams);
      nextProviderParams.paddle = mergePaddleParams(current, data.paddle);
      hasProviderParamsUpdate = true;
    }

    if (data.paddle_vl) {
      const current = normalizePaddleVlParams(existingParams);
      nextProviderParams.paddle_vl = mergePaddleVlParams(current, data.paddle_vl);
      hasProviderParamsUpdate = true;
    }

    if (data.datalab) {
      const current = normalizeDatalabParams(existingParams);
      nextProviderParams.datalab = mergeDatalabParams(current, data.datalab);
      hasProviderParamsUpdate = true;
    }

    if (hasProviderParamsUpdate) {
      update.providerParams = nextProviderParams as Prisma.JsonObject;
    }

    if (nextCredentialSource === 'custom') {
      if (data.baseUrl !== undefined) {
        update.baseUrl = normalizeBaseUrl(data.baseUrl);
      }

      if (typeof data.apiKey === 'string' && data.apiKey.trim()) {
        update.apiKey = encrypt(data.apiKey.trim());
        update.apiKeyLast4 = last4(data.apiKey);
      }

      // If switching to custom and provider is datalab, require a key eventually (test will fail otherwise).
      const baseUrl = normalizeBaseUrl(update.baseUrl ?? row?.baseUrl ?? null);
      if (!baseUrl) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Base URL is required for custom OCR provider');
      }
      if (nextProvider === 'datalab') {
        const hasKey = !!(update.apiKey ?? row?.apiKey);
        if (!hasKey) {
          throw new AppError(400, 'VALIDATION_ERROR', 'API key is required for Datalab');
        }
      }
      if (nextProvider === 'mineru') {
        const hasKey = !!(update.apiKey ?? row?.apiKey);
        if (!hasKey) {
          throw new AppError(400, 'VALIDATION_ERROR', 'API key is required for MinerU');
        }
      }
    } else {
      // System credentials: keep DB clean (do not persist keys or base URL).
      update.baseUrl = null;
      update.apiKey = null;
      update.apiKeyLast4 = null;
    }

    await prisma.ocrProviderSetting.upsert({
      where: { userId },
      update,
      create: {
        user: { connect: { id: userId } },
        enabled: update.enabled ?? false,
        provider: nextProvider,
        credentialSource: nextCredentialSource,
        baseUrl: update.baseUrl ?? null,
        apiKey: update.apiKey ?? null,
        apiKeyLast4: update.apiKeyLast4 ?? null,
        providerParams: update.providerParams ?? {},
      },
    });

    return this.getSettings(userId);
  }

  async getSystemSettings(): Promise<OcrSystemProviderSettings> {
    const rows = await prisma.ocrSystemProviderConfig.findMany();
    const byProvider = new Map(rows.map((r) => [r.provider as OcrProvider, r]));

    const toConfig = (provider: OcrProvider) => {
      const row = byProvider.get(provider) ?? null;
      return {
        baseUrl: normalizeBaseUrl(row?.baseUrl ?? null),
        hasApiKey: !!row?.apiKey,
        apiKeyLast4: row?.apiKeyLast4 ?? null,
      };
    };

    return {
      paddle: toConfig('paddle'),
      paddle_vl: toConfig('paddle_vl'),
      paddle_vl_1_5: toConfig('paddle_vl_1_5'),
      datalab: toConfig('datalab'),
      mineru: toConfig('mineru'),
    };
  }

  async updateSystemSettings(data: UpdateOcrSystemProviderSettingsDto): Promise<OcrSystemProviderSettings> {
    const entries: Array<{
      provider: OcrProvider;
      config: { baseUrl?: string | null; apiKey?: string | null };
    }> = [];

    if (data.paddle) entries.push({ provider: 'paddle', config: data.paddle });
    if (data.paddle_vl) entries.push({ provider: 'paddle_vl', config: data.paddle_vl });
    if (data.paddle_vl_1_5) entries.push({ provider: 'paddle_vl_1_5', config: data.paddle_vl_1_5 });
    if (data.datalab) entries.push({ provider: 'datalab', config: data.datalab });
    if (data.mineru) entries.push({ provider: 'mineru', config: data.mineru });

    for (const { provider, config } of entries) {
      const update: Record<string, unknown> = {};

      if (Object.prototype.hasOwnProperty.call(config, 'baseUrl')) {
        update.baseUrl = normalizeBaseUrl(config.baseUrl ?? null);
      }

      if (Object.prototype.hasOwnProperty.call(config, 'apiKey')) {
        const raw = config.apiKey;
        if (raw === null) {
          update.apiKey = null;
          update.apiKeyLast4 = null;
        } else if (typeof raw === 'string') {
          const trimmed = raw.trim();
          if (!trimmed) {
            update.apiKey = null;
            update.apiKeyLast4 = null;
          } else {
            update.apiKey = encrypt(trimmed);
            update.apiKeyLast4 = last4(trimmed);
          }
        }
      }

      if (Object.keys(update).length === 0) continue;

      await prisma.ocrSystemProviderConfig.upsert({
        where: { provider },
        update,
        create: {
          provider,
          baseUrl: (update.baseUrl as string | null | undefined) ?? null,
          apiKey: (update.apiKey as string | null | undefined) ?? null,
          apiKeyLast4: (update.apiKeyLast4 as string | null | undefined) ?? null,
        },
      });
    }

    return this.getSystemSettings();
  }

  async test(
    userId: string,
    file: { buffer: Buffer; mimeType: string; filename: string },
    override?: Partial<{ provider: OcrProvider; credentialSource: OcrCredentialSource; baseUrl: string | null; apiKey: string | null }>
  ): Promise<OcrTestResult> {
    const effective = await this.resolveEffectiveConfig(userId, override);

    if (!effective.baseUrl) {
      return {
        success: false,
        provider: effective.provider,
        latencyMs: 0,
        error: 'OCR provider base URL is not configured',
      };
    }

    if (effective.provider === 'datalab' && !effective.apiKey) {
      return {
        success: false,
        provider: effective.provider,
        latencyMs: 0,
        error: 'Datalab API key is not configured',
      };
    }

    if (effective.provider === 'mineru' && !effective.apiKey) {
      return {
        success: false,
        provider: effective.provider,
        latencyMs: 0,
        error: 'MinerU API key is not configured',
      };
    }

    if ((effective.provider === 'paddle' || effective.provider === 'paddle_vl' || effective.provider === 'paddle_vl_1_5') && !effective.apiKey && effective.baseUrl && paddleRequiresToken(effective.baseUrl)) {
      return {
        success: false,
        provider: effective.provider,
        latencyMs: 0,
        error: 'PaddleOCR token is not configured',
      };
    }

    const started = Date.now();
    try {
      if (effective.provider === 'paddle') {
        const { pages, fullText } = await paddleOcrExtract(
          { baseUrl: effective.baseUrl, apiKey: effective.apiKey },
          { buffer: file.buffer, mimeType: file.mimeType },
          effective.paddle
        );

        const latencyMs = Date.now() - started;
        const previewText = fullText.slice(0, OCR_TEST_PREVIEW_LIMIT);

        return {
          success: true,
          provider: 'paddle',
          latencyMs,
          pageCount: pages.length || undefined,
          charCount: fullText.length,
          previewText,
          pagesPreview: pages.slice(0, 5).map((p) => p.slice(0, 500)),
        };
      }

      if (effective.provider === 'paddle_vl') {
        const { pages, fullText } = await paddleOcrVlExtract(
          { baseUrl: effective.baseUrl, apiKey: effective.apiKey },
          { buffer: file.buffer, mimeType: file.mimeType },
          effective.paddle_vl
        );

        const latencyMs = Date.now() - started;
        const previewText = fullText.slice(0, OCR_TEST_PREVIEW_LIMIT);

        return {
          success: true,
          provider: 'paddle_vl',
          latencyMs,
          pageCount: pages.length || undefined,
          charCount: fullText.length,
          previewText,
          pagesPreview: pages.slice(0, 5).map((p) => p.slice(0, 500)),
        };
      }

      if (effective.provider === 'paddle_vl_1_5') {
        const { pages, fullText } = await paddleOcrVlExtract(
          { baseUrl: effective.baseUrl, apiKey: effective.apiKey },
          { buffer: file.buffer, mimeType: file.mimeType },
          effective.paddle_vl
        );

        const latencyMs = Date.now() - started;
        const previewText = fullText.slice(0, OCR_TEST_PREVIEW_LIMIT);

        return {
          success: true,
          provider: 'paddle_vl_1_5',
          latencyMs,
          pageCount: pages.length || undefined,
          charCount: fullText.length,
          previewText,
          pagesPreview: pages.slice(0, 5).map((p) => p.slice(0, 500)),
        };
      }

      if (effective.provider === 'mineru') {
        const { pages, fullText } = await mineruExtract(
          {
            baseUrl: effective.baseUrl,
            apiKey: effective.apiKey!,
            userToken: effective.mineru.userToken || userId,
          },
          effective.mineru,
          {
            buffer: file.buffer,
            mimeType: file.mimeType,
            filename: file.filename,
            dataId: toMineruDataId(`test_${Date.now()}`),
          }
        );

        const latencyMs = Date.now() - started;
        const previewText = fullText.slice(0, OCR_TEST_PREVIEW_LIMIT);

        return {
          success: true,
          provider: 'mineru',
          latencyMs,
          pageCount: pages.length || undefined,
          charCount: fullText.length,
          previewText,
          pagesPreview: pages.slice(0, 5).map((p) => p.slice(0, 500)),
        };
      }

      const { pages, fullText, pageCount } = await datalabExtract(
        { baseUrl: effective.baseUrl, apiKey: effective.apiKey! },
        effective.datalab,
        file
      );

      const latencyMs = Date.now() - started;
      const previewText = fullText.slice(0, OCR_TEST_PREVIEW_LIMIT);

      return {
        success: true,
        provider: 'datalab',
        latencyMs,
        pageCount: pageCount ?? (pages.length || undefined),
        charCount: fullText.length,
        previewText,
        pagesPreview: pages.slice(0, 5).map((p) => p.slice(0, 500)),
      };
    } catch (error) {
      const latencyMs = Date.now() - started;
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        provider: effective.provider,
        latencyMs,
        error: message,
      };
    }
  }

  async getResults(
    userId: string,
    fileIds: string[],
    provider?: OcrProvider
  ): Promise<Array<{
    fileId: string;
    provider: OcrProvider;
    status: 'success' | 'failed';
    errorMessage: string | null;
    fullText: string;
    pages: string[] | null;
    createdAt: string;
  }>> {
    const uniqueIds = Array.from(new Set(fileIds.filter((id) => typeof id === 'string' && id.trim())));
    if (uniqueIds.length === 0) return [];

    const results = await prisma.ocrResult.findMany({
      where: {
        userId,
        fileId: { in: uniqueIds },
        ...(provider ? { provider } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    return results.map((row) => ({
      fileId: row.fileId,
      provider: row.provider as OcrProvider,
      status: row.status as 'success' | 'failed',
      errorMessage: row.errorMessage ?? null,
      fullText: row.fullText || '',
      pages: Array.isArray(row.pages) ? (row.pages as unknown as string[]) : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async extractForFile(
    userId: string,
    fileId: string,
    override?: Partial<{ provider: OcrProvider }>
  ): Promise<{ provider: OcrProvider; pages: string[]; fullText: string }> {
    const effective = await this.resolveEffectiveConfig(userId, override?.provider ? { provider: override.provider } : undefined);

    if (!effective.enabled) {
      throw new AppError(400, 'INVALID_REQUEST', 'OCR is disabled');
    }

    if (!effective.baseUrl) {
      throw new AppError(400, 'INVALID_REQUEST', 'OCR provider base URL is not configured');
    }

    if (effective.provider === 'datalab' && !effective.apiKey) {
      throw new AppError(400, 'INVALID_REQUEST', 'Datalab API key is not configured');
    }

    if (effective.provider === 'mineru' && !effective.apiKey) {
      throw new AppError(400, 'INVALID_REQUEST', 'MinerU API key is not configured');
    }

    if ((effective.provider === 'paddle' || effective.provider === 'paddle_vl' || effective.provider === 'paddle_vl_1_5') && !effective.apiKey && paddleRequiresToken(effective.baseUrl)) {
      throw new AppError(400, 'INVALID_REQUEST', 'PaddleOCR token is not configured');
    }

    const existing = await prisma.ocrResult.findUnique({
      where: {
        userId_fileId_provider: {
          userId,
          fileId,
          provider: effective.provider,
        },
      },
    });

    if (existing && existing.status === 'success' && existing.fullText) {
      const pages = Array.isArray(existing.pages) ? (existing.pages as unknown as string[]) : [];
      return { provider: effective.provider, pages, fullText: existing.fullText };
    }

    const { meta, buffer } = await filesService.downloadBuffer(userId, fileId);
    const mimeType = meta.mimeType;
    const filename = meta.originalName;

    if (!(mimeType === 'application/pdf' || mimeType.startsWith('image/'))) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Only PDF and image files are supported for OCR');
    }

    try {
      let pages: string[] = [];
      let fullText = '';

      if (effective.provider === 'paddle') {
        const result = await paddleOcrExtract(
          { baseUrl: effective.baseUrl, apiKey: effective.apiKey },
          { buffer, mimeType },
          effective.paddle
        );
        pages = result.pages;
        fullText = result.fullText;
      } else if (effective.provider === 'paddle_vl') {
        const result = await paddleOcrVlExtract(
          { baseUrl: effective.baseUrl, apiKey: effective.apiKey },
          { buffer, mimeType },
          effective.paddle_vl
        );
        pages = result.pages;
        fullText = result.fullText;
      } else if (effective.provider === 'paddle_vl_1_5') {
        const result = await paddleOcrVlExtract(
          { baseUrl: effective.baseUrl, apiKey: effective.apiKey },
          { buffer, mimeType },
          effective.paddle_vl
        );
        pages = result.pages;
        fullText = result.fullText;
      } else if (effective.provider === 'mineru') {
        const result = await mineruExtract(
          {
            baseUrl: effective.baseUrl,
            apiKey: effective.apiKey!,
            userToken: effective.mineru.userToken || userId,
          },
          effective.mineru,
          {
            buffer,
            mimeType,
            filename,
            dataId: toMineruDataId(fileId),
          }
        );
        pages = result.pages;
        fullText = result.fullText;
      } else {
        const result = await datalabExtract(
          { baseUrl: effective.baseUrl, apiKey: effective.apiKey! },
          effective.datalab,
          { buffer, mimeType, filename }
        );
        pages = result.pages;
        fullText = result.fullText;
      }

      await prisma.ocrResult.upsert({
        where: {
          userId_fileId_provider: {
            userId,
            fileId,
            provider: effective.provider,
          },
        },
        update: {
          status: 'success',
          errorMessage: null,
          fullText,
          pages: pages as Prisma.JsonArray,
        },
        create: {
          user: { connect: { id: userId } },
          file: { connect: { id: fileId } },
          provider: effective.provider,
          status: 'success',
          errorMessage: null,
          fullText,
          pages: pages as Prisma.JsonArray,
        },
      });

      return { provider: effective.provider, pages, fullText };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OCR failed';

      await prisma.ocrResult.upsert({
        where: {
          userId_fileId_provider: {
            userId,
            fileId,
            provider: effective.provider,
          },
        },
        update: {
          status: 'failed',
          errorMessage: message,
          fullText: '',
          pages: Prisma.DbNull,
        },
        create: {
          user: { connect: { id: userId } },
          file: { connect: { id: fileId } },
          provider: effective.provider,
          status: 'failed',
          errorMessage: message,
          fullText: '',
          pages: Prisma.DbNull,
        },
      });

      throw new AppError(502, 'PROVIDER_ERROR', message, { stage: 'ocr', provider: effective.provider });
    }
  }
}

export const ocrService = new OcrService();
