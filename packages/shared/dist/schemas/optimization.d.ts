/**
 * Optimization Result Schema for structured output
 *
 * Used with `responseFormat` to constrain model output when analyzing prompts.
 * Supports three levels:
 * 1. json_schema  — gpt-4o, gpt-4-turbo, o1, o3, o4, gpt-5
 * 2. json_object  — claude, gemini, deepseek, qwen, gpt-3.5-turbo
 * 3. none         — fallback to regex parsing
 */
/**
 * Full JSON Schema response format for models that support `json_schema`.
 */
export declare const OPTIMIZATION_RESULT_SCHEMA: {
    type: "json_schema";
    json_schema: {
        name: string;
        strict: boolean;
        schema: {
            type: string;
            properties: {
                score: {
                    type: string;
                    description: string;
                };
                summary: {
                    type: string;
                    description: string;
                };
                strengths: {
                    type: string;
                    items: {
                        type: string;
                    };
                    description: string;
                };
                suggestions: {
                    type: string;
                    items: {
                        type: string;
                        properties: {
                            type: {
                                type: string;
                                enum: string[];
                                description: string;
                            };
                            severity: {
                                type: string;
                                enum: string[];
                                description: string;
                            };
                            title: {
                                type: string;
                                description: string;
                            };
                            description: {
                                type: string;
                                description: string;
                            };
                            messageIndex: {
                                type: string;
                                description: string;
                            };
                            originalText: {
                                type: string;
                                description: string;
                            };
                            suggestedText: {
                                type: string;
                                description: string;
                            };
                        };
                        required: string[];
                        additionalProperties: boolean;
                    };
                    description: string;
                };
            };
            required: string[];
            additionalProperties: boolean;
        };
    };
};
/**
 * Simplified JSON Object format for models that support `json_object` but not `json_schema`.
 */
export declare const OPTIMIZATION_RESULT_JSON_OBJECT_FORMAT: {
    type: "json_object";
};
/**
 * Type of structured output support level.
 */
export type StructuredOutputSupport = 'json_schema' | 'json_object' | 'none';
//# sourceMappingURL=optimization.d.ts.map