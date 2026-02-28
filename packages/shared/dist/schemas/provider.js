import { z } from 'zod';
// Provider Schemas
export const ProviderTypeSchema = z.enum(['openai', 'anthropic', 'gemini', 'custom', 'openrouter']);
export const CreateProviderSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    type: ProviderTypeSchema,
    // Allow creating a provider without an API key (UI creates the provider first, then saves the key later).
    apiKey: z.string().optional().default(''),
    baseUrl: z.string().url().optional(),
    enabled: z.boolean().optional().default(false),
    // System providers are shared across all users; only admins can create them (enforced server-side).
    isSystem: z.boolean().optional().default(false),
});
export const UpdateProviderSchema = z.object({
    name: z.string().min(1).optional(),
    type: ProviderTypeSchema.optional(),
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url().nullable().optional(),
    enabled: z.boolean().optional(),
    // Only admins can change system provider status (enforced server-side).
    isSystem: z.boolean().optional(),
});
// Model Schemas
export const CreateModelSchema = z.object({
    modelId: z.string().min(1, 'Model ID is required'),
    name: z.string().min(1, 'Name is required'),
    capabilities: z.array(z.string()).optional().default([]),
    maxContextLength: z.number().int().min(256).optional().default(128000),
    inputPricePerM: z.number().min(0).optional().default(0),
    outputPricePerM: z.number().min(0).optional().default(0),
    supportsVision: z.boolean().optional().default(false),
    supportsReasoning: z.boolean().optional().default(false),
    supportsFunctionCalling: z.boolean().optional().default(false),
});
export const UpdateModelSchema = z.object({
    modelId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    capabilities: z.array(z.string()).optional(),
    maxContextLength: z.number().int().min(256).optional(),
    inputPricePerM: z.number().min(0).optional(),
    outputPricePerM: z.number().min(0).optional(),
    supportsVision: z.boolean().optional(),
    supportsReasoning: z.boolean().optional(),
    supportsFunctionCalling: z.boolean().optional(),
});
// Test Connection Schema
export const TestConnectionSchema = z.object({
    type: ProviderTypeSchema,
    apiKey: z.string().min(1, 'API Key is required'),
    baseUrl: z.string().url().nullable().optional(),
});
// Discover Provider Models Schema
// Allows fetching models using either the saved provider config or temporary overrides from the UI.
export const DiscoverProviderModelsSchema = z
    .object({
    type: ProviderTypeSchema.optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().nullable().optional(),
})
    .default({});
//# sourceMappingURL=provider.js.map