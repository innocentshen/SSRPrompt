// Trace Types
export type TraceStatus = 'success' | 'error';

export interface Trace {
  id: string;
  userId: string;
  promptId: string | null;
  modelId: string | null;
  input: string;
  output: string | null;
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
  status: TraceStatus;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  attachments: FileAttachment[] | null;
  thinkingContent: string | null;
  thinkingTimeMs: number | null;
  createdAt: string;
}

export interface FileAttachment {
  name: string;
  type: string;
  base64: string;
}

export interface CreateTraceDto {
  promptId?: string;
  modelId?: string;
  input: string;
  output?: string;
  tokensInput?: number;
  tokensOutput?: number;
  latencyMs?: number;
  status?: TraceStatus;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  attachments?: FileAttachment[];
  thinkingContent?: string;
  thinkingTimeMs?: number;
}

// Trace List Item (without large fields)
export interface TraceListItem {
  id: string;
  userId: string;
  promptId: string | null;
  modelId: string | null;
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
  status: TraceStatus;
  createdAt: string;
}

// Paginated Response
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
