import { z } from 'zod';
export const CreatePromptApiKeySchema = z.object({
    name: z.string().min(1).max(100),
    expiresAt: z.string().datetime().nullable().optional(),
});
//# sourceMappingURL=prompt-api-key.js.map