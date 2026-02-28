import { z } from 'zod';
export declare const ProviderTypeSchema: z.ZodEnum<["openai", "anthropic", "gemini", "custom", "openrouter"]>;
export declare const CreateProviderSchema: z.ZodObject<{
    name: z.ZodString;
    type: z.ZodEnum<["openai", "anthropic", "gemini", "custom", "openrouter"]>;
    apiKey: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    baseUrl: z.ZodOptional<z.ZodString>;
    enabled: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    isSystem: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    type: "openai" | "anthropic" | "gemini" | "custom" | "openrouter";
    apiKey: string;
    enabled: boolean;
    isSystem: boolean;
    baseUrl?: string | undefined;
}, {
    name: string;
    type: "openai" | "anthropic" | "gemini" | "custom" | "openrouter";
    apiKey?: string | undefined;
    baseUrl?: string | undefined;
    enabled?: boolean | undefined;
    isSystem?: boolean | undefined;
}>;
export declare const UpdateProviderSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodEnum<["openai", "anthropic", "gemini", "custom", "openrouter"]>>;
    apiKey: z.ZodOptional<z.ZodString>;
    baseUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    enabled: z.ZodOptional<z.ZodBoolean>;
    isSystem: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    type?: "openai" | "anthropic" | "gemini" | "custom" | "openrouter" | undefined;
    apiKey?: string | undefined;
    baseUrl?: string | null | undefined;
    enabled?: boolean | undefined;
    isSystem?: boolean | undefined;
}, {
    name?: string | undefined;
    type?: "openai" | "anthropic" | "gemini" | "custom" | "openrouter" | undefined;
    apiKey?: string | undefined;
    baseUrl?: string | null | undefined;
    enabled?: boolean | undefined;
    isSystem?: boolean | undefined;
}>;
export declare const CreateModelSchema: z.ZodObject<{
    modelId: z.ZodString;
    name: z.ZodString;
    capabilities: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    maxContextLength: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    inputPricePerM: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    outputPricePerM: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    supportsVision: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    supportsReasoning: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    supportsFunctionCalling: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    modelId: string;
    capabilities: string[];
    maxContextLength: number;
    inputPricePerM: number;
    outputPricePerM: number;
    supportsVision: boolean;
    supportsReasoning: boolean;
    supportsFunctionCalling: boolean;
}, {
    name: string;
    modelId: string;
    capabilities?: string[] | undefined;
    maxContextLength?: number | undefined;
    inputPricePerM?: number | undefined;
    outputPricePerM?: number | undefined;
    supportsVision?: boolean | undefined;
    supportsReasoning?: boolean | undefined;
    supportsFunctionCalling?: boolean | undefined;
}>;
export declare const UpdateModelSchema: z.ZodObject<{
    modelId: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    capabilities: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    maxContextLength: z.ZodOptional<z.ZodNumber>;
    inputPricePerM: z.ZodOptional<z.ZodNumber>;
    outputPricePerM: z.ZodOptional<z.ZodNumber>;
    supportsVision: z.ZodOptional<z.ZodBoolean>;
    supportsReasoning: z.ZodOptional<z.ZodBoolean>;
    supportsFunctionCalling: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    modelId?: string | undefined;
    capabilities?: string[] | undefined;
    maxContextLength?: number | undefined;
    inputPricePerM?: number | undefined;
    outputPricePerM?: number | undefined;
    supportsVision?: boolean | undefined;
    supportsReasoning?: boolean | undefined;
    supportsFunctionCalling?: boolean | undefined;
}, {
    name?: string | undefined;
    modelId?: string | undefined;
    capabilities?: string[] | undefined;
    maxContextLength?: number | undefined;
    inputPricePerM?: number | undefined;
    outputPricePerM?: number | undefined;
    supportsVision?: boolean | undefined;
    supportsReasoning?: boolean | undefined;
    supportsFunctionCalling?: boolean | undefined;
}>;
export declare const TestConnectionSchema: z.ZodObject<{
    type: z.ZodEnum<["openai", "anthropic", "gemini", "custom", "openrouter"]>;
    apiKey: z.ZodString;
    baseUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    type: "openai" | "anthropic" | "gemini" | "custom" | "openrouter";
    apiKey: string;
    baseUrl?: string | null | undefined;
}, {
    type: "openai" | "anthropic" | "gemini" | "custom" | "openrouter";
    apiKey: string;
    baseUrl?: string | null | undefined;
}>;
export declare const DiscoverProviderModelsSchema: z.ZodDefault<z.ZodObject<{
    type: z.ZodOptional<z.ZodEnum<["openai", "anthropic", "gemini", "custom", "openrouter"]>>;
    apiKey: z.ZodOptional<z.ZodString>;
    baseUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    type?: "openai" | "anthropic" | "gemini" | "custom" | "openrouter" | undefined;
    apiKey?: string | undefined;
    baseUrl?: string | null | undefined;
}, {
    type?: "openai" | "anthropic" | "gemini" | "custom" | "openrouter" | undefined;
    apiKey?: string | undefined;
    baseUrl?: string | null | undefined;
}>>;
export type CreateProviderInput = z.infer<typeof CreateProviderSchema>;
export type UpdateProviderInput = z.infer<typeof UpdateProviderSchema>;
export type CreateModelInput = z.infer<typeof CreateModelSchema>;
export type UpdateModelInput = z.infer<typeof UpdateModelSchema>;
export type TestConnectionInput = z.infer<typeof TestConnectionSchema>;
export type DiscoverProviderModelsInput = z.infer<typeof DiscoverProviderModelsSchema>;
//# sourceMappingURL=provider.d.ts.map