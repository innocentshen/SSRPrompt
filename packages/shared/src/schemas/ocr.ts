import { z } from 'zod';

export const OcrProviderSchema = z.enum(['paddle', 'paddle_vl', 'paddle_vl_1_5', 'datalab', 'mineru']);
export const OcrCredentialSourceSchema = z.enum(['system', 'custom']);

export const MineruModelVersionSchema = z.enum(['pipeline', 'vlm']);
export const DatalabOcrModeSchema = z.enum(['fast', 'balanced', 'accurate']);

export const MineruOcrParamsSchema = z.object({
  userToken: z.string().min(1).nullable().optional(),
  modelVersion: MineruModelVersionSchema.optional(),
  isOcr: z.boolean().optional(),
  enableFormula: z.boolean().optional(),
  enableTable: z.boolean().optional(),
  language: z.string().min(1).optional(),
  extraFormats: z.array(z.enum(['docx', 'html', 'latex'])).optional(),
  pageRanges: z.string().min(1).nullable().optional(),
});

export const DatalabOcrParamsSchema = z.object({
  mode: DatalabOcrModeSchema.optional(),
  maxPages: z.number().int().positive().nullable().optional(),
  pageRange: z.string().min(1).nullable().optional(),
  paginate: z.boolean().optional(),
  addBlockIds: z.boolean().optional(),
  disableImageExtraction: z.boolean().optional(),
  disableImageCaptions: z.boolean().optional(),
  outputFormat: z.string().min(1).nullable().optional(),
  skipCache: z.boolean().optional(),
  saveCheckpoint: z.boolean().optional(),
  extras: z.string().min(1).nullable().optional(),
  additionalConfig: z.string().min(1).nullable().optional(),
});

export const PaddleDetLimitTypeSchema = z.enum(['min', 'max']);

export const PaddleOcrParamsSchema = z.object({
  useDocOrientationClassify: z.boolean().nullable().optional(),
  useDocUnwarping: z.boolean().nullable().optional(),
  useTextlineOrientation: z.boolean().nullable().optional(),
  textDetLimitSideLen: z.number().int().positive().nullable().optional(),
  textDetLimitType: PaddleDetLimitTypeSchema.nullable().optional(),
  textDetThresh: z.number().min(0).nullable().optional(),
  textDetBoxThresh: z.number().min(0).nullable().optional(),
  textDetUnclipRatio: z.number().min(0).nullable().optional(),
  textRecScoreThresh: z.number().min(0).nullable().optional(),
  visualize: z.boolean().nullable().optional(),
});

export const PaddleVlLayoutMergeModeSchema = z.enum(['large', 'small', 'union']);

export const PaddleVlOcrParamsSchema = z.object({
  useDocOrientationClassify: z.boolean().nullable().optional(),
  useDocUnwarping: z.boolean().nullable().optional(),
  useLayoutDetection: z.boolean().nullable().optional(),
  useChartRecognition: z.boolean().nullable().optional(),
  layoutThreshold: z.number().min(0).max(1).nullable().optional(),
  layoutNms: z.boolean().nullable().optional(),
  layoutUnclipRatio: z.number().min(0).nullable().optional(),
  layoutMergeBboxesMode: PaddleVlLayoutMergeModeSchema.nullable().optional(),
  promptLabel: z.string().min(1).nullable().optional(),
  repetitionPenalty: z.number().min(0).nullable().optional(),
  temperature: z.number().min(0).nullable().optional(),
  topP: z.number().min(0).max(1).nullable().optional(),
  minPixels: z.number().int().min(1).nullable().optional(),
  maxPixels: z.number().int().min(1).nullable().optional(),
  showFormulaNumber: z.boolean().nullable().optional(),
  prettifyMarkdown: z.boolean().nullable().optional(),
  visualize: z.boolean().nullable().optional(),
});

export const OcrProviderEnabledSchema = z.object({
  paddle: z.boolean().optional(),
  paddle_vl: z.boolean().optional(),
  paddle_vl_1_5: z.boolean().optional(),
  datalab: z.boolean().optional(),
  mineru: z.boolean().optional(),
});

export const UpdateOcrProviderSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  providerEnabled: OcrProviderEnabledSchema.optional(),
  provider: OcrProviderSchema.optional(),
  credentialSource: OcrCredentialSourceSchema.optional(),
  baseUrl: z.string().url().nullable().optional(),
  apiKey: z.string().min(1).nullable().optional(),
  datalab: DatalabOcrParamsSchema.partial().optional(),
  paddle: PaddleOcrParamsSchema.partial().optional(),
  paddle_vl: PaddleVlOcrParamsSchema.partial().optional(),
  mineru: MineruOcrParamsSchema.partial().optional(),
});

export type UpdateOcrProviderSettingsInput = z.infer<typeof UpdateOcrProviderSettingsSchema>;

const UpdateOcrSystemProviderConfigSchema = z.object({
  baseUrl: z.string().url().nullable().optional(),
  apiKey: z.string().nullable().optional(),
});

export const UpdateOcrSystemProviderSettingsSchema = z.object({
  paddle: UpdateOcrSystemProviderConfigSchema.optional(),
  paddle_vl: UpdateOcrSystemProviderConfigSchema.optional(),
  paddle_vl_1_5: UpdateOcrSystemProviderConfigSchema.optional(),
  datalab: UpdateOcrSystemProviderConfigSchema.optional(),
  mineru: UpdateOcrSystemProviderConfigSchema.optional(),
});

export type UpdateOcrSystemProviderSettingsInput = z.infer<typeof UpdateOcrSystemProviderSettingsSchema>;

export const OcrResultsRequestSchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1),
  provider: OcrProviderSchema.optional(),
});

export type OcrResultsRequestInput = z.infer<typeof OcrResultsRequestSchema>;
