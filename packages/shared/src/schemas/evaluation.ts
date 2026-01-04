import { z } from 'zod';

// File Attachment Schema
export const FileAttachmentSchema = z.object({
  name: z.string(),
  type: z.string(),
  base64: z.string(),
});

// Model Parameters Schema
export const ModelParametersSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  max_tokens: z.number().positive().optional(),
});

// Evaluation Config Schema
export const EvaluationConfigSchema = z.object({
  pass_threshold: z.number().min(0).max(100).optional(),
  model_parameters: ModelParametersSchema.optional(),
  inherited_from_prompt: z.boolean().optional(),
});

// Create Evaluation Schema
export const CreateEvaluationSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  promptId: z.string().uuid().optional(),
  modelId: z.string().uuid().optional(),
  judgeModelId: z.string().uuid().optional(),
  config: EvaluationConfigSchema.optional().default({}),
});

// Update Evaluation Schema
export const UpdateEvaluationSchema = z.object({
  name: z.string().min(1).optional(),
  promptId: z.string().uuid().nullable().optional(),
  modelId: z.string().uuid().nullable().optional(),
  judgeModelId: z.string().uuid().nullable().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  config: EvaluationConfigSchema.optional(),
  results: z.record(z.unknown()).optional(),
  completedAt: z.string().datetime().nullable().optional(),
});

// Create Test Case Schema
export const CreateTestCaseSchema = z.object({
  name: z.string().optional().default(''),
  inputText: z.string().min(1, 'Input text is required'),
  inputVariables: z.record(z.string()).optional().default({}),
  attachments: z.array(FileAttachmentSchema).optional().default([]),
  expectedOutput: z.string().optional(),
  notes: z.string().optional(),
  orderIndex: z.number().int().min(0).optional(),
});

// Update Test Case Schema
export const UpdateTestCaseSchema = z.object({
  name: z.string().optional(),
  inputText: z.string().min(1).optional(),
  inputVariables: z.record(z.string()).optional(),
  attachments: z.array(FileAttachmentSchema).optional(),
  expectedOutput: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  orderIndex: z.number().int().min(0).optional(),
});

// Create Criterion Schema
export const CreateCriterionSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  prompt: z.string().optional(),
  weight: z.number().min(0).optional().default(1.0),
  enabled: z.boolean().optional().default(true),
});

// Update Criterion Schema
export const UpdateCriterionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  prompt: z.string().nullable().optional(),
  weight: z.number().min(0).optional(),
  enabled: z.boolean().optional(),
});

export type FileAttachmentInput = z.infer<typeof FileAttachmentSchema>;
export type ModelParametersInput = z.infer<typeof ModelParametersSchema>;
export type EvaluationConfigInput = z.infer<typeof EvaluationConfigSchema>;
export type CreateEvaluationInput = z.infer<typeof CreateEvaluationSchema>;
export type UpdateEvaluationInput = z.infer<typeof UpdateEvaluationSchema>;
export type CreateTestCaseInput = z.infer<typeof CreateTestCaseSchema>;
export type UpdateTestCaseInput = z.infer<typeof UpdateTestCaseSchema>;
export type CreateCriterionInput = z.infer<typeof CreateCriterionSchema>;
export type UpdateCriterionInput = z.infer<typeof UpdateCriterionSchema>;
