import type { Prisma } from '@prisma/client';
export type EvaluationImportMode = 'create' | 'append' | 'overwrite';
export type EvaluationImportJobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type EvaluationImportLocale = 'en' | 'zh-CN' | 'zh-TW' | 'ja';
type ImportError = {
    scope: 'zip' | 'excel' | 'meta' | 'criteria' | 'row' | 'attachment';
    sheet?: 'Meta' | 'Criteria' | 'TestCases';
    row?: number;
    testCaseName?: string;
    ref?: string;
    code: string;
    message: string;
};
type ParsedMeta = {
    evaluationName?: string;
    promptId?: string;
    modelId?: string;
    judgeModelId?: string;
    configPatch: Record<string, unknown>;
};
type ParsedCriterion = {
    name: string;
    description?: string;
    prompt?: string;
    weight?: number;
    enabled?: boolean;
};
type ParsedAttachmentRef = {
    ref: string;
    nameHint?: string;
    typeHint?: string;
};
type ParsedTestCase = {
    rowNumber: number;
    name?: string;
    inputText: string;
    expectedOutput?: string;
    notes?: string;
    inputVariables: Record<string, unknown>;
    attachments: ParsedAttachmentRef[];
};
type ParsedExcelImport = {
    meta: ParsedMeta;
    criteria: ParsedCriterion[];
    testCases: ParsedTestCase[];
    errors: ImportError[];
};
export declare function normalizeEvaluationImportLocale(input?: string | null): EvaluationImportLocale;
export declare function parseEvaluationImportExcel(buffer: Buffer): ParsedExcelImport;
export declare class EvaluationImportsService {
    buildTemplateZip(locale?: EvaluationImportLocale): Promise<{
        filename: string;
        buffer: Buffer;
    }>;
    exportEvaluationZip(userId: string, evaluationId: string, options?: {
        includeAttachments?: boolean;
        locale?: EvaluationImportLocale;
    }): Promise<{
        filename: string;
        buffer: Buffer;
    }>;
    createJob(userId: string, input: {
        mode: EvaluationImportMode;
        targetEvaluationId?: string;
        zip: {
            originalName: string;
            mimeType: string;
            size: number;
            buffer: Buffer;
        };
    }): Promise<{
        id: string;
    }>;
    getJob(userId: string, jobId: string): Promise<{
        status: import("@prisma/client").$Enums.EvaluationImportStatus;
        userId: string;
        id: string;
        createdAt: Date;
        completedAt: Date | null;
        errorMessage: string | null;
        mode: import("@prisma/client").$Enums.EvaluationImportMode;
        progress: Prisma.JsonValue;
        errors: Prisma.JsonValue;
        sourceZipFileId: string;
        targetEvaluationId: string | null;
        resultEvaluationId: string | null;
    }>;
    execute(jobId: string): Promise<void>;
}
export declare const evaluationImportsService: EvaluationImportsService;
export {};
//# sourceMappingURL=evaluation-imports.service.d.ts.map