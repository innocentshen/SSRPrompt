export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'azure' | 'custom';
export type EvaluationStatus = 'pending' | 'running' | 'completed' | 'failed';
export type TraceStatus = 'success' | 'error';

export interface Provider {
  id: string;
  user_id: string;
  name: string;
  type: ProviderType;
  api_key: string;
  base_url: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Model {
  id: string;
  provider_id: string;
  model_id: string;
  name: string;
  capabilities: string[];
  created_at: string;
}

export interface Prompt {
  id: string;
  user_id: string;
  name: string;
  description: string;
  content: string;
  variables: PromptVariable[];
  current_version: number;
  default_model_id: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface PromptVariable {
  name: string;
  description?: string;
  default_value?: string;
}

export interface PromptVersion {
  id: string;
  prompt_id: string;
  version: number;
  content: string;
  commit_message: string;
  created_at: string;
}

export interface Evaluation {
  id: string;
  user_id: string;
  name: string;
  prompt_id: string | null;
  model_id: string | null;
  judge_model_id: string | null;
  status: EvaluationStatus;
  config: EvaluationConfig;
  results: EvaluationResults;
  created_at: string;
  completed_at: string | null;
}

export interface EvaluationConfig {
  pass_threshold?: number;
}

export interface EvaluationResults {
  scores?: Record<string, number>;
  summary?: string;
  total_cases?: number;
  passed_cases?: number;
}

export interface FileAttachmentData {
  name: string;
  type: string;
  base64: string;
}

export interface TestCase {
  id: string;
  evaluation_id: string;
  name: string;
  input_text: string;
  input_variables: Record<string, string>;
  attachments: FileAttachmentData[];
  expected_output: string | null;
  order_index: number;
  created_at: string;
}

export interface EvaluationCriterion {
  id: string;
  evaluation_id: string;
  name: string;
  description: string;
  prompt: string;
  weight: number;
  enabled: boolean;
  created_at: string;
}

export interface TestCaseResult {
  id: string;
  evaluation_id: string;
  test_case_id: string;
  run_id: string | null;
  model_output: string;
  scores: Record<string, number>;
  ai_feedback: Record<string, string>;
  latency_ms: number;
  tokens_input: number;
  tokens_output: number;
  passed: boolean;
  error_message: string | null;
  created_at: string;
}

export interface EvaluationRun {
  id: string;
  evaluation_id: string;
  status: EvaluationStatus;
  results: EvaluationResults;
  error_message: string | null;
  total_tokens_input: number;
  total_tokens_output: number;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface Trace {
  id: string;
  user_id: string;
  prompt_id: string | null;
  model_id: string | null;
  input: string;
  output: string;
  tokens_input: number;
  tokens_output: number;
  latency_ms: number;
  status: TraceStatus;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      providers: {
        Row: Provider;
        Insert: Omit<Provider, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Provider, 'id' | 'created_at'>>;
      };
      models: {
        Row: Model;
        Insert: Omit<Model, 'id' | 'created_at'>;
        Update: Partial<Omit<Model, 'id' | 'created_at'>>;
      };
      prompts: {
        Row: Prompt;
        Insert: Omit<Prompt, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Prompt, 'id' | 'created_at'>>;
      };
      prompt_versions: {
        Row: PromptVersion;
        Insert: Omit<PromptVersion, 'id' | 'created_at'>;
        Update: Partial<Omit<PromptVersion, 'id' | 'created_at'>>;
      };
      evaluations: {
        Row: Evaluation;
        Insert: Omit<Evaluation, 'id' | 'created_at' | 'completed_at'>;
        Update: Partial<Omit<Evaluation, 'id' | 'created_at'>>;
      };
      traces: {
        Row: Trace;
        Insert: Omit<Trace, 'id' | 'created_at'>;
        Update: Partial<Omit<Trace, 'id' | 'created_at'>>;
      };
    };
  };
}
