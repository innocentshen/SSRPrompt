import { z } from 'zod';

// Provider Schemas
export const ProviderTypeSchema = z.enum(['openai', 'anthropic', 'gemini', 'custom', 'openrouter']);

export const CreateProviderSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: ProviderTypeSchema,
  apiKey: z.string().min(1, 'API Key is required'),
  baseUrl: z.string().url().optional(),
  enabled: z.boolean().optional().default(false),
});

export const UpdateProviderSchema = z.object({
  name: z.string().min(1).optional(),
  type: ProviderTypeSchema.optional(),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().nullable().optional(),
  enabled: z.boolean().optional(),
});

// Model Schemas
export const CreateModelSchema = z.object({
  modelId: z.string().min(1, 'Model ID is required'),
  name: z.string().min(1, 'Name is required'),
  capabilities: z.array(z.string()).optional().default([]),
  supportsVision: z.boolean().optional().default(true),
  supportsReasoning: z.boolean().optional().default(false),
  supportsFunctionCalling: z.boolean().optional().default(false),
});

export const UpdateModelSchema = z.object({
  name: z.string().min(1).optional(),
  capabilities: z.array(z.string()).optional(),
  supportsVision: z.boolean().optional(),
  supportsReasoning: z.boolean().optional(),
  supportsFunctionCalling: z.boolean().optional(),
});

export type CreateProviderInput = z.infer<typeof CreateProviderSchema>;
export type UpdateProviderInput = z.infer<typeof UpdateProviderSchema>;
export type CreateModelInput = z.infer<typeof CreateModelSchema>;
export type UpdateModelInput = z.infer<typeof UpdateModelSchema>;
