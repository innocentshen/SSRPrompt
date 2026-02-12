import { z } from 'zod';

// Prompt Variable Schema
export const PromptVariableSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
  description: z.string().optional(),
  default_value: z.string().optional(),
  required: z.boolean().optional(),
});

// Prompt Message Schema
export const PromptMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

// Output Schema
export const OutputSchemaSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  schema: z.record(z.unknown()),
  strict: z.boolean().optional(),
});

// Reasoning Config Schema
export const ReasoningConfigSchema = z.object({
  enabled: z.boolean(),
  effort: z.enum(['default', 'none', 'low', 'medium', 'high']),
});

export const PromptApiVersionModeSchema = z.enum(['latest', 'fixed']);

// Prompt Config Schema
export const PromptConfigSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  output_schema: OutputSchemaSchema.optional(),
  reasoning: ReasoningConfigSchema.optional(),
});

// Create Prompt Schema
export const CreatePromptSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  content: z.string().optional(),
  variables: z.array(PromptVariableSchema).optional().default([]),
  messages: z.array(PromptMessageSchema).optional().default([]),
  config: PromptConfigSchema.optional().default({}),
  defaultModelId: z.string().uuid().optional(),
  groupId: z.string().uuid().nullable().optional(),
  apiEnabled: z.boolean().optional().default(false),
  apiVersionMode: PromptApiVersionModeSchema.optional().default('latest'),
  apiFixedVersion: z.number().int().positive().nullable().optional(),
});

// Update Prompt Schema
export const UpdatePromptSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  variables: z.array(PromptVariableSchema).optional(),
  messages: z.array(PromptMessageSchema).optional(),
  config: PromptConfigSchema.optional(),
  defaultModelId: z.string().uuid().nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  orderIndex: z.number().int().min(0).optional(),
  apiEnabled: z.boolean().optional(),
  apiVersionMode: PromptApiVersionModeSchema.optional(),
  apiFixedVersion: z.number().int().positive().nullable().optional(),
  isPublic: z.boolean().optional(),
});

// Create Version Schema
export const CreateVersionSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  commitMessage: z.string().optional(),
  variables: z.array(PromptVariableSchema).optional(),
  messages: z.array(PromptMessageSchema).optional(),
  config: PromptConfigSchema.optional(),
  defaultModelId: z.string().uuid().nullable().optional(),
});

// Copy Public Prompt Schema
export const CopyPublicPromptSchema = z.object({
  version: z.number().int().positive().optional(),
  name: z.string().min(1).optional(),
});

// ============ Prompt Group Schemas ============

export const CreatePromptGroupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  parentId: z.string().uuid().nullable().optional(),
  orderIndex: z.number().int().min(0).optional(),
});

export const UpdatePromptGroupSchema = z.object({
  name: z.string().min(1).optional(),
  parentId: z.string().uuid().nullable().optional(),
  orderIndex: z.number().int().min(0).optional(),
});

export type PromptVariableInput = z.infer<typeof PromptVariableSchema>;
export type PromptMessageInput = z.infer<typeof PromptMessageSchema>;
export type PromptConfigInput = z.infer<typeof PromptConfigSchema>;
export type CreatePromptInput = z.infer<typeof CreatePromptSchema>;
export type UpdatePromptInput = z.infer<typeof UpdatePromptSchema>;
export type CreateVersionInput = z.infer<typeof CreateVersionSchema>;
export type CopyPublicPromptInput = z.infer<typeof CopyPublicPromptSchema>;
export type CreatePromptGroupInput = z.infer<typeof CreatePromptGroupSchema>;
export type UpdatePromptGroupInput = z.infer<typeof UpdatePromptGroupSchema>;
