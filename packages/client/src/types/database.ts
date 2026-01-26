// Re-export types from shared package
export type { ProviderType, TraceStatus, EvaluationStatus } from '@ssrprompt/shared';

// Frontend-specific types that extend or differ from shared package

// Reasoning effort type
export type ReasoningEffort = 'default' | 'none' | 'low' | 'medium' | 'high';

// PromptMessage with ID for frontend editing
export type PromptMessageRole = 'system' | 'user' | 'assistant';

export interface PromptMessage {
  id: string;
  role: PromptMessageRole;
  content: string;
}

// PromptVariable type alias
export type PromptVariableType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface PromptVariable {
  name: string;
  type: PromptVariableType;
  description?: string;
  default_value?: string;
  required?: boolean;
}

// ReasoningConfig for frontend
export interface ReasoningConfig {
  enabled: boolean;
  effort: ReasoningEffort;
}

// Structured Output Types - Frontend version with enabled flag and fields array
export type SchemaFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface SchemaField {
  name: string;
  type: SchemaFieldType;
  description?: string;
  required: boolean;
  enum?: string[];
  items?: SchemaField;
  properties?: SchemaField[];
}

export interface OutputSchema {
  enabled: boolean;
  name: string;
  strict: boolean;
  fields: SchemaField[];
}

// PromptConfig - frontend version with required fields
export interface PromptConfig {
  temperature: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  max_tokens: number;
  output_schema?: OutputSchema;
  reasoning?: ReasoningConfig;
}

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  temperature: 1,
  top_p: 0.7,
  frequency_penalty: 0,
  presence_penalty: 0,
  max_tokens: 8000,
  reasoning: {
    enabled: false,
    effort: 'default',
  },
};
