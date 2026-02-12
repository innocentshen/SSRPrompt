import { z } from 'zod';

export const ShareResourceTypeSchema = z.enum(['prompt', 'evaluation']);

export const CreateShareLinkSchema = z.object({
  resourceType: ShareResourceTypeSchema,
  resourceId: z.string().uuid(),
  password: z.string().min(1).max(128).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  allowCopy: z.boolean().optional(),
});

export const UpdateShareLinkSchema = z.object({
  password: z.string().min(1).max(128).nullable().optional(),
  clearPassword: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  allowCopy: z.boolean().optional(),
});

export const ListShareLinksQuerySchema = z.object({
  resourceType: ShareResourceTypeSchema.optional(),
  includeRevoked: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  page: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return 1;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    }),
  pageSize: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return 20;
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return 20;
      return Math.min(parsed, 100);
    }),
});

export const VerifySharePasswordSchema = z.object({
  password: z.string().min(1).max(128),
});

export type CreateShareLinkInput = z.infer<typeof CreateShareLinkSchema>;
export type UpdateShareLinkInput = z.infer<typeof UpdateShareLinkSchema>;
export type ListShareLinksQueryInput = z.infer<typeof ListShareLinksQuerySchema>;
export type VerifySharePasswordInput = z.infer<typeof VerifySharePasswordSchema>;
