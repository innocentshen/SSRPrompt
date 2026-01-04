import { z } from 'zod';
import { FileAttachmentSchema } from './evaluation';

// Create Trace Schema
export const CreateTraceSchema = z.object({
  promptId: z.string().uuid().optional(),
  modelId: z.string().uuid().optional(),
  input: z.string().min(1, 'Input is required'),
  output: z.string().optional(),
  tokensInput: z.number().int().min(0).optional().default(0),
  tokensOutput: z.number().int().min(0).optional().default(0),
  latencyMs: z.number().int().min(0).optional().default(0),
  status: z.enum(['success', 'error']).optional().default('success'),
  errorMessage: z.string().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
  attachments: z.array(FileAttachmentSchema).optional(),
  thinkingContent: z.string().optional(),
  thinkingTimeMs: z.number().int().min(0).optional(),
});

// Trace Query Schema
export const TraceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  promptId: z.string().uuid().optional(),
  status: z.enum(['success', 'error']).optional(),
});

export type CreateTraceInput = z.infer<typeof CreateTraceSchema>;
export type TraceQueryInput = z.infer<typeof TraceQuerySchema>;
