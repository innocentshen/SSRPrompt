import type { EvaluationConfig, EvaluationCriterion, TestCase } from './evaluation.js';
import type { PromptConfig, PromptMessage, PromptVariable } from './prompt.js';
import type { PublicModelInfo, PublicUserProfile } from './prompt.js';
import type { PaginatedResponse } from './trace.js';
export type ShareResourceType = 'prompt' | 'evaluation';
export type ShareAccessAction = 'view' | 'copy' | 'download_attachment' | 'password_success' | 'password_failure';
export interface ShareLink {
    id: string;
    userId: string;
    resourceType: ShareResourceType;
    resourceId: string;
    token: string;
    hasPassword: boolean;
    allowCopy: boolean;
    expiresAt: string | null;
    revokedAt: string | null;
    accessCount: number;
    lastAccessedAt: string | null;
    createdAt: string;
    updatedAt: string;
    resourceName?: string | null;
}
export interface ShareAccessLog {
    id: string;
    shareLinkId: string;
    accessorUserId: string | null;
    action: ShareAccessAction;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
}
export type ShareAccessLogPage = PaginatedResponse<ShareAccessLog>;
export type ShareLinkPage = PaginatedResponse<ShareLink>;
export interface CreateShareLinkDto {
    resourceType: ShareResourceType;
    resourceId: string;
    password?: string | null;
    expiresAt?: string | null;
    allowCopy?: boolean;
}
export interface UpdateShareLinkDto {
    password?: string | null;
    clearPassword?: boolean;
    expiresAt?: string | null;
    allowCopy?: boolean;
}
export interface ListShareLinksQueryDto {
    resourceType?: ShareResourceType;
    resourceId?: string;
    includeRevoked?: boolean;
    page?: number;
    pageSize?: number;
}
export interface VerifySharePasswordDto {
    password: string;
}
export interface SharePromptContent {
    id: string;
    name: string;
    description: string | null;
    content: string | null;
    variables: PromptVariable[];
    messages: PromptMessage[];
    config: PromptConfig;
    currentVersion: number;
    defaultModel: PublicModelInfo | null;
    author: PublicUserProfile;
    updatedAt: string;
}
export interface ShareEvaluationContent {
    id: string;
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    config: EvaluationConfig;
    prompt: {
        id: string;
        name: string;
        currentVersion: number;
    } | null;
    model: PublicModelInfo | null;
    judgeModel: PublicModelInfo | null;
    testCases: TestCase[];
    criteria: EvaluationCriterion[];
    createdAt: string;
    completedAt: string | null;
}
export interface SharePromptDetail {
    shareLink: ShareLink;
    prompt: SharePromptContent;
    canCopy: boolean;
}
export interface ShareEvaluationDetail {
    shareLink: ShareLink;
    evaluation: ShareEvaluationContent;
    canCopy: boolean;
}
//# sourceMappingURL=share.d.ts.map