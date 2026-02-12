import { z } from 'zod';

export const CreatePromptApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().nullable().optional(),
});

export type CreatePromptApiKeyInput = z.infer<typeof CreatePromptApiKeySchema>;
