import { z } from 'zod';
export declare const ShareResourceTypeSchema: z.ZodEnum<["prompt", "evaluation"]>;
export declare const CreateShareLinkSchema: z.ZodObject<{
    resourceType: z.ZodEnum<["prompt", "evaluation"]>;
    resourceId: z.ZodString;
    password: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    expiresAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    allowCopy: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    resourceType: "prompt" | "evaluation";
    resourceId: string;
    expiresAt?: string | null | undefined;
    password?: string | null | undefined;
    allowCopy?: boolean | undefined;
}, {
    resourceType: "prompt" | "evaluation";
    resourceId: string;
    expiresAt?: string | null | undefined;
    password?: string | null | undefined;
    allowCopy?: boolean | undefined;
}>;
export declare const UpdateShareLinkSchema: z.ZodObject<{
    password: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    clearPassword: z.ZodOptional<z.ZodBoolean>;
    expiresAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    allowCopy: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    expiresAt?: string | null | undefined;
    password?: string | null | undefined;
    allowCopy?: boolean | undefined;
    clearPassword?: boolean | undefined;
}, {
    expiresAt?: string | null | undefined;
    password?: string | null | undefined;
    allowCopy?: boolean | undefined;
    clearPassword?: boolean | undefined;
}>;
export declare const ListShareLinksQuerySchema: z.ZodObject<{
    resourceType: z.ZodOptional<z.ZodEnum<["prompt", "evaluation"]>>;
    resourceId: z.ZodOptional<z.ZodString>;
    includeRevoked: z.ZodEffects<z.ZodOptional<z.ZodString>, boolean, string | undefined>;
    page: z.ZodEffects<z.ZodOptional<z.ZodString>, number, string | undefined>;
    pageSize: z.ZodEffects<z.ZodOptional<z.ZodString>, number, string | undefined>;
}, "strip", z.ZodTypeAny, {
    page: number;
    includeRevoked: boolean;
    pageSize: number;
    resourceType?: "prompt" | "evaluation" | undefined;
    resourceId?: string | undefined;
}, {
    page?: string | undefined;
    resourceType?: "prompt" | "evaluation" | undefined;
    resourceId?: string | undefined;
    includeRevoked?: string | undefined;
    pageSize?: string | undefined;
}>;
export declare const VerifySharePasswordSchema: z.ZodObject<{
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    password: string;
}, {
    password: string;
}>;
export type CreateShareLinkInput = z.infer<typeof CreateShareLinkSchema>;
export type UpdateShareLinkInput = z.infer<typeof UpdateShareLinkSchema>;
export type ListShareLinksQueryInput = z.infer<typeof ListShareLinksQuerySchema>;
export type VerifySharePasswordInput = z.infer<typeof VerifySharePasswordSchema>;
//# sourceMappingURL=share.d.ts.map