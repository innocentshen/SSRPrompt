export type OcrProvider = 'paddle' | 'paddle_vl' | 'paddle_vl_1_5' | 'datalab' | 'mineru';
export type OcrCredentialSource = 'system' | 'custom';
export type MineruModelVersion = 'pipeline' | 'vlm';
export type DatalabOcrMode = 'fast' | 'balanced' | 'accurate';
export interface MineruOcrParams {
    userToken: string | null;
    modelVersion: MineruModelVersion;
    isOcr: boolean;
    enableFormula: boolean;
    enableTable: boolean;
    language: string;
    extraFormats: string[];
    pageRanges: string | null;
}
export interface DatalabOcrParams {
    mode: DatalabOcrMode;
    maxPages: number | null;
    pageRange: string | null;
    paginate: boolean;
    addBlockIds: boolean;
    disableImageExtraction: boolean;
    disableImageCaptions: boolean;
    outputFormat: string | null;
    skipCache: boolean;
    saveCheckpoint: boolean;
    extras: string | null;
    additionalConfig: string | null;
}
export type PaddleDetLimitType = 'min' | 'max';
export interface PaddleOcrParams {
    useDocOrientationClassify: boolean | null;
    useDocUnwarping: boolean | null;
    useTextlineOrientation: boolean | null;
    textDetLimitSideLen: number | null;
    textDetLimitType: PaddleDetLimitType | null;
    textDetThresh: number | null;
    textDetBoxThresh: number | null;
    textDetUnclipRatio: number | null;
    textRecScoreThresh: number | null;
    visualize: boolean | null;
}
export type PaddleVlLayoutMergeMode = 'large' | 'small' | 'union';
export interface PaddleVlOcrParams {
    useDocOrientationClassify: boolean | null;
    useDocUnwarping: boolean | null;
    useLayoutDetection: boolean | null;
    useChartRecognition: boolean | null;
    layoutThreshold: number | null;
    layoutNms: boolean | null;
    layoutUnclipRatio: number | null;
    layoutMergeBboxesMode: PaddleVlLayoutMergeMode | null;
    promptLabel: string | null;
    repetitionPenalty: number | null;
    temperature: number | null;
    topP: number | null;
    minPixels: number | null;
    maxPixels: number | null;
    showFormulaNumber: boolean | null;
    prettifyMarkdown: boolean | null;
    visualize: boolean | null;
}
export interface OcrProviderSettings {
    enabled: boolean;
    providerEnabled: Partial<Record<OcrProvider, boolean>>;
    provider: OcrProvider;
    credentialSource: OcrCredentialSource;
    baseUrl: string | null;
    hasApiKey: boolean;
    apiKeyLast4: string | null;
    mineru: MineruOcrParams;
    datalab: DatalabOcrParams;
    paddle: PaddleOcrParams;
    paddle_vl: PaddleVlOcrParams;
    systemDefaults: {
        paddle: {
            baseUrl: string | null;
        };
        paddle_vl: {
            baseUrl: string | null;
        };
        paddle_vl_1_5: {
            baseUrl: string | null;
        };
        datalab: {
            baseUrl: string | null;
        };
        mineru: {
            baseUrl: string | null;
        };
    };
}
export interface UpdateOcrProviderSettingsDto {
    enabled?: boolean;
    providerEnabled?: Partial<Record<OcrProvider, boolean>>;
    provider?: OcrProvider;
    credentialSource?: OcrCredentialSource;
    baseUrl?: string | null;
    apiKey?: string | null;
    datalab?: Partial<DatalabOcrParams>;
    paddle?: Partial<PaddleOcrParams>;
    paddle_vl?: Partial<PaddleVlOcrParams>;
    mineru?: Partial<MineruOcrParams>;
}
export interface OcrSystemProviderConfig {
    baseUrl: string | null;
    hasApiKey: boolean;
    apiKeyLast4: string | null;
}
export interface OcrSystemProviderSettings {
    paddle: OcrSystemProviderConfig;
    paddle_vl: OcrSystemProviderConfig;
    paddle_vl_1_5: OcrSystemProviderConfig;
    datalab: OcrSystemProviderConfig;
    mineru: OcrSystemProviderConfig;
}
export interface UpdateOcrSystemProviderSettingsDto {
    paddle?: {
        baseUrl?: string | null;
        apiKey?: string | null;
    };
    paddle_vl?: {
        baseUrl?: string | null;
        apiKey?: string | null;
    };
    paddle_vl_1_5?: {
        baseUrl?: string | null;
        apiKey?: string | null;
    };
    datalab?: {
        baseUrl?: string | null;
        apiKey?: string | null;
    };
    mineru?: {
        baseUrl?: string | null;
        apiKey?: string | null;
    };
}
export interface OcrTestResult {
    success: boolean;
    provider: OcrProvider;
    latencyMs: number;
    pageCount?: number;
    charCount?: number;
    previewText?: string;
    pagesPreview?: string[];
    error?: string;
}
export type OcrStatus = 'success' | 'failed';
export interface OcrResultItem {
    fileId: string;
    provider: OcrProvider;
    status: OcrStatus;
    errorMessage: string | null;
    fullText: string;
    pages: string[] | null;
    createdAt: string;
}
export interface OcrResultsRequest {
    fileIds: string[];
    provider?: OcrProvider;
}
//# sourceMappingURL=ocr.d.ts.map