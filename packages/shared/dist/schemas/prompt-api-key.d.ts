import { z } from 'zod';
export declare const CreatePromptApiKeySchema: z.ZodObject<{
    name: z.ZodString;
    expiresAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    expiresAt?: string | null | undefined;
}, {
    name: string;
    expiresAt?: string | null | undefined;
}>;
export type CreatePromptApiKeyInput = z.infer<typeof CreatePromptApiKeySchema>;
//# sourceMappingURL=prompt-api-key.d.ts.map