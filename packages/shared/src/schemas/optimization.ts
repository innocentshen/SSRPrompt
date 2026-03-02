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
export const OPTIMIZATION_RESULT_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'optimization_result',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        score: {
          type: 'integer',
          description: 'Overall quality score from 0 to 100',
        },
        summary: {
          type: 'string',
          description: 'Overall evaluation in 1-2 sentences',
        },
        strengths: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of strengths found in the prompt',
        },
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['clarity', 'structure', 'specificity', 'examples', 'constraints'],
                description: 'Category of the suggestion',
              },
              severity: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Importance level: high=must improve, medium=should improve, low=optional',
              },
              title: {
                type: 'string',
                description: 'Brief suggestion title',
              },
              description: {
                type: 'string',
                description: 'Detailed explanation of why this improvement is needed',
              },
              messageIndex: {
                type: 'integer',
                description: 'Index of the message this suggestion targets (matches [MSG-N] tag, 0-indexed)',
              },
              originalText: {
                type: 'string',
                description: 'Exact substring from the original prompt that needs improvement',
              },
              suggestedText: {
                type: 'string',
                description: 'Suggested replacement text',
              },
            },
            required: ['type', 'severity', 'title', 'description', 'messageIndex', 'originalText', 'suggestedText'],
            additionalProperties: false,
          },
          description: 'List of improvement suggestions',
        },
      },
      required: ['score', 'summary', 'strengths', 'suggestions'],
      additionalProperties: false,
    },
  },
};

/**
 * Simplified JSON Object format for models that support `json_object` but not `json_schema`.
 */
export const OPTIMIZATION_RESULT_JSON_OBJECT_FORMAT = {
  type: 'json_object' as const,
};

/**
 * Type of structured output support level.
 */
export type StructuredOutputSupport = 'json_schema' | 'json_object' | 'none';
