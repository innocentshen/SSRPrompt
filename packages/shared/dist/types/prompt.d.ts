import type { ProviderType } from './provider.js';
export interface PromptVariable {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description?: string;
    default_value?: string;
    required?: boolean;
}
export interface PromptMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface PromptConfig {
    temperature?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    max_tokens?: number;
    output_schema?: OutputSchema;
    reasoning?: {
        enabled: boolean;
        effort: 'default' | 'none' | 'low' | 'medium' | 'high';
    };
}
export type PromptApiVersionMode = 'latest' | 'fixed';
export interface OutputSchema {
    name: string;
    description?: string;
    schema: Record<string, unknown>;
    strict?: boolean;
}
export interface Prompt {
    id: string;
    userId: string;
    name: string;
    description: string | null;
    content: string | null;
    variables: PromptVariable[];
    messages: PromptMessage[];
    config: PromptConfig;
    currentVersion: number;
    defaultModelId: string | null;
    groupId: string | null;
    orderIndex: number;
    apiEnabled: boolean;
    apiVersionMode: PromptApiVersionMode;
    apiFixedVersion: number | null;
    isPublic: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface PromptVersion {
    id: string;
    promptId: string;
    version: number;
    content: string;
    commitMessage: string | null;
    /**
     * Snapshot fields for restoring/running a version.
     * NOTE: May be undefined for legacy versions.
     */
    variables?: PromptVariable[];
    messages?: PromptMessage[];
    config?: PromptConfig;
    defaultModelId?: string | null;
    /**
     * Whether this version is published publicly.
     * NOTE: May be undefined for legacy responses.
     */
    isPublic?: boolean;
    /**
     * Public publish timestamp.
     * NOTE: May be undefined for legacy responses.
     */
    publishedAt?: string | null;
    createdAt: string;
}
export interface CreatePromptDto {
    name: string;
    description?: string;
    content?: string;
    variables?: PromptVariable[];
    messages?: PromptMessage[];
    config?: PromptConfig;
    defaultModelId?: string;
    groupId?: string | null;
    apiEnabled?: boolean;
    apiVersionMode?: PromptApiVersionMode;
    apiFixedVersion?: number | null;
}
export interface UpdatePromptDto {
    name?: string;
    description?: string | null;
    content?: string | null;
    variables?: PromptVariable[];
    messages?: PromptMessage[];
    config?: PromptConfig;
    defaultModelId?: string | null;
    groupId?: string | null;
    orderIndex?: number;
    apiEnabled?: boolean;
    apiVersionMode?: PromptApiVersionMode;
    apiFixedVersion?: number | null;
    isPublic?: boolean;
}
export interface PromptListItem {
    id: string;
    userId: string;
    name: string;
    description: string | null;
    currentVersion: number;
    defaultModelId: string | null;
    groupId: string | null;
    orderIndex: number;
    apiEnabled: boolean;
    apiVersionMode: PromptApiVersionMode;
    apiFixedVersion: number | null;
    isPublic: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface PromptGroup {
    id: string;
    userId: string;
    name: string;
    parentId: string | null;
    orderIndex: number;
    createdAt: string;
    updatedAt: string;
}
export interface CreatePromptGroupDto {
    name: string;
    parentId?: string | null;
    orderIndex?: number;
}
export interface UpdatePromptGroupDto {
    name?: string;
    parentId?: string | null;
    orderIndex?: number;
}
export interface PublicUserProfile {
    id: string;
    name: string | null;
    avatar: string | null;
}
export interface PublicModelInfo {
    providerType: ProviderType;
    modelId: string;
    name: string;
}
export interface PublicPromptListItem {
    id: string;
    name: string;
    description: string | null;
    publicVersion: number;
    author: PublicUserProfile;
    defaultModel: PublicModelInfo | null;
    createdAt: string;
    updatedAt: string;
}
export interface PublicPromptDetail extends PublicPromptListItem {
    content: string;
    variables: PromptVariable[];
    messages: PromptMessage[];
    config: PromptConfig;
}
export interface CopyPublicPromptDto {
    version?: number;
    name?: string;
}
//# sourceMappingURL=prompt.d.ts.map