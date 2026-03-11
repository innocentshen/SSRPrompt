import { z } from 'zod';
export declare const OcrProviderSchema: z.ZodEnum<["paddle", "paddle_vl", "paddle_vl_1_5", "datalab", "mineru", "multimodal_model"]>;
export declare const OcrCredentialSourceSchema: z.ZodEnum<["system", "custom"]>;
export declare const MineruModelVersionSchema: z.ZodEnum<["pipeline", "vlm"]>;
export declare const DatalabOcrModeSchema: z.ZodEnum<["fast", "balanced", "accurate"]>;
export declare const MineruOcrParamsSchema: z.ZodObject<{
    userToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    modelVersion: z.ZodOptional<z.ZodEnum<["pipeline", "vlm"]>>;
    isOcr: z.ZodOptional<z.ZodBoolean>;
    enableFormula: z.ZodOptional<z.ZodBoolean>;
    enableTable: z.ZodOptional<z.ZodBoolean>;
    language: z.ZodOptional<z.ZodString>;
    extraFormats: z.ZodOptional<z.ZodArray<z.ZodEnum<["docx", "html", "latex"]>, "many">>;
    pageRanges: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    userToken?: string | null | undefined;
    modelVersion?: "pipeline" | "vlm" | undefined;
    isOcr?: boolean | undefined;
    enableFormula?: boolean | undefined;
    enableTable?: boolean | undefined;
    language?: string | undefined;
    extraFormats?: ("docx" | "html" | "latex")[] | undefined;
    pageRanges?: string | null | undefined;
}, {
    userToken?: string | null | undefined;
    modelVersion?: "pipeline" | "vlm" | undefined;
    isOcr?: boolean | undefined;
    enableFormula?: boolean | undefined;
    enableTable?: boolean | undefined;
    language?: string | undefined;
    extraFormats?: ("docx" | "html" | "latex")[] | undefined;
    pageRanges?: string | null | undefined;
}>;
export declare const DatalabOcrParamsSchema: z.ZodObject<{
    mode: z.ZodOptional<z.ZodEnum<["fast", "balanced", "accurate"]>>;
    maxPages: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    pageRange: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    paginate: z.ZodOptional<z.ZodBoolean>;
    addBlockIds: z.ZodOptional<z.ZodBoolean>;
    disableImageExtraction: z.ZodOptional<z.ZodBoolean>;
    disableImageCaptions: z.ZodOptional<z.ZodBoolean>;
    outputFormat: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    skipCache: z.ZodOptional<z.ZodBoolean>;
    saveCheckpoint: z.ZodOptional<z.ZodBoolean>;
    extras: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    additionalConfig: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    mode?: "fast" | "balanced" | "accurate" | undefined;
    maxPages?: number | null | undefined;
    pageRange?: string | null | undefined;
    paginate?: boolean | undefined;
    addBlockIds?: boolean | undefined;
    disableImageExtraction?: boolean | undefined;
    disableImageCaptions?: boolean | undefined;
    outputFormat?: string | null | undefined;
    skipCache?: boolean | undefined;
    saveCheckpoint?: boolean | undefined;
    extras?: string | null | undefined;
    additionalConfig?: string | null | undefined;
}, {
    mode?: "fast" | "balanced" | "accurate" | undefined;
    maxPages?: number | null | undefined;
    pageRange?: string | null | undefined;
    paginate?: boolean | undefined;
    addBlockIds?: boolean | undefined;
    disableImageExtraction?: boolean | undefined;
    disableImageCaptions?: boolean | undefined;
    outputFormat?: string | null | undefined;
    skipCache?: boolean | undefined;
    saveCheckpoint?: boolean | undefined;
    extras?: string | null | undefined;
    additionalConfig?: string | null | undefined;
}>;
export declare const PaddleDetLimitTypeSchema: z.ZodEnum<["min", "max"]>;
export declare const PaddleOcrParamsSchema: z.ZodObject<{
    useDocOrientationClassify: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    useDocUnwarping: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    useTextlineOrientation: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    textDetLimitSideLen: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    textDetLimitType: z.ZodOptional<z.ZodNullable<z.ZodEnum<["min", "max"]>>>;
    textDetThresh: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    textDetBoxThresh: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    textDetUnclipRatio: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    textRecScoreThresh: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    visualize: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    useDocOrientationClassify?: boolean | null | undefined;
    useDocUnwarping?: boolean | null | undefined;
    useTextlineOrientation?: boolean | null | undefined;
    textDetLimitSideLen?: number | null | undefined;
    textDetLimitType?: "min" | "max" | null | undefined;
    textDetThresh?: number | null | undefined;
    textDetBoxThresh?: number | null | undefined;
    textDetUnclipRatio?: number | null | undefined;
    textRecScoreThresh?: number | null | undefined;
    visualize?: boolean | null | undefined;
}, {
    useDocOrientationClassify?: boolean | null | undefined;
    useDocUnwarping?: boolean | null | undefined;
    useTextlineOrientation?: boolean | null | undefined;
    textDetLimitSideLen?: number | null | undefined;
    textDetLimitType?: "min" | "max" | null | undefined;
    textDetThresh?: number | null | undefined;
    textDetBoxThresh?: number | null | undefined;
    textDetUnclipRatio?: number | null | undefined;
    textRecScoreThresh?: number | null | undefined;
    visualize?: boolean | null | undefined;
}>;
export declare const PaddleVlLayoutMergeModeSchema: z.ZodEnum<["large", "small", "union"]>;
export declare const PaddleVlOcrParamsSchema: z.ZodObject<{
    useDocOrientationClassify: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    useDocUnwarping: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    useLayoutDetection: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    useChartRecognition: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    layoutThreshold: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    layoutNms: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    layoutUnclipRatio: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    layoutMergeBboxesMode: z.ZodOptional<z.ZodNullable<z.ZodEnum<["large", "small", "union"]>>>;
    promptLabel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    repetitionPenalty: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    temperature: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    topP: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    minPixels: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    maxPixels: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    showFormulaNumber: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    prettifyMarkdown: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    visualize: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    temperature?: number | null | undefined;
    useDocOrientationClassify?: boolean | null | undefined;
    useDocUnwarping?: boolean | null | undefined;
    visualize?: boolean | null | undefined;
    useLayoutDetection?: boolean | null | undefined;
    useChartRecognition?: boolean | null | undefined;
    layoutThreshold?: number | null | undefined;
    layoutNms?: boolean | null | undefined;
    layoutUnclipRatio?: number | null | undefined;
    layoutMergeBboxesMode?: "large" | "small" | "union" | null | undefined;
    promptLabel?: string | null | undefined;
    repetitionPenalty?: number | null | undefined;
    topP?: number | null | undefined;
    minPixels?: number | null | undefined;
    maxPixels?: number | null | undefined;
    showFormulaNumber?: boolean | null | undefined;
    prettifyMarkdown?: boolean | null | undefined;
}, {
    temperature?: number | null | undefined;
    useDocOrientationClassify?: boolean | null | undefined;
    useDocUnwarping?: boolean | null | undefined;
    visualize?: boolean | null | undefined;
    useLayoutDetection?: boolean | null | undefined;
    useChartRecognition?: boolean | null | undefined;
    layoutThreshold?: number | null | undefined;
    layoutNms?: boolean | null | undefined;
    layoutUnclipRatio?: number | null | undefined;
    layoutMergeBboxesMode?: "large" | "small" | "union" | null | undefined;
    promptLabel?: string | null | undefined;
    repetitionPenalty?: number | null | undefined;
    topP?: number | null | undefined;
    minPixels?: number | null | undefined;
    maxPixels?: number | null | undefined;
    showFormulaNumber?: boolean | null | undefined;
    prettifyMarkdown?: boolean | null | undefined;
}>;
export declare const MultimodalOcrParamsSchema: z.ZodObject<{
    modelId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    prompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    temperature: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    topP: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    maxTokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    frequencyPenalty: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    presencePenalty: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    pdfToImages: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    prompt?: string | null | undefined;
    modelId?: string | null | undefined;
    temperature?: number | null | undefined;
    topP?: number | null | undefined;
    maxTokens?: number | null | undefined;
    frequencyPenalty?: number | null | undefined;
    presencePenalty?: number | null | undefined;
    pdfToImages?: boolean | undefined;
}, {
    prompt?: string | null | undefined;
    modelId?: string | null | undefined;
    temperature?: number | null | undefined;
    topP?: number | null | undefined;
    maxTokens?: number | null | undefined;
    frequencyPenalty?: number | null | undefined;
    presencePenalty?: number | null | undefined;
    pdfToImages?: boolean | undefined;
}>;
export declare const OcrProviderEnabledSchema: z.ZodObject<{
    paddle: z.ZodOptional<z.ZodBoolean>;
    paddle_vl: z.ZodOptional<z.ZodBoolean>;
    paddle_vl_1_5: z.ZodOptional<z.ZodBoolean>;
    datalab: z.ZodOptional<z.ZodBoolean>;
    mineru: z.ZodOptional<z.ZodBoolean>;
    multimodal_model: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    paddle?: boolean | undefined;
    paddle_vl?: boolean | undefined;
    paddle_vl_1_5?: boolean | undefined;
    datalab?: boolean | undefined;
    mineru?: boolean | undefined;
    multimodal_model?: boolean | undefined;
}, {
    paddle?: boolean | undefined;
    paddle_vl?: boolean | undefined;
    paddle_vl_1_5?: boolean | undefined;
    datalab?: boolean | undefined;
    mineru?: boolean | undefined;
    multimodal_model?: boolean | undefined;
}>;
export declare const UpdateOcrProviderSettingsSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    providerEnabled: z.ZodOptional<z.ZodObject<{
        paddle: z.ZodOptional<z.ZodBoolean>;
        paddle_vl: z.ZodOptional<z.ZodBoolean>;
        paddle_vl_1_5: z.ZodOptional<z.ZodBoolean>;
        datalab: z.ZodOptional<z.ZodBoolean>;
        mineru: z.ZodOptional<z.ZodBoolean>;
        multimodal_model: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        paddle?: boolean | undefined;
        paddle_vl?: boolean | undefined;
        paddle_vl_1_5?: boolean | undefined;
        datalab?: boolean | undefined;
        mineru?: boolean | undefined;
        multimodal_model?: boolean | undefined;
    }, {
        paddle?: boolean | undefined;
        paddle_vl?: boolean | undefined;
        paddle_vl_1_5?: boolean | undefined;
        datalab?: boolean | undefined;
        mineru?: boolean | undefined;
        multimodal_model?: boolean | undefined;
    }>>;
    provider: z.ZodOptional<z.ZodEnum<["paddle", "paddle_vl", "paddle_vl_1_5", "datalab", "mineru", "multimodal_model"]>>;
    credentialSource: z.ZodOptional<z.ZodEnum<["system", "custom"]>>;
    baseUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    apiKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    datalab: z.ZodOptional<z.ZodObject<{
        mode: z.ZodOptional<z.ZodOptional<z.ZodEnum<["fast", "balanced", "accurate"]>>>;
        maxPages: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        pageRange: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
        paginate: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        addBlockIds: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        disableImageExtraction: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        disableImageCaptions: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        outputFormat: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
        skipCache: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        saveCheckpoint: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        extras: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
        additionalConfig: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    }, "strip", z.ZodTypeAny, {
        mode?: "fast" | "balanced" | "accurate" | undefined;
        maxPages?: number | null | undefined;
        pageRange?: string | null | undefined;
        paginate?: boolean | undefined;
        addBlockIds?: boolean | undefined;
        disableImageExtraction?: boolean | undefined;
        disableImageCaptions?: boolean | undefined;
        outputFormat?: string | null | undefined;
        skipCache?: boolean | undefined;
        saveCheckpoint?: boolean | undefined;
        extras?: string | null | undefined;
        additionalConfig?: string | null | undefined;
    }, {
        mode?: "fast" | "balanced" | "accurate" | undefined;
        maxPages?: number | null | undefined;
        pageRange?: string | null | undefined;
        paginate?: boolean | undefined;
        addBlockIds?: boolean | undefined;
        disableImageExtraction?: boolean | undefined;
        disableImageCaptions?: boolean | undefined;
        outputFormat?: string | null | undefined;
        skipCache?: boolean | undefined;
        saveCheckpoint?: boolean | undefined;
        extras?: string | null | undefined;
        additionalConfig?: string | null | undefined;
    }>>;
    paddle: z.ZodOptional<z.ZodObject<{
        useDocOrientationClassify: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>;
        useDocUnwarping: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>;
        useTextlineOrientation: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>;
        textDetLimitSideLen: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        textDetLimitType: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodEnum<["min", "max"]>>>>;
        textDetThresh: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        textDetBoxThresh: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        textDetUnclipRatio: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        textRecScoreThresh: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        visualize: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>;
    }, "strip", z.ZodTypeAny, {
        useDocOrientationClassify?: boolean | null | undefined;
        useDocUnwarping?: boolean | null | undefined;
        useTextlineOrientation?: boolean | null | undefined;
        textDetLimitSideLen?: number | null | undefined;
        textDetLimitType?: "min" | "max" | null | undefined;
        textDetThresh?: number | null | undefined;
        textDetBoxThresh?: number | null | undefined;
        textDetUnclipRatio?: number | null | undefined;
        textRecScoreThresh?: number | null | undefined;
        visualize?: boolean | null | undefined;
    }, {
        useDocOrientationClassify?: boolean | null | undefined;
        useDocUnwarping?: boolean | null | undefined;
        useTextlineOrientation?: boolean | null | undefined;
        textDetLimitSideLen?: number | null | undefined;
        textDetLimitType?: "min" | "max" | null | undefined;
        textDetThresh?: number | null | undefined;
        textDetBoxThresh?: number | null | undefined;
        textDetUnclipRatio?: number | null | undefined;
        textRecScoreThresh?: number | null | undefined;
        visualize?: boolean | null | undefined;
    }>>;
    paddle_vl: z.ZodOptional<z.ZodObject<{
        useDocOrientationClassify: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>;
        useDocUnwarping: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>;
        useLayoutDetection: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>;
        useChartRecognition: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>;
        layoutThreshold: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        layoutNms: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>;
        layoutUnclipRatio: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        layoutMergeBboxesMode: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodEnum<["large", "small", "union"]>>>>;
        promptLabel: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
        repetitionPenalty: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        temperature: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        topP: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        minPixels: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        maxPixels: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        showFormulaNumber: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>;
        prettifyMarkdown: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>;
        visualize: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>;
    }, "strip", z.ZodTypeAny, {
        temperature?: number | null | undefined;
        useDocOrientationClassify?: boolean | null | undefined;
        useDocUnwarping?: boolean | null | undefined;
        visualize?: boolean | null | undefined;
        useLayoutDetection?: boolean | null | undefined;
        useChartRecognition?: boolean | null | undefined;
        layoutThreshold?: number | null | undefined;
        layoutNms?: boolean | null | undefined;
        layoutUnclipRatio?: number | null | undefined;
        layoutMergeBboxesMode?: "large" | "small" | "union" | null | undefined;
        promptLabel?: string | null | undefined;
        repetitionPenalty?: number | null | undefined;
        topP?: number | null | undefined;
        minPixels?: number | null | undefined;
        maxPixels?: number | null | undefined;
        showFormulaNumber?: boolean | null | undefined;
        prettifyMarkdown?: boolean | null | undefined;
    }, {
        temperature?: number | null | undefined;
        useDocOrientationClassify?: boolean | null | undefined;
        useDocUnwarping?: boolean | null | undefined;
        visualize?: boolean | null | undefined;
        useLayoutDetection?: boolean | null | undefined;
        useChartRecognition?: boolean | null | undefined;
        layoutThreshold?: number | null | undefined;
        layoutNms?: boolean | null | undefined;
        layoutUnclipRatio?: number | null | undefined;
        layoutMergeBboxesMode?: "large" | "small" | "union" | null | undefined;
        promptLabel?: string | null | undefined;
        repetitionPenalty?: number | null | undefined;
        topP?: number | null | undefined;
        minPixels?: number | null | undefined;
        maxPixels?: number | null | undefined;
        showFormulaNumber?: boolean | null | undefined;
        prettifyMarkdown?: boolean | null | undefined;
    }>>;
    mineru: z.ZodOptional<z.ZodObject<{
        userToken: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
        modelVersion: z.ZodOptional<z.ZodOptional<z.ZodEnum<["pipeline", "vlm"]>>>;
        isOcr: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        enableFormula: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        enableTable: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        language: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        extraFormats: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodEnum<["docx", "html", "latex"]>, "many">>>;
        pageRanges: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    }, "strip", z.ZodTypeAny, {
        userToken?: string | null | undefined;
        modelVersion?: "pipeline" | "vlm" | undefined;
        isOcr?: boolean | undefined;
        enableFormula?: boolean | undefined;
        enableTable?: boolean | undefined;
        language?: string | undefined;
        extraFormats?: ("docx" | "html" | "latex")[] | undefined;
        pageRanges?: string | null | undefined;
    }, {
        userToken?: string | null | undefined;
        modelVersion?: "pipeline" | "vlm" | undefined;
        isOcr?: boolean | undefined;
        enableFormula?: boolean | undefined;
        enableTable?: boolean | undefined;
        language?: string | undefined;
        extraFormats?: ("docx" | "html" | "latex")[] | undefined;
        pageRanges?: string | null | undefined;
    }>>;
    multimodal: z.ZodOptional<z.ZodObject<{
        modelId: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
        prompt: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
        temperature: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        topP: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        maxTokens: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        frequencyPenalty: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        presencePenalty: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        pdfToImages: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        prompt?: string | null | undefined;
        modelId?: string | null | undefined;
        temperature?: number | null | undefined;
        topP?: number | null | undefined;
        maxTokens?: number | null | undefined;
        frequencyPenalty?: number | null | undefined;
        presencePenalty?: number | null | undefined;
        pdfToImages?: boolean | undefined;
    }, {
        prompt?: string | null | undefined;
        modelId?: string | null | undefined;
        temperature?: number | null | undefined;
        topP?: number | null | undefined;
        maxTokens?: number | null | undefined;
        frequencyPenalty?: number | null | undefined;
        presencePenalty?: number | null | undefined;
        pdfToImages?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    paddle?: {
        useDocOrientationClassify?: boolean | null | undefined;
        useDocUnwarping?: boolean | null | undefined;
        useTextlineOrientation?: boolean | null | undefined;
        textDetLimitSideLen?: number | null | undefined;
        textDetLimitType?: "min" | "max" | null | undefined;
        textDetThresh?: number | null | undefined;
        textDetBoxThresh?: number | null | undefined;
        textDetUnclipRatio?: number | null | undefined;
        textRecScoreThresh?: number | null | undefined;
        visualize?: boolean | null | undefined;
    } | undefined;
    paddle_vl?: {
        temperature?: number | null | undefined;
        useDocOrientationClassify?: boolean | null | undefined;
        useDocUnwarping?: boolean | null | undefined;
        visualize?: boolean | null | undefined;
        useLayoutDetection?: boolean | null | undefined;
        useChartRecognition?: boolean | null | undefined;
        layoutThreshold?: number | null | undefined;
        layoutNms?: boolean | null | undefined;
        layoutUnclipRatio?: number | null | undefined;
        layoutMergeBboxesMode?: "large" | "small" | "union" | null | undefined;
        promptLabel?: string | null | undefined;
        repetitionPenalty?: number | null | undefined;
        topP?: number | null | undefined;
        minPixels?: number | null | undefined;
        maxPixels?: number | null | undefined;
        showFormulaNumber?: boolean | null | undefined;
        prettifyMarkdown?: boolean | null | undefined;
    } | undefined;
    datalab?: {
        mode?: "fast" | "balanced" | "accurate" | undefined;
        maxPages?: number | null | undefined;
        pageRange?: string | null | undefined;
        paginate?: boolean | undefined;
        addBlockIds?: boolean | undefined;
        disableImageExtraction?: boolean | undefined;
        disableImageCaptions?: boolean | undefined;
        outputFormat?: string | null | undefined;
        skipCache?: boolean | undefined;
        saveCheckpoint?: boolean | undefined;
        extras?: string | null | undefined;
        additionalConfig?: string | null | undefined;
    } | undefined;
    mineru?: {
        userToken?: string | null | undefined;
        modelVersion?: "pipeline" | "vlm" | undefined;
        isOcr?: boolean | undefined;
        enableFormula?: boolean | undefined;
        enableTable?: boolean | undefined;
        language?: string | undefined;
        extraFormats?: ("docx" | "html" | "latex")[] | undefined;
        pageRanges?: string | null | undefined;
    } | undefined;
    apiKey?: string | null | undefined;
    baseUrl?: string | null | undefined;
    enabled?: boolean | undefined;
    providerEnabled?: {
        paddle?: boolean | undefined;
        paddle_vl?: boolean | undefined;
        paddle_vl_1_5?: boolean | undefined;
        datalab?: boolean | undefined;
        mineru?: boolean | undefined;
        multimodal_model?: boolean | undefined;
    } | undefined;
    provider?: "paddle" | "paddle_vl" | "paddle_vl_1_5" | "datalab" | "mineru" | "multimodal_model" | undefined;
    credentialSource?: "custom" | "system" | undefined;
    multimodal?: {
        prompt?: string | null | undefined;
        modelId?: string | null | undefined;
        temperature?: number | null | undefined;
        topP?: number | null | undefined;
        maxTokens?: number | null | undefined;
        frequencyPenalty?: number | null | undefined;
        presencePenalty?: number | null | undefined;
        pdfToImages?: boolean | undefined;
    } | undefined;
}, {
    paddle?: {
        useDocOrientationClassify?: boolean | null | undefined;
        useDocUnwarping?: boolean | null | undefined;
        useTextlineOrientation?: boolean | null | undefined;
        textDetLimitSideLen?: number | null | undefined;
        textDetLimitType?: "min" | "max" | null | undefined;
        textDetThresh?: number | null | undefined;
        textDetBoxThresh?: number | null | undefined;
        textDetUnclipRatio?: number | null | undefined;
        textRecScoreThresh?: number | null | undefined;
        visualize?: boolean | null | undefined;
    } | undefined;
    paddle_vl?: {
        temperature?: number | null | undefined;
        useDocOrientationClassify?: boolean | null | undefined;
        useDocUnwarping?: boolean | null | undefined;
        visualize?: boolean | null | undefined;
        useLayoutDetection?: boolean | null | undefined;
        useChartRecognition?: boolean | null | undefined;
        layoutThreshold?: number | null | undefined;
        layoutNms?: boolean | null | undefined;
        layoutUnclipRatio?: number | null | undefined;
        layoutMergeBboxesMode?: "large" | "small" | "union" | null | undefined;
        promptLabel?: string | null | undefined;
        repetitionPenalty?: number | null | undefined;
        topP?: number | null | undefined;
        minPixels?: number | null | undefined;
        maxPixels?: number | null | undefined;
        showFormulaNumber?: boolean | null | undefined;
        prettifyMarkdown?: boolean | null | undefined;
    } | undefined;
    datalab?: {
        mode?: "fast" | "balanced" | "accurate" | undefined;
        maxPages?: number | null | undefined;
        pageRange?: string | null | undefined;
        paginate?: boolean | undefined;
        addBlockIds?: boolean | undefined;
        disableImageExtraction?: boolean | undefined;
        disableImageCaptions?: boolean | undefined;
        outputFormat?: string | null | undefined;
        skipCache?: boolean | undefined;
        saveCheckpoint?: boolean | undefined;
        extras?: string | null | undefined;
        additionalConfig?: string | null | undefined;
    } | undefined;
    mineru?: {
        userToken?: string | null | undefined;
        modelVersion?: "pipeline" | "vlm" | undefined;
        isOcr?: boolean | undefined;
        enableFormula?: boolean | undefined;
        enableTable?: boolean | undefined;
        language?: string | undefined;
        extraFormats?: ("docx" | "html" | "latex")[] | undefined;
        pageRanges?: string | null | undefined;
    } | undefined;
    apiKey?: string | null | undefined;
    baseUrl?: string | null | undefined;
    enabled?: boolean | undefined;
    providerEnabled?: {
        paddle?: boolean | undefined;
        paddle_vl?: boolean | undefined;
        paddle_vl_1_5?: boolean | undefined;
        datalab?: boolean | undefined;
        mineru?: boolean | undefined;
        multimodal_model?: boolean | undefined;
    } | undefined;
    provider?: "paddle" | "paddle_vl" | "paddle_vl_1_5" | "datalab" | "mineru" | "multimodal_model" | undefined;
    credentialSource?: "custom" | "system" | undefined;
    multimodal?: {
        prompt?: string | null | undefined;
        modelId?: string | null | undefined;
        temperature?: number | null | undefined;
        topP?: number | null | undefined;
        maxTokens?: number | null | undefined;
        frequencyPenalty?: number | null | undefined;
        presencePenalty?: number | null | undefined;
        pdfToImages?: boolean | undefined;
    } | undefined;
}>;
export type UpdateOcrProviderSettingsInput = z.infer<typeof UpdateOcrProviderSettingsSchema>;
export declare const UpdateOcrSystemProviderSettingsSchema: z.ZodObject<{
    paddle: z.ZodOptional<z.ZodObject<{
        baseUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        apiKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    }, {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    }>>;
    paddle_vl: z.ZodOptional<z.ZodObject<{
        baseUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        apiKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    }, {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    }>>;
    paddle_vl_1_5: z.ZodOptional<z.ZodObject<{
        baseUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        apiKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    }, {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    }>>;
    datalab: z.ZodOptional<z.ZodObject<{
        baseUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        apiKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    }, {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    }>>;
    mineru: z.ZodOptional<z.ZodObject<{
        baseUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        apiKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    }, {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    paddle?: {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    } | undefined;
    paddle_vl?: {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    } | undefined;
    paddle_vl_1_5?: {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    } | undefined;
    datalab?: {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    } | undefined;
    mineru?: {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    } | undefined;
}, {
    paddle?: {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    } | undefined;
    paddle_vl?: {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    } | undefined;
    paddle_vl_1_5?: {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    } | undefined;
    datalab?: {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    } | undefined;
    mineru?: {
        apiKey?: string | null | undefined;
        baseUrl?: string | null | undefined;
    } | undefined;
}>;
export type UpdateOcrSystemProviderSettingsInput = z.infer<typeof UpdateOcrSystemProviderSettingsSchema>;
export declare const OcrResultsRequestSchema: z.ZodObject<{
    fileIds: z.ZodArray<z.ZodString, "many">;
    provider: z.ZodOptional<z.ZodEnum<["paddle", "paddle_vl", "paddle_vl_1_5", "datalab", "mineru", "multimodal_model"]>>;
}, "strip", z.ZodTypeAny, {
    fileIds: string[];
    provider?: "paddle" | "paddle_vl" | "paddle_vl_1_5" | "datalab" | "mineru" | "multimodal_model" | undefined;
}, {
    fileIds: string[];
    provider?: "paddle" | "paddle_vl" | "paddle_vl_1_5" | "datalab" | "mineru" | "multimodal_model" | undefined;
}>;
export type OcrResultsRequestInput = z.infer<typeof OcrResultsRequestSchema>;
//# sourceMappingURL=ocr.d.ts.map