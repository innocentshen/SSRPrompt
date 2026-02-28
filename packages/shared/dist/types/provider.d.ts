export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'custom' | 'openrouter';
export interface Provider {
    id: string;
    userId: string;
    name: string;
    type: ProviderType;
    apiKey: string;
    baseUrl: string | null;
    enabled: boolean;
    isSystem: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface CreateProviderDto {
    name: string;
    type: ProviderType;
    apiKey: string;
    baseUrl?: string;
    enabled?: boolean;
    isSystem?: boolean;
}
export interface UpdateProviderDto {
    name?: string;
    type?: ProviderType;
    apiKey?: string;
    baseUrl?: string | null;
    enabled?: boolean;
    isSystem?: boolean;
}
export interface Model {
    id: string;
    providerId: string;
    modelId: string;
    name: string;
    capabilities: string[];
    maxContextLength: number;
    inputPricePerM: number;
    outputPricePerM: number;
    supportsVision: boolean;
    supportsReasoning: boolean;
    supportsFunctionCalling: boolean;
    createdAt: string;
}
export interface CreateModelDto {
    modelId: string;
    name: string;
    capabilities?: string[];
    maxContextLength?: number;
    inputPricePerM?: number;
    outputPricePerM?: number;
    supportsVision?: boolean;
    supportsReasoning?: boolean;
    supportsFunctionCalling?: boolean;
}
export interface UpdateModelDto {
    modelId?: string;
    name?: string;
    capabilities?: string[];
    maxContextLength?: number;
    inputPricePerM?: number;
    outputPricePerM?: number;
    supportsVision?: boolean;
    supportsReasoning?: boolean;
    supportsFunctionCalling?: boolean;
}
//# sourceMappingURL=provider.d.ts.map