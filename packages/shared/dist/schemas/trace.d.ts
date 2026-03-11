import { z } from 'zod';
export declare const TraceSourceSchema: z.ZodEnum<["feature", "api"]>;
export declare const CreateTraceSchema: z.ZodObject<{
    promptId: z.ZodOptional<z.ZodString>;
    modelId: z.ZodOptional<z.ZodString>;
    source: z.ZodDefault<z.ZodOptional<z.ZodEnum<["feature", "api"]>>>;
    input: z.ZodString;
    output: z.ZodOptional<z.ZodString>;
    tokensInput: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    tokensOutput: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    latencyMs: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    status: z.ZodDefault<z.ZodOptional<z.ZodEnum<["success", "error"]>>>;
    errorMessage: z.ZodOptional<z.ZodString>;
    metadata: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        fileId: z.ZodString;
        name: z.ZodString;
        type: z.ZodString;
        size: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        type: string;
        fileId: string;
        size?: number | undefined;
    }, {
        name: string;
        type: string;
        fileId: string;
        size?: number | undefined;
    }>, "many">>;
    thinkingContent: z.ZodOptional<z.ZodString>;
    thinkingTimeMs: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    status: "success" | "error";
    source: "feature" | "api";
    input: string;
    tokensInput: number;
    tokensOutput: number;
    latencyMs: number;
    metadata: Record<string, unknown>;
    modelId?: string | undefined;
    promptId?: string | undefined;
    attachments?: {
        name: string;
        type: string;
        fileId: string;
        size?: number | undefined;
    }[] | undefined;
    output?: string | undefined;
    errorMessage?: string | undefined;
    thinkingContent?: string | undefined;
    thinkingTimeMs?: number | undefined;
}, {
    input: string;
    status?: "success" | "error" | undefined;
    modelId?: string | undefined;
    promptId?: string | undefined;
    attachments?: {
        name: string;
        type: string;
        fileId: string;
        size?: number | undefined;
    }[] | undefined;
    source?: "feature" | "api" | undefined;
    output?: string | undefined;
    tokensInput?: number | undefined;
    tokensOutput?: number | undefined;
    latencyMs?: number | undefined;
    errorMessage?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    thinkingContent?: string | undefined;
    thinkingTimeMs?: number | undefined;
}>;
export declare const TraceQuerySchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    promptId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["success", "error"]>>;
    source: z.ZodOptional<z.ZodEnum<["feature", "api"]>>;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    status?: "success" | "error" | undefined;
    promptId?: string | undefined;
    source?: "feature" | "api" | undefined;
}, {
    status?: "success" | "error" | undefined;
    promptId?: string | undefined;
    source?: "feature" | "api" | undefined;
    page?: number | undefined;
    limit?: number | undefined;
}>;
export type CreateTraceInput = z.infer<typeof CreateTraceSchema>;
export type TraceQueryInput = z.infer<typeof TraceQuerySchema>;
//# sourceMappingURL=trace.d.ts.map