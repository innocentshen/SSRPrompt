import type { Prisma } from '@prisma/client';
import { type CreateShareLinkInput, type ListShareLinksQueryInput, type ShareAccessLogPage, type ShareEvaluationDetail, type ShareLink, type ShareLinkPage, type SharePromptDetail, type UpdateShareLinkInput } from '@ssrprompt/shared';
import { type DownloadRange } from './files.service.js';
type AccessContext = {
    ipAddress: string | null;
    userAgent: string | null;
};
export declare class ShareLinksService {
    private assertShareResourceOwner;
    private resolveResourceName;
    private loadLinkByToken;
    private assertPasswordGranted;
    private recordAccess;
    create(userId: string, input: CreateShareLinkInput): Promise<ShareLink>;
    list(userId: string, query: ListShareLinksQueryInput): Promise<ShareLinkPage>;
    update(userId: string, shareLinkId: string, input: UpdateShareLinkInput): Promise<ShareLink>;
    revoke(userId: string, shareLinkId: string): Promise<ShareLink>;
    listAccessLogs(userId: string, shareLinkId: string, page?: number, limit?: number): Promise<ShareAccessLogPage>;
    verifyPassword(userId: string, token: string, password: string, context: AccessContext): Promise<void>;
    getSharedPrompt(userId: string, token: string, context: AccessContext): Promise<SharePromptDetail>;
    getSharedEvaluation(userId: string, token: string, context: AccessContext): Promise<ShareEvaluationDetail>;
    copySharedPrompt(userId: string, token: string, name?: string, context?: AccessContext): Promise<{
        name: string;
        userId: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        config: Prisma.JsonValue;
        orderIndex: number;
        isPublic: boolean;
        content: string | null;
        variables: Prisma.JsonValue;
        messages: Prisma.JsonValue;
        currentVersion: number;
        apiEnabled: boolean;
        apiVersionMode: import("@prisma/client").$Enums.PromptApiVersionMode;
        apiFixedVersion: number | null;
        defaultModelId: string | null;
        groupId: string | null;
    }>;
    copySharedEvaluation(userId: string, token: string, name?: string, context?: AccessContext): Promise<import("../repositories/evaluations.repository.js").EvaluationWithRelations>;
    downloadSharedEvaluationAttachment(userId: string, token: string, fileId: string, range: DownloadRange, context: AccessContext): Promise<{
        meta: import("@prisma/client").StoredFile;
        body: unknown;
        contentLength?: number;
        contentRange?: string;
    }>;
}
export declare const shareLinksService: ShareLinksService;
export {};
//# sourceMappingURL=share-links.service.d.ts.map