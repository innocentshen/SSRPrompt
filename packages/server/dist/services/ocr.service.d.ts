import type { OcrProvider, OcrCredentialSource, OcrTestResult, UpdateOcrProviderSettingsDto, OcrProviderSettings, OcrSystemProviderSettings, UpdateOcrSystemProviderSettingsDto } from '@ssrprompt/shared';
export declare class OcrService {
    private getSettingRow;
    private getSystemDefaults;
    private resolveEffectiveConfig;
    getSettings(userId: string): Promise<OcrProviderSettings>;
    updateSettings(userId: string, data: UpdateOcrProviderSettingsDto): Promise<OcrProviderSettings>;
    getSystemSettings(): Promise<OcrSystemProviderSettings>;
    updateSystemSettings(data: UpdateOcrSystemProviderSettingsDto): Promise<OcrSystemProviderSettings>;
    test(userId: string, file: {
        buffer: Buffer;
        mimeType: string;
        filename: string;
    }, override?: Partial<{
        provider: OcrProvider;
        credentialSource: OcrCredentialSource;
        baseUrl: string | null;
        apiKey: string | null;
    }>): Promise<OcrTestResult>;
    getResults(userId: string, fileIds: string[], provider?: OcrProvider): Promise<Array<{
        fileId: string;
        provider: OcrProvider;
        status: 'success' | 'failed';
        errorMessage: string | null;
        fullText: string;
        pages: string[] | null;
        createdAt: string;
    }>>;
    extractForFile(userId: string, fileId: string, override?: Partial<{
        provider: OcrProvider;
    }>): Promise<{
        provider: OcrProvider;
        pages: string[];
        fullText: string;
    }>;
}
export declare const ocrService: OcrService;
//# sourceMappingURL=ocr.service.d.ts.map