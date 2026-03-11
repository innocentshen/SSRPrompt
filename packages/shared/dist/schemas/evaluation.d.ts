import { z } from 'zod';
export declare const FileAttachmentSchema: z.ZodObject<{
    fileId: z.ZodString;
    name: z.ZodString;
    type: z.ZodString;
    size: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: string;
    fileId: string;
    name: string;
    size?: number | undefined;
}, {
    type: string;
    fileId: string;
    name: string;
    size?: number | undefined;
}>;
export declare const ModelParametersSchema: z.ZodObject<{
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    frequency_penalty: z.ZodOptional<z.ZodNumber>;
    presence_penalty: z.ZodOptional<z.ZodNumber>;
    max_tokens: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    temperature?: number | undefined;
    top_p?: number | undefined;
    frequency_penalty?: number | undefined;
    presence_penalty?: number | undefined;
    max_tokens?: number | undefined;
}, {
    temperature?: number | undefined;
    top_p?: number | undefined;
    frequency_penalty?: number | undefined;
    presence_penalty?: number | undefined;
    max_tokens?: number | undefined;
}>;
export declare const EvaluationConfigSchema: z.ZodObject<{
    pass_threshold: z.ZodOptional<z.ZodNumber>;
    model_parameters: z.ZodOptional<z.ZodObject<{
        temperature: z.ZodOptional<z.ZodNumber>;
        top_p: z.ZodOptional<z.ZodNumber>;
        frequency_penalty: z.ZodOptional<z.ZodNumber>;
        presence_penalty: z.ZodOptional<z.ZodNumber>;
        max_tokens: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
    }, {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
    }>>;
    inherited_from_prompt: z.ZodOptional<z.ZodBoolean>;
    file_processing: z.ZodOptional<z.ZodEnum<["auto", "vision", "ocr", "none"]>>;
    ocr_provider: z.ZodOptional<z.ZodEnum<["paddle", "paddle_vl", "paddle_vl_1_5", "datalab", "mineru", "multimodal_model"]>>;
}, "strip", z.ZodTypeAny, {
    pass_threshold?: number | undefined;
    model_parameters?: {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
    } | undefined;
    inherited_from_prompt?: boolean | undefined;
    file_processing?: "auto" | "vision" | "ocr" | "none" | undefined;
    ocr_provider?: "paddle" | "paddle_vl" | "paddle_vl_1_5" | "datalab" | "mineru" | "multimodal_model" | undefined;
}, {
    pass_threshold?: number | undefined;
    model_parameters?: {
        temperature?: number | undefined;
        top_p?: number | undefined;
        frequency_penalty?: number | undefined;
        presence_penalty?: number | undefined;
        max_tokens?: number | undefined;
    } | undefined;
    inherited_from_prompt?: boolean | undefined;
    file_processing?: "auto" | "vision" | "ocr" | "none" | undefined;
    ocr_provider?: "paddle" | "paddle_vl" | "paddle_vl_1_5" | "datalab" | "mineru" | "multimodal_model" | undefined;
}>;
export declare const CreateEvaluationSchema: z.ZodObject<{
    name: z.ZodString;
    promptId: z.ZodOptional<z.ZodString>;
    modelId: z.ZodOptional<z.ZodString>;
    judgeModelId: z.ZodOptional<z.ZodString>;
    config: z.ZodDefault<z.ZodOptional<z.ZodObject<{
        pass_threshold: z.ZodOptional<z.ZodNumber>;
        model_parameters: z.ZodOptional<z.ZodObject<{
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            frequency_penalty: z.ZodOptional<z.ZodNumber>;
            presence_penalty: z.ZodOptional<z.ZodNumber>;
            max_tokens: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            temperature?: number | undefined;
            top_p?: number | undefined;
            frequency_penalty?: number | undefined;
            presence_penalty?: number | undefined;
            max_tokens?: number | undefined;
        }, {
            temperature?: number | undefined;
            top_p?: number | undefined;
            frequency_penalty?: number | undefined;
            presence_penalty?: number | undefined;
            max_tokens?: number | undefined;
        }>>;
        inherited_from_prompt: z.ZodOptional<z.ZodBoolean>;
        file_processing: z.ZodOptional<z.ZodEnum<["auto", "vision", "ocr", "none"]>>;
        ocr_provider: z.ZodOptional<z.ZodEnum<["paddle", "paddle_vl", "paddle_vl_1_5", "datalab", "mineru", "multimodal_model"]>>;
    }, "strip", z.ZodTypeAny, {
        pass_threshold?: number | undefined;
        model_parameters?: {
            temperature?: number | undefined;
            top_p?: number | undefined;
            frequency_penalty?: number | undefined;
            presence_penalty?: number | undefined;
            max_tokens?: number | undefined;
        } | undefined;
        inherited_from_prompt?: boolean | undefined;
        file_processing?: "auto" | "vision" | "ocr" | "none" | undefined;
        ocr_provider?: "paddle" | "paddle_vl" | "paddle_vl_1_5" | "datalab" | "mineru" | "multimodal_model" | undefined;
    }, {
        pass_threshold?: number | undefined;
        model_parameters?: {
            temperature?: number | undefined;
            top_p?: number | undefined;
            frequency_penalty?: number | undefined;
            presence_penalty?: number | undefined;
            max_tokens?: number | undefined;
        } | undefined;
        inherited_from_prompt?: boolean | undefined;
        file_processing?: "auto" | "vision" | "ocr" | "none" | undefined;
        ocr_provider?: "paddle" | "paddle_vl" | "paddle_vl_1_5" | "datalab" | "mineru" | "multimodal_model" | undefined;
    }>>>;
    orderIndex: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    name: string;
    config: {
        pass_threshold?: number | undefined;
        model_parameters?: {
            temperature?: number | undefined;
            top_p?: number | undefined;
            frequency_penalty?: number | undefined;
            presence_penalty?: number | undefined;
            max_tokens?: number | undefined;
        } | undefined;
        inherited_from_prompt?: boolean | undefined;
        file_processing?: "auto" | "vision" | "ocr" | "none" | undefined;
        ocr_provider?: "paddle" | "paddle_vl" | "paddle_vl_1_5" | "datalab" | "mineru" | "multimodal_model" | undefined;
    };
    modelId?: string | undefined;
    promptId?: string | undefined;
    judgeModelId?: string | undefined;
    orderIndex?: number | undefined;
}, {
    name: string;
    modelId?: string | undefined;
    promptId?: string | undefined;
    judgeModelId?: string | undefined;
    config?: {
        pass_threshold?: number | undefined;
        model_parameters?: {
            temperature?: number | undefined;
            top_p?: number | undefined;
            frequency_penalty?: number | undefined;
            presence_penalty?: number | undefined;
            max_tokens?: number | undefined;
        } | undefined;
        inherited_from_prompt?: boolean | undefined;
        file_processing?: "auto" | "vision" | "ocr" | "none" | undefined;
        ocr_provider?: "paddle" | "paddle_vl" | "paddle_vl_1_5" | "datalab" | "mineru" | "multimodal_model" | undefined;
    } | undefined;
    orderIndex?: number | undefined;
}>;
export declare const UpdateEvaluationSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    promptId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    modelId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    judgeModelId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodEnum<["pending", "running", "completed", "failed"]>>;
    config: z.ZodOptional<z.ZodObject<{
        pass_threshold: z.ZodOptional<z.ZodNumber>;
        model_parameters: z.ZodOptional<z.ZodObject<{
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            frequency_penalty: z.ZodOptional<z.ZodNumber>;
            presence_penalty: z.ZodOptional<z.ZodNumber>;
            max_tokens: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            temperature?: number | undefined;
            top_p?: number | undefined;
            frequency_penalty?: number | undefined;
            presence_penalty?: number | undefined;
            max_tokens?: number | undefined;
        }, {
            temperature?: number | undefined;
            top_p?: number | undefined;
            frequency_penalty?: number | undefined;
            presence_penalty?: number | undefined;
            max_tokens?: number | undefined;
        }>>;
        inherited_from_prompt: z.ZodOptional<z.ZodBoolean>;
        file_processing: z.ZodOptional<z.ZodEnum<["auto", "vision", "ocr", "none"]>>;
        ocr_provider: z.ZodOptional<z.ZodEnum<["paddle", "paddle_vl", "paddle_vl_1_5", "datalab", "mineru", "multimodal_model"]>>;
    }, "strip", z.ZodTypeAny, {
        pass_threshold?: number | undefined;
        model_parameters?: {
            temperature?: number | undefined;
            top_p?: number | undefined;
            frequency_penalty?: number | undefined;
            presence_penalty?: number | undefined;
            max_tokens?: number | undefined;
        } | undefined;
        inherited_from_prompt?: boolean | undefined;
        file_processing?: "auto" | "vision" | "ocr" | "none" | undefined;
        ocr_provider?: "paddle" | "paddle_vl" | "paddle_vl_1_5" | "datalab" | "mineru" | "multimodal_model" | undefined;
    }, {
        pass_threshold?: number | undefined;
        model_parameters?: {
            temperature?: number | undefined;
            top_p?: number | undefined;
            frequency_penalty?: number | undefined;
            presence_penalty?: number | undefined;
            max_tokens?: number | undefined;
        } | undefined;
        inherited_from_prompt?: boolean | undefined;
        file_processing?: "auto" | "vision" | "ocr" | "none" | undefined;
        ocr_provider?: "paddle" | "paddle_vl" | "paddle_vl_1_5" | "datalab" | "mineru" | "multimodal_model" | undefined;
    }>>;
    results: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    isPublic: z.ZodOptional<z.ZodBoolean>;
    shareAttachments: z.ZodOptional<z.ZodBoolean>;
    completedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    orderIndex: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    status?: "failed" | "pending" | "running" | "completed" | undefined;
    modelId?: string | null | undefined;
    name?: string | undefined;
    promptId?: string | null | undefined;
    judgeModelId?: string | null | undefined;
    config?: {
        pass_threshold?: number | undefined;
        model_parameters?: {
            temperature?: number | undefined;
            top_p?: number | undefined;
            frequency_penalty?: number | undefined;
            presence_penalty?: number | undefined;
            max_tokens?: number | undefined;
        } | undefined;
        inherited_from_prompt?: boolean | undefined;
        file_processing?: "auto" | "vision" | "ocr" | "none" | undefined;
        ocr_provider?: "paddle" | "paddle_vl" | "paddle_vl_1_5" | "datalab" | "mineru" | "multimodal_model" | undefined;
    } | undefined;
    orderIndex?: number | undefined;
    results?: Record<string, unknown> | undefined;
    isPublic?: boolean | undefined;
    shareAttachments?: boolean | undefined;
    completedAt?: string | null | undefined;
}, {
    status?: "failed" | "pending" | "running" | "completed" | undefined;
    modelId?: string | null | undefined;
    name?: string | undefined;
    promptId?: string | null | undefined;
    judgeModelId?: string | null | undefined;
    config?: {
        pass_threshold?: number | undefined;
        model_parameters?: {
            temperature?: number | undefined;
            top_p?: number | undefined;
            frequency_penalty?: number | undefined;
            presence_penalty?: number | undefined;
            max_tokens?: number | undefined;
        } | undefined;
        inherited_from_prompt?: boolean | undefined;
        file_processing?: "auto" | "vision" | "ocr" | "none" | undefined;
        ocr_provider?: "paddle" | "paddle_vl" | "paddle_vl_1_5" | "datalab" | "mineru" | "multimodal_model" | undefined;
    } | undefined;
    orderIndex?: number | undefined;
    results?: Record<string, unknown> | undefined;
    isPublic?: boolean | undefined;
    shareAttachments?: boolean | undefined;
    completedAt?: string | null | undefined;
}>;
export declare const CreateTestCaseSchema: z.ZodObject<{
    name: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    inputText: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    inputVariables: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>>;
    attachments: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
        fileId: z.ZodString;
        name: z.ZodString;
        type: z.ZodString;
        size: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        fileId: string;
        name: string;
        size?: number | undefined;
    }, {
        type: string;
        fileId: string;
        name: string;
        size?: number | undefined;
    }>, "many">>>;
    expectedOutput: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
    orderIndex: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    name: string;
    inputText: string;
    inputVariables: Record<string, string>;
    attachments: {
        type: string;
        fileId: string;
        name: string;
        size?: number | undefined;
    }[];
    orderIndex?: number | undefined;
    expectedOutput?: string | undefined;
    notes?: string | undefined;
}, {
    name?: string | undefined;
    orderIndex?: number | undefined;
    inputText?: string | undefined;
    inputVariables?: Record<string, string> | undefined;
    attachments?: {
        type: string;
        fileId: string;
        name: string;
        size?: number | undefined;
    }[] | undefined;
    expectedOutput?: string | undefined;
    notes?: string | undefined;
}>;
export declare const UpdateTestCaseSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    inputText: z.ZodOptional<z.ZodString>;
    inputVariables: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        fileId: z.ZodString;
        name: z.ZodString;
        type: z.ZodString;
        size: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        fileId: string;
        name: string;
        size?: number | undefined;
    }, {
        type: string;
        fileId: string;
        name: string;
        size?: number | undefined;
    }>, "many">>;
    expectedOutput: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    notes: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    orderIndex: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    orderIndex?: number | undefined;
    inputText?: string | undefined;
    inputVariables?: Record<string, string> | undefined;
    attachments?: {
        type: string;
        fileId: string;
        name: string;
        size?: number | undefined;
    }[] | undefined;
    expectedOutput?: string | null | undefined;
    notes?: string | null | undefined;
}, {
    name?: string | undefined;
    orderIndex?: number | undefined;
    inputText?: string | undefined;
    inputVariables?: Record<string, string> | undefined;
    attachments?: {
        type: string;
        fileId: string;
        name: string;
        size?: number | undefined;
    }[] | undefined;
    expectedOutput?: string | null | undefined;
    notes?: string | null | undefined;
}>;
export declare const CreateCriterionSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    prompt: z.ZodOptional<z.ZodString>;
    weight: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    enabled: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    name: string;
    weight: number;
    prompt?: string | undefined;
    description?: string | undefined;
}, {
    name: string;
    prompt?: string | undefined;
    enabled?: boolean | undefined;
    description?: string | undefined;
    weight?: number | undefined;
}>;
export declare const UpdateCriterionSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    prompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    weight: z.ZodOptional<z.ZodNumber>;
    enabled: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    prompt?: string | null | undefined;
    enabled?: boolean | undefined;
    name?: string | undefined;
    description?: string | null | undefined;
    weight?: number | undefined;
}, {
    prompt?: string | null | undefined;
    enabled?: boolean | undefined;
    name?: string | undefined;
    description?: string | null | undefined;
    weight?: number | undefined;
}>;
export type FileAttachmentInput = z.infer<typeof FileAttachmentSchema>;
export type ModelParametersInput = z.infer<typeof ModelParametersSchema>;
export type EvaluationConfigInput = z.infer<typeof EvaluationConfigSchema>;
export type CreateEvaluationInput = z.infer<typeof CreateEvaluationSchema>;
export type UpdateEvaluationInput = z.infer<typeof UpdateEvaluationSchema>;
export type CreateTestCaseInput = z.infer<typeof CreateTestCaseSchema>;
export type UpdateTestCaseInput = z.infer<typeof UpdateTestCaseSchema>;
export type CreateCriterionInput = z.infer<typeof CreateCriterionSchema>;
export type UpdateCriterionInput = z.infer<typeof UpdateCriterionSchema>;
//# sourceMappingURL=evaluation.d.ts.map