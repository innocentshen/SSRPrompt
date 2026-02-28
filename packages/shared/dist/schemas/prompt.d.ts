import { z } from 'zod';
export declare const PromptVariableSchema: z.ZodObject<{
    name: z.ZodString;
    type: z.ZodEnum<["string", "number", "boolean", "array", "object"]>;
    description: z.ZodOptional<z.ZodString>;
    default_value: z.ZodOptional<z.ZodString>;
    required: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    type: "string" | "number" | "boolean" | "object" | "array";
    description?: string | undefined;
    default_value?: string | undefined;
    required?: boolean | undefined;
}, {
    name: string;
    type: "string" | "number" | "boolean" | "object" | "array";
    description?: string | undefined;
    default_value?: string | undefined;
    required?: boolean | undefined;
}>;
export declare const PromptMessageSchema: z.ZodObject<{
    role: z.ZodEnum<["system", "user", "assistant"]>;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    role: "system" | "user" | "assistant";
    content: string;
}, {
    role: "system" | "user" | "assistant";
    content: string;
}>;
export declare const OutputSchemaSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    schema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    strict: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    schema: Record<string, unknown>;
    description?: string | undefined;
    strict?: boolean | undefined;
}, {
    name: string;
    schema: Record<string, unknown>;
    description?: string | undefined;
    strict?: boolean | undefined;
}>;
export declare const ReasoningConfigSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    effort: z.ZodEnum<["default", "none", "low", "medium", "high"]>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    effort: "default" | "none" | "low" | "medium" | "high";
}, {
    enabled: boolean;
    effort: "default" | "none" | "low" | "medium" | "high";
}>;
export declare const PromptApiVersionModeSchema: z.ZodEnum<["latest", "fixed"]>;
export declare const PromptConfigSchema: z.ZodObject<{
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    frequency_penalty: z.ZodOptional<z.ZodNumber>;
    presence_penalty: z.ZodOptional<z.ZodNumber>;
    max_tokens: z.ZodOptional<z.ZodNumber>;
    output_schema: z.ZodOptional<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        schema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        strict: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        schema: Record<string, unknown>;
        description?: string | undefined;
        strict?: boolean | undefined;
    }, {
        name: string;
        schema: Record<string, unknown>;
        description?: string | undefined;
        strict?: boolean | undefined;
    }>>;
    reasoning: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodBoolean;
        effort: z.ZodEnum<["default", "none", "low", "medium", "high"]>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        effort: "default" | "none" | "low" | "medium" | "high";
    }, {
        enabled: boolean;
        effort: "default" | "none" | "low" | "medium" | "high";
    }>>;
}, "strip", z.ZodTypeAny, {
    temperature?: number | undefined;
    top_p?: number | undefined;
    frequency_penalty?: number | undefined;
    presence_penalty?: number | undefined;
    max_tokens?: number | undefined;
    output_schema?: {
        name: string;
        schema: Record<string, unknown>;
        description?: string | undefined;
        strict?: boolean | undefined;
    } | undefined;
    reasoning?: {
        enabled: boolean;
        effort: "default" | "none" | "low" | "medium" | "high";
    } | undefined;
}, {
    temperature?: number | undefined;
    top_p?: number | undefined;
    frequency_penalty?: number | undefined;
    presence_penalty?: number | undefined;
    max_tokens?: number | undefined;
    output_schema?: {
        name: string;
        schema: Record<string, unknown>;
        description?: string | undefined;
        strict?: boolean | undefined;
    } | undefined;
    reasoning?: {
        enabled: boolean;
        effort: "default" | "none" | "low" | "medium" | "high";
    } | undefined;
}>;
export declare const CreatePromptSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    content: z.ZodOptional<z.ZodString>;
    variables: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodEnum<["string", "number", "boolean", "array", "object"]>;
        description: z.ZodOptional<z.ZodString>;
        default_value: z.ZodOptional<z.ZodString>;
        required: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        type: "string" | "number" | "boolean" | "object" | "array";
        description?: string | undefined;
        default_value?: string | undefined;
        required?: boolean | undefined;
    }, {
        name: string;
        type: "string" | "number" | "boolean" | "object" | "array";
        description?: string | undefined;
        default_value?: string | undefined;
        required?: boolean | undefined;
    }>, "many">>>;
    messages: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["system", "user", "assistant"]>;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        role: "system" | "user" | "assistant";
        content: string;
    }, {
        role: "system" | "user" | "assistant";
        content: string;
    }>, "many">>>;
    config: z.ZodDefault<z.ZodOptional<z.ZodObject<{
        temperature: z.ZodOptional<z.ZodNumber>;
        top_p: z.ZodOptional<z.ZodNumber>;
        frequency_penalty: z.ZodOptional<z.ZodNumber>;
        presence_penalty: z.ZodOptional<z.ZodNumber>;
        max_tokens: z.ZodOptional<z.ZodNumber>;
        output_schema: z.ZodOptional<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            schema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            strict: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        }, {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        }>>;
        reasoning: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodBoolean;
            effort: z.ZodEnum<["default", "none", "low", "medium", "high"]>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        }, {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        }>>;
    }, "strip", z.ZodTypeAny, {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
        output_schema?: {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        } | undefined;
        reasoning?: {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        } | undefined;
    }, {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
        output_schema?: {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        } | undefined;
        reasoning?: {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        } | undefined;
    }>>>;
    defaultModelId: z.ZodOptional<z.ZodString>;
    groupId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    apiEnabled: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    apiVersionMode: z.ZodDefault<z.ZodOptional<z.ZodEnum<["latest", "fixed"]>>>;
    apiFixedVersion: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    variables: {
        name: string;
        type: "string" | "number" | "boolean" | "object" | "array";
        description?: string | undefined;
        default_value?: string | undefined;
        required?: boolean | undefined;
    }[];
    messages: {
        role: "system" | "user" | "assistant";
        content: string;
    }[];
    config: {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
        output_schema?: {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        } | undefined;
        reasoning?: {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        } | undefined;
    };
    apiEnabled: boolean;
    apiVersionMode: "latest" | "fixed";
    description?: string | undefined;
    content?: string | undefined;
    defaultModelId?: string | undefined;
    groupId?: string | null | undefined;
    apiFixedVersion?: number | null | undefined;
}, {
    name: string;
    description?: string | undefined;
    content?: string | undefined;
    variables?: {
        name: string;
        type: "string" | "number" | "boolean" | "object" | "array";
        description?: string | undefined;
        default_value?: string | undefined;
        required?: boolean | undefined;
    }[] | undefined;
    messages?: {
        role: "system" | "user" | "assistant";
        content: string;
    }[] | undefined;
    config?: {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
        output_schema?: {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        } | undefined;
        reasoning?: {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        } | undefined;
    } | undefined;
    defaultModelId?: string | undefined;
    groupId?: string | null | undefined;
    apiEnabled?: boolean | undefined;
    apiVersionMode?: "latest" | "fixed" | undefined;
    apiFixedVersion?: number | null | undefined;
}>;
export declare const UpdatePromptSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    content: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    variables: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodEnum<["string", "number", "boolean", "array", "object"]>;
        description: z.ZodOptional<z.ZodString>;
        default_value: z.ZodOptional<z.ZodString>;
        required: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        type: "string" | "number" | "boolean" | "object" | "array";
        description?: string | undefined;
        default_value?: string | undefined;
        required?: boolean | undefined;
    }, {
        name: string;
        type: "string" | "number" | "boolean" | "object" | "array";
        description?: string | undefined;
        default_value?: string | undefined;
        required?: boolean | undefined;
    }>, "many">>;
    messages: z.ZodOptional<z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["system", "user", "assistant"]>;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        role: "system" | "user" | "assistant";
        content: string;
    }, {
        role: "system" | "user" | "assistant";
        content: string;
    }>, "many">>;
    config: z.ZodOptional<z.ZodObject<{
        temperature: z.ZodOptional<z.ZodNumber>;
        top_p: z.ZodOptional<z.ZodNumber>;
        frequency_penalty: z.ZodOptional<z.ZodNumber>;
        presence_penalty: z.ZodOptional<z.ZodNumber>;
        max_tokens: z.ZodOptional<z.ZodNumber>;
        output_schema: z.ZodOptional<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            schema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            strict: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        }, {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        }>>;
        reasoning: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodBoolean;
            effort: z.ZodEnum<["default", "none", "low", "medium", "high"]>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        }, {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        }>>;
    }, "strip", z.ZodTypeAny, {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
        output_schema?: {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        } | undefined;
        reasoning?: {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        } | undefined;
    }, {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
        output_schema?: {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        } | undefined;
        reasoning?: {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        } | undefined;
    }>>;
    defaultModelId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    groupId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    orderIndex: z.ZodOptional<z.ZodNumber>;
    apiEnabled: z.ZodOptional<z.ZodBoolean>;
    apiVersionMode: z.ZodOptional<z.ZodEnum<["latest", "fixed"]>>;
    apiFixedVersion: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    isPublic: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    description?: string | null | undefined;
    content?: string | null | undefined;
    variables?: {
        name: string;
        type: "string" | "number" | "boolean" | "object" | "array";
        description?: string | undefined;
        default_value?: string | undefined;
        required?: boolean | undefined;
    }[] | undefined;
    messages?: {
        role: "system" | "user" | "assistant";
        content: string;
    }[] | undefined;
    config?: {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
        output_schema?: {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        } | undefined;
        reasoning?: {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        } | undefined;
    } | undefined;
    defaultModelId?: string | null | undefined;
    groupId?: string | null | undefined;
    apiEnabled?: boolean | undefined;
    apiVersionMode?: "latest" | "fixed" | undefined;
    apiFixedVersion?: number | null | undefined;
    orderIndex?: number | undefined;
    isPublic?: boolean | undefined;
}, {
    name?: string | undefined;
    description?: string | null | undefined;
    content?: string | null | undefined;
    variables?: {
        name: string;
        type: "string" | "number" | "boolean" | "object" | "array";
        description?: string | undefined;
        default_value?: string | undefined;
        required?: boolean | undefined;
    }[] | undefined;
    messages?: {
        role: "system" | "user" | "assistant";
        content: string;
    }[] | undefined;
    config?: {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
        output_schema?: {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        } | undefined;
        reasoning?: {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        } | undefined;
    } | undefined;
    defaultModelId?: string | null | undefined;
    groupId?: string | null | undefined;
    apiEnabled?: boolean | undefined;
    apiVersionMode?: "latest" | "fixed" | undefined;
    apiFixedVersion?: number | null | undefined;
    orderIndex?: number | undefined;
    isPublic?: boolean | undefined;
}>;
export declare const CreateVersionSchema: z.ZodObject<{
    content: z.ZodString;
    commitMessage: z.ZodOptional<z.ZodString>;
    variables: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodEnum<["string", "number", "boolean", "array", "object"]>;
        description: z.ZodOptional<z.ZodString>;
        default_value: z.ZodOptional<z.ZodString>;
        required: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        type: "string" | "number" | "boolean" | "object" | "array";
        description?: string | undefined;
        default_value?: string | undefined;
        required?: boolean | undefined;
    }, {
        name: string;
        type: "string" | "number" | "boolean" | "object" | "array";
        description?: string | undefined;
        default_value?: string | undefined;
        required?: boolean | undefined;
    }>, "many">>;
    messages: z.ZodOptional<z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["system", "user", "assistant"]>;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        role: "system" | "user" | "assistant";
        content: string;
    }, {
        role: "system" | "user" | "assistant";
        content: string;
    }>, "many">>;
    config: z.ZodOptional<z.ZodObject<{
        temperature: z.ZodOptional<z.ZodNumber>;
        top_p: z.ZodOptional<z.ZodNumber>;
        frequency_penalty: z.ZodOptional<z.ZodNumber>;
        presence_penalty: z.ZodOptional<z.ZodNumber>;
        max_tokens: z.ZodOptional<z.ZodNumber>;
        output_schema: z.ZodOptional<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            schema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            strict: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        }, {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        }>>;
        reasoning: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodBoolean;
            effort: z.ZodEnum<["default", "none", "low", "medium", "high"]>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        }, {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        }>>;
    }, "strip", z.ZodTypeAny, {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
        output_schema?: {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        } | undefined;
        reasoning?: {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        } | undefined;
    }, {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
        output_schema?: {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        } | undefined;
        reasoning?: {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        } | undefined;
    }>>;
    defaultModelId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    content: string;
    variables?: {
        name: string;
        type: "string" | "number" | "boolean" | "object" | "array";
        description?: string | undefined;
        default_value?: string | undefined;
        required?: boolean | undefined;
    }[] | undefined;
    messages?: {
        role: "system" | "user" | "assistant";
        content: string;
    }[] | undefined;
    config?: {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
        output_schema?: {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        } | undefined;
        reasoning?: {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        } | undefined;
    } | undefined;
    defaultModelId?: string | null | undefined;
    commitMessage?: string | undefined;
}, {
    content: string;
    variables?: {
        name: string;
        type: "string" | "number" | "boolean" | "object" | "array";
        description?: string | undefined;
        default_value?: string | undefined;
        required?: boolean | undefined;
    }[] | undefined;
    messages?: {
        role: "system" | "user" | "assistant";
        content: string;
    }[] | undefined;
    config?: {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
        output_schema?: {
            name: string;
            schema: Record<string, unknown>;
            description?: string | undefined;
            strict?: boolean | undefined;
        } | undefined;
        reasoning?: {
            enabled: boolean;
            effort: "default" | "none" | "low" | "medium" | "high";
        } | undefined;
    } | undefined;
    defaultModelId?: string | null | undefined;
    commitMessage?: string | undefined;
}>;
export declare const CopyPublicPromptSchema: z.ZodObject<{
    version: z.ZodOptional<z.ZodNumber>;
    name: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    version?: number | undefined;
}, {
    name?: string | undefined;
    version?: number | undefined;
}>;
export declare const CreatePromptGroupSchema: z.ZodObject<{
    name: z.ZodString;
    parentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    orderIndex: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    name: string;
    orderIndex?: number | undefined;
    parentId?: string | null | undefined;
}, {
    name: string;
    orderIndex?: number | undefined;
    parentId?: string | null | undefined;
}>;
export declare const UpdatePromptGroupSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    parentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    orderIndex: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    orderIndex?: number | undefined;
    parentId?: string | null | undefined;
}, {
    name?: string | undefined;
    orderIndex?: number | undefined;
    parentId?: string | null | undefined;
}>;
export type PromptVariableInput = z.infer<typeof PromptVariableSchema>;
export type PromptMessageInput = z.infer<typeof PromptMessageSchema>;
export type PromptConfigInput = z.infer<typeof PromptConfigSchema>;
export type CreatePromptInput = z.infer<typeof CreatePromptSchema>;
export type UpdatePromptInput = z.infer<typeof UpdatePromptSchema>;
export type CreateVersionInput = z.infer<typeof CreateVersionSchema>;
export type CopyPublicPromptInput = z.infer<typeof CopyPublicPromptSchema>;
export type CreatePromptGroupInput = z.infer<typeof CreatePromptGroupSchema>;
export type UpdatePromptGroupInput = z.infer<typeof UpdatePromptGroupSchema>;
//# sourceMappingURL=prompt.d.ts.map