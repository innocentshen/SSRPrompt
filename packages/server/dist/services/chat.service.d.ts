import type { Model, Provider } from '@prisma/client';
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | ContentPart[];
}
export interface ContentPart {
    type: 'text' | 'image_url' | 'file';
    text?: string;
    image_url?: {
        url: string;
    };
    file?: {
        filename: string;
        file_data: string;
    };
}
export interface ChatCompletionOptions {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stream?: boolean;
    reasoning?: {
        enabled: boolean;
        effort?: 'default' | 'none' | 'low' | 'medium' | 'high';
    };
    responseFormat?: object;
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
/**
 * Get model with decrypted API key
 */
export declare function getModelWithProvider(userId: string, modelId: string): Promise<{
    model: Model;
    provider: Provider;
    apiKey: string;
}>;
/**
 * Build provider-specific API URL
 */
export declare function buildApiUrl(provider: Provider): string;
/**
 * Build request headers for provider
 */
export declare function buildHeaders(provider: Provider, apiKey: string): Record<string, string>;
/**
 * Build request body for provider
 */
export declare function buildRequestBody(provider: Provider, model: Model, messages: ChatMessage[], options: ChatCompletionOptions): Record<string, unknown>;
/**
 * Parse SSE data from different providers
 */
export declare function parseSSEChunk(provider: Provider, data: string): StreamChunk | null;
/**
 * Stream response from LLM provider
 */
export declare function streamChatCompletion(provider: Provider, model: Model, apiKey: string, messages: ChatMessage[], options: ChatCompletionOptions, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown>;
/**
 * Non-streaming chat completion
 */
export declare function chatCompletion(provider: Provider, model: Model, apiKey: string, messages: ChatMessage[], options: ChatCompletionOptions, signal?: AbortSignal): Promise<{
    content: string;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}>;
//# sourceMappingURL=chat.service.d.ts.map