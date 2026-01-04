const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface ChatCompletionOptions {
  modelId: string;
  messages: ChatMessage[];
  promptId?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
  saveTrace?: boolean;
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionResult {
  content: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  latencyMs: number;
}

/**
 * Stream chat completion with SSE
 *
 * @param options - Chat completion options
 * @param onChunk - Callback for each chunk
 * @param onComplete - Callback when stream is complete
 * @param onError - Callback for errors
 * @param signal - AbortSignal for cancellation
 */
export async function streamChatCompletion(
  options: ChatCompletionOptions,
  onChunk: (content: string, chunk: StreamChunk) => void,
  onComplete?: (usage?: StreamChunk['usage']) => void,
  onError?: (error: Error) => void,
  signal?: AbortSignal
): Promise<void> {
  const token = localStorage.getItem('auth_token');

  try {
    const response = await fetch(`${API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ ...options, stream: true }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let lastUsage: StreamChunk['usage'] | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);

            if (data === '[DONE]') {
              onComplete?.(lastUsage);
              return;
            }

            try {
              const chunk: StreamChunk = JSON.parse(data);

              // Handle error in chunk
              if ('error' in chunk) {
                throw new Error((chunk as unknown as { error: { message: string } }).error.message);
              }

              // Capture usage
              if (chunk.usage) {
                lastUsage = chunk.usage;
              }

              // Extract content delta
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) {
                onChunk(content, chunk);
              }
            } catch (parseError) {
              console.error('Failed to parse SSE chunk:', parseError);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    onComplete?.(lastUsage);
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      console.log('Chat completion aborted');
      return;
    }
    onError?.(error as Error);
    throw error;
  }
}

/**
 * Non-streaming chat completion
 */
export async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const token = localStorage.getItem('auth_token');

  const response = await fetch(`${API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify({ ...options, stream: false }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data;
}

/**
 * Chat API with convenience methods
 */
export const chatApi = {
  /**
   * Stream chat completion
   */
  stream: streamChatCompletion,

  /**
   * Non-streaming chat completion
   */
  complete: chatCompletion,

  /**
   * Create an abort controller for cancelling requests
   */
  createAbortController: () => new AbortController(),
};
