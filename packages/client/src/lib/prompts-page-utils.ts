import { toApiOutputSchema, toFrontendOutputSchema } from './output-schema';
import { DEFAULT_PROMPT_CONFIG, type PromptConfig, type PromptMessage } from '../types/database';

export function toFrontendConfig(config: unknown): PromptConfig {
  const c = (config || {}) as Record<string, unknown>;
  return {
    temperature: (c.temperature as number) ?? DEFAULT_PROMPT_CONFIG.temperature,
    top_p: (c.top_p as number) ?? DEFAULT_PROMPT_CONFIG.top_p,
    frequency_penalty: (c.frequency_penalty as number) ?? DEFAULT_PROMPT_CONFIG.frequency_penalty,
    presence_penalty: (c.presence_penalty as number) ?? DEFAULT_PROMPT_CONFIG.presence_penalty,
    max_tokens: (c.max_tokens as number) ?? DEFAULT_PROMPT_CONFIG.max_tokens,
    output_schema: toFrontendOutputSchema(c.output_schema),
    reasoning: c.reasoning as PromptConfig['reasoning'],
  };
}

export function toFrontendMessages(messages: unknown): PromptMessage[] {
  const msgs = (messages || []) as Array<{ role?: string; content?: string; id?: string }>;
  return msgs.map((m, i) => ({
    id: m.id || `msg-${Date.now()}-${i}`,
    role: (m.role || 'user') as PromptMessage['role'],
    content: m.content || '',
  }));
}

export function toApiConfig(config: PromptConfig): Record<string, unknown> {
  return {
    temperature: config.temperature,
    top_p: config.top_p,
    frequency_penalty: config.frequency_penalty,
    presence_penalty: config.presence_penalty,
    max_tokens: config.max_tokens,
    output_schema: toApiOutputSchema(config.output_schema),
    reasoning: config.reasoning,
  };
}

export function toApiMessages(messages: PromptMessage[]): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

export function createPromptMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}
