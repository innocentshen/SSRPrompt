// Prompt Types
export interface PromptVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  default_value?: string;
  required?: boolean;
}

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PromptConfig {
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens?: number;
  output_schema?: OutputSchema;
  reasoning?: {
    enabled: boolean;
    effort: 'default' | 'none' | 'low' | 'medium' | 'high';
  };
}

export interface OutputSchema {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface Prompt {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  content: string | null;
  variables: PromptVariable[];
  messages: PromptMessage[];
  config: PromptConfig;
  currentVersion: number;
  defaultModelId: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromptVersion {
  id: string;
  promptId: string;
  version: number;
  content: string;
  commitMessage: string | null;
  createdAt: string;
}

export interface CreatePromptDto {
  name: string;
  description?: string;
  content?: string;
  variables?: PromptVariable[];
  messages?: PromptMessage[];
  config?: PromptConfig;
  defaultModelId?: string;
}

export interface UpdatePromptDto {
  name?: string;
  description?: string | null;
  content?: string | null;
  variables?: PromptVariable[];
  messages?: PromptMessage[];
  config?: PromptConfig;
  defaultModelId?: string | null;
  orderIndex?: number;
}

// Prompt List Item (without large fields)
export interface PromptListItem {
  id: string;
  name: string;
  description: string | null;
  currentVersion: number;
  defaultModelId: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}
