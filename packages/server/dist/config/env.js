import 'dotenv/config';
import { z } from 'zod';
function isValidUrl(value) {
    try {
        new URL(value);
        return true;
    }
    catch {
        return false;
    }
}
function isValidPgIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
/**
 * Environment variable schema with validation
 * Server will crash on startup if required variables are missing
 */
const envSchema = z
    .object({
    // Server
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().transform(Number).default('3001'),
    // Database
    DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL URL'),
    GRAPHILE_WORKER_SCHEMA: z
        .string()
        .optional()
        .default('graphile_worker')
        .refine((value) => isValidPgIdentifier(value), {
        message: 'GRAPHILE_WORKER_SCHEMA must be a valid PostgreSQL identifier',
    }),
    // Authentication
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    REQUIRE_EMAIL_VERIFICATION: z
        .string()
        .optional()
        .default('false')
        .transform((v) => v === 'true' || v === '1'),
    // Encryption
    ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
    // CORS
    CORS_ORIGIN: z.string().optional().default('http://localhost:5173'),
    // Rate limiting (optional)
    RATE_LIMIT_WINDOW_MS: z.string().transform(Number).optional().default('60000'),
    RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).optional().default('100'),
    // File Storage (S3 compatible, e.g. MinIO)
    S3_ENDPOINT: z
        .string()
        .optional()
        .transform((v) => {
        if (!v)
            return undefined;
        const trimmed = v.trim();
        if (!trimmed)
            return undefined;
        return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    })
        .refine((v) => v === undefined || isValidUrl(v), {
        message: 'S3_ENDPOINT must be a valid URL (or host, e.g. jpminio.zeabur.app)',
    }),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_REGION: z.string().optional().default('us-east-1'),
    S3_FORCE_PATH_STYLE: z
        .string()
        .optional()
        .default('true')
        .transform((v) => v === 'true' || v === '1'),
    // Registration control
    ALLOW_REGISTRATION: z
        .string()
        .optional()
        .default('true')
        .transform((v) => v === 'true' || v === '1'),
    AUTO_SEED_ON_STARTUP: z
        .string()
        .optional()
        .default('true')
        .transform((v) => v === 'true' || v === '1'),
    ADMIN_EMAIL: z.string().min(1, 'ADMIN_EMAIL is required'),
    ADMIN_PASSWORD: z.string().min(1, 'ADMIN_PASSWORD is required'),
    // Evaluation queue self-healing
    EVALUATION_QUEUE_RECOVERY_ENABLED: z
        .string()
        .optional()
        .default('true')
        .transform((v) => v === 'true' || v === '1'),
    EVALUATION_QUEUE_RECOVERY_INTERVAL_MS: z.string().optional().default('15000').transform(Number),
    EVALUATION_QUEUE_RECOVERY_MIN_PENDING_AGE_MS: z.string().optional().default('20000').transform(Number),
    EVALUATION_QUEUE_RECOVERY_RUN_BATCH_SIZE: z.string().optional().default('50').transform(Number),
    EVALUATION_QUEUE_RECOVERY_IMPORT_BATCH_SIZE: z.string().optional().default('20').transform(Number),
    // SMTP (optional; required when using email verification / password reset emails)
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().optional().default('587').transform(Number),
    SMTP_SECURE: z
        .string()
        .optional()
        .default('false')
        .transform((v) => v === 'true' || v === '1'),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    // OAuth (optional; required when enabled)
    OAUTH_GOOGLE_ENABLED: z
        .string()
        .optional()
        .default('false')
        .transform((v) => v === 'true' || v === '1'),
    OAUTH_GOOGLE_CLIENT_ID: z.string().optional(),
    OAUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
    OAUTH_GOOGLE_CALLBACK_URL: z
        .string()
        .optional()
        .refine((v) => v === undefined || isValidUrl(v), { message: 'OAUTH_GOOGLE_CALLBACK_URL must be a valid URL' }),
    OAUTH_LINUXDO_ENABLED: z
        .string()
        .optional()
        .default('false')
        .transform((v) => v === 'true' || v === '1'),
    OAUTH_LINUXDO_CLIENT_ID: z.string().optional(),
    OAUTH_LINUXDO_CLIENT_SECRET: z.string().optional(),
    OAUTH_LINUXDO_CALLBACK_URL: z
        .string()
        .optional()
        .refine((v) => v === undefined || isValidUrl(v), { message: 'OAUTH_LINUXDO_CALLBACK_URL must be a valid URL' }),
})
    .superRefine((values, ctx) => {
    if (!Number.isFinite(values.EVALUATION_QUEUE_RECOVERY_INTERVAL_MS) || values.EVALUATION_QUEUE_RECOVERY_INTERVAL_MS < 1000) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['EVALUATION_QUEUE_RECOVERY_INTERVAL_MS'],
            message: 'EVALUATION_QUEUE_RECOVERY_INTERVAL_MS must be a number >= 1000',
        });
    }
    if (!Number.isFinite(values.EVALUATION_QUEUE_RECOVERY_MIN_PENDING_AGE_MS) ||
        values.EVALUATION_QUEUE_RECOVERY_MIN_PENDING_AGE_MS < 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['EVALUATION_QUEUE_RECOVERY_MIN_PENDING_AGE_MS'],
            message: 'EVALUATION_QUEUE_RECOVERY_MIN_PENDING_AGE_MS must be a number >= 0',
        });
    }
    if (!Number.isInteger(values.EVALUATION_QUEUE_RECOVERY_RUN_BATCH_SIZE) ||
        values.EVALUATION_QUEUE_RECOVERY_RUN_BATCH_SIZE < 1) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['EVALUATION_QUEUE_RECOVERY_RUN_BATCH_SIZE'],
            message: 'EVALUATION_QUEUE_RECOVERY_RUN_BATCH_SIZE must be an integer >= 1',
        });
    }
    if (!Number.isInteger(values.EVALUATION_QUEUE_RECOVERY_IMPORT_BATCH_SIZE) ||
        values.EVALUATION_QUEUE_RECOVERY_IMPORT_BATCH_SIZE < 1) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['EVALUATION_QUEUE_RECOVERY_IMPORT_BATCH_SIZE'],
            message: 'EVALUATION_QUEUE_RECOVERY_IMPORT_BATCH_SIZE must be an integer >= 1',
        });
    }
    // Email verification requires SMTP configured
    if (values.REQUIRE_EMAIL_VERIFICATION) {
        const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
        required.forEach((key) => {
            if (!values[key] || String(values[key]).trim().length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [key],
                    message: `${String(key)} is required when REQUIRE_EMAIL_VERIFICATION is enabled`,
                });
            }
        });
    }
    // OAuth providers require their credentials configured when enabled
    if (values.OAUTH_GOOGLE_ENABLED) {
        ['OAUTH_GOOGLE_CLIENT_ID', 'OAUTH_GOOGLE_CLIENT_SECRET', 'OAUTH_GOOGLE_CALLBACK_URL'].forEach((key) => {
            if (!values[key] || String(values[key]).trim().length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [key],
                    message: `${String(key)} is required when OAUTH_GOOGLE_ENABLED is true`,
                });
            }
        });
    }
    if (values.OAUTH_LINUXDO_ENABLED) {
        ['OAUTH_LINUXDO_CLIENT_ID', 'OAUTH_LINUXDO_CLIENT_SECRET', 'OAUTH_LINUXDO_CALLBACK_URL'].forEach((key) => {
            if (!values[key] || String(values[key]).trim().length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [key],
                    message: `${String(key)} is required when OAUTH_LINUXDO_ENABLED is true`,
                });
            }
        });
    }
});
function validateEnv() {
    try {
        return envSchema.parse(process.env);
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            console.error('Environment validation failed:');
            error.errors.forEach((err) => {
                console.error(`  - ${err.path.join('.')}: ${err.message}`);
            });
            process.exit(1);
        }
        throw error;
    }
}
export const env = validateEnv();
console.log('Environment validated successfully');
console.log(`   NODE_ENV: ${env.NODE_ENV}`);
console.log(`   PORT: ${env.PORT}`);
//# sourceMappingURL=env.js.map