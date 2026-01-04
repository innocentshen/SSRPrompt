// Provider Types
export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'custom' | 'openrouter';

export interface Provider {
  id: string;
  userId: string;
  name: string;
  type: ProviderType;
  apiKey: string;
  baseUrl: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProviderDto {
  name: string;
  type: ProviderType;
  apiKey: string;
  baseUrl?: string;
  enabled?: boolean;
}

export interface UpdateProviderDto {
  name?: string;
  type?: ProviderType;
  apiKey?: string;
  baseUrl?: string | null;
  enabled?: boolean;
}

// Model Types
export interface Model {
  id: string;
  providerId: string;
  modelId: string;
  name: string;
  capabilities: string[];
  supportsVision: boolean;
  supportsReasoning: boolean;
  supportsFunctionCalling: boolean;
  createdAt: string;
}

export interface CreateModelDto {
  modelId: string;
  name: string;
  capabilities?: string[];
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  supportsFunctionCalling?: boolean;
}

export interface UpdateModelDto {
  name?: string;
  capabilities?: string[];
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  supportsFunctionCalling?: boolean;
}
