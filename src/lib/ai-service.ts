import type { Provider } from '../types';
import { isImageFile as checkIsImage, isPdfFile as checkIsPdf, isTextFile as checkIsText, readTextContent } from './file-utils';

export interface FileAttachment {
  name: string;
  type: string;
  base64: string;
}

interface AIResponse {
  content: string;
  thinking?: string;
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
  error?: string;
}

// 思考内容提取结果
export interface ThinkingContent {
  thinking: string;
  content: string;
}

// 思考内容检测正则模式
const THINKING_PATTERNS = [
  /<thinking>([\s\S]*?)<\/thinking>/gi,
  /<think>([\s\S]*?)<\/think>/gi,
  /<thought>([\s\S]*?)<\/thought>/gi,
  /<reasoning>([\s\S]*?)<\/reasoning>/gi,
  /\[THINKING\]([\s\S]*?)\[\/THINKING\]/gi,
  /◁think▷([\s\S]*?)◁\/think▷/gi,
  /<seed:think>([\s\S]*?)<\/seed:think>/gi,
  /###\s*Thinking\s*\n([\s\S]*?)(?=###\s*Response|$)/gi,
];

/**
 * 从响应内容中提取思考内容
 */
export function extractThinking(response: string): ThinkingContent {
  let thinking = '';
  let content = response;

  for (const pattern of THINKING_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;

    const matches = response.matchAll(new RegExp(pattern.source, pattern.flags));
    for (const match of matches) {
      if (match[1]) {
        thinking += (thinking ? '\n\n' : '') + match[1].trim();
      }
    }

    // Remove thinking blocks from content
    content = content.replace(pattern, '');
  }

  // Clean up ###Response header if it exists (from ###Thinking format)
  content = content.replace(/^###\s*Response\s*\n?/gim, '');

  return {
    thinking: thinking.trim(),
    content: content.trim(),
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelParameters {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

export interface AICallOptions {
  responseFormat?: object;
  parameters?: ModelParameters;
}

export interface StreamUsage {
  tokensInput: number;
  tokensOutput: number;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onThinkingToken?: (token: string) => void;
  onComplete?: (fullContent: string, thinking?: string, usage?: StreamUsage) => void;
  onError?: (error: string) => void;
}

export async function fileToBase64(file: File): Promise<FileAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve({
        name: file.name,
        type: file.type,
        base64,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function isImageFile(file: FileAttachment): boolean {
  return checkIsImage(file);
}

export function isPdfFile(file: FileAttachment): boolean {
  return checkIsPdf(file);
}

export function isTextFile(file: FileAttachment): boolean {
  return checkIsText(file);
}

export async function callAIModel(
  provider: Provider,
  modelName: string,
  prompt: string,
  userInput?: string,
  files?: FileAttachment[],
  options?: AICallOptions
): Promise<AIResponse> {
  if (!provider.api_key) {
    throw new Error('API Key 未配置');
  }

  const fullPrompt = userInput ? `${prompt}\n\n${userInput}` : prompt;

  switch (provider.type) {
    case 'openai':
      return await callOpenAI(provider, modelName, fullPrompt, files, options);
    case 'anthropic':
      return await callAnthropic(provider, modelName, fullPrompt, files, options);
    case 'gemini':
      return await callGemini(provider, modelName, fullPrompt, files, options);
    case 'azure':
      return await callAzureOpenAI(provider, modelName, fullPrompt, files, options);
    case 'custom':
      return await callCustom(provider, modelName, fullPrompt, files, options);
    default:
      throw new Error(`不支持的服务商类型: ${provider.type}`);
  }
}

// New function: Call AI with message array (for chat-style interactions)
export async function callAIModelWithMessages(
  provider: Provider,
  modelName: string,
  messages: ChatMessage[],
  options?: AICallOptions
): Promise<AIResponse> {
  if (!provider.api_key) {
    return {
      content: '',
      tokensInput: 0,
      tokensOutput: 0,
      latencyMs: 0,
      error: 'API Key 未配置',
    };
  }

  const startTime = Date.now();
  const params = options?.parameters || {};

  try {
    switch (provider.type) {
      case 'openai':
      case 'custom': {
        const baseUrl = provider.base_url || 'https://api.openai.com';
        const requestBody: Record<string, unknown> = {
          model: modelName,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: params.temperature ?? 0.7,
          max_tokens: params.max_tokens ?? 4096,
        };

        if (params.top_p !== undefined) requestBody.top_p = params.top_p;
        if (params.frequency_penalty !== undefined) requestBody.frequency_penalty = params.frequency_penalty;
        if (params.presence_penalty !== undefined) requestBody.presence_penalty = params.presence_penalty;

        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.api_key}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const error = await response.text();
          return {
            content: '',
            tokensInput: 0,
            tokensOutput: 0,
            latencyMs: Date.now() - startTime,
            error: `API 错误: ${response.status} - ${error}`,
          };
        }

        const data = await response.json();
        return {
          content: data.choices[0].message.content,
          tokensInput: data.usage?.prompt_tokens || 0,
          tokensOutput: data.usage?.completion_tokens || 0,
          latencyMs: Date.now() - startTime,
        };
      }

      case 'anthropic': {
        const baseUrl = provider.base_url || 'https://api.anthropic.com';
        // Anthropic: system message is separate, rest are user/assistant
        const systemMessage = messages.find((m) => m.role === 'system');
        const otherMessages = messages.filter((m) => m.role !== 'system');

        const requestBody: Record<string, unknown> = {
          model: modelName,
          max_tokens: params.max_tokens ?? 4096,
          messages: otherMessages.map((m) => ({ role: m.role, content: m.content })),
        };

        if (systemMessage) {
          requestBody.system = systemMessage.content;
        }
        if (params.temperature !== undefined) requestBody.temperature = params.temperature;
        if (params.top_p !== undefined) requestBody.top_p = params.top_p;

        const response = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': provider.api_key!,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'pdfs-2024-09-25',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const error = await response.text();
          return {
            content: '',
            tokensInput: 0,
            tokensOutput: 0,
            latencyMs: Date.now() - startTime,
            error: `Anthropic API 错误: ${response.status} - ${error}`,
          };
        }

        const data = await response.json();
        return {
          content: data.content[0].text,
          tokensInput: data.usage?.input_tokens || 0,
          tokensOutput: data.usage?.output_tokens || 0,
          latencyMs: Date.now() - startTime,
        };
      }

      case 'gemini': {
        const baseUrl = provider.base_url || 'https://generativelanguage.googleapis.com';
        // Gemini: convert messages to contents format
        const systemMessage = messages.find((m) => m.role === 'system');
        const otherMessages = messages.filter((m) => m.role !== 'system');

        const contents = otherMessages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

        const generationConfig: Record<string, unknown> = {
          temperature: params.temperature ?? 0.7,
          maxOutputTokens: params.max_tokens ?? 8192,
        };
        if (params.top_p !== undefined) generationConfig.topP = params.top_p;

        const requestBody: Record<string, unknown> = {
          contents,
          generationConfig,
        };

        if (systemMessage) {
          requestBody.systemInstruction = { parts: [{ text: systemMessage.content }] };
        }

        const response = await fetch(
          `${baseUrl}/v1beta/models/${modelName}:generateContent?key=${provider.api_key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          }
        );

        if (!response.ok) {
          const error = await response.text();
          return {
            content: '',
            tokensInput: 0,
            tokensOutput: 0,
            latencyMs: Date.now() - startTime,
            error: `Gemini API 错误: ${response.status} - ${error}`,
          };
        }

        const data = await response.json();
        return {
          content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
          tokensInput: data.usageMetadata?.promptTokenCount || 0,
          tokensOutput: data.usageMetadata?.candidatesTokenCount || 0,
          latencyMs: Date.now() - startTime,
        };
      }

      case 'azure': {
        if (!provider.base_url) {
          return {
            content: '',
            tokensInput: 0,
            tokensOutput: 0,
            latencyMs: Date.now() - startTime,
            error: 'Azure OpenAI 需要配置 Base URL',
          };
        }

        const requestBody: Record<string, unknown> = {
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: params.temperature ?? 0.7,
          max_tokens: params.max_tokens ?? 4096,
        };

        if (params.top_p !== undefined) requestBody.top_p = params.top_p;
        if (params.frequency_penalty !== undefined) requestBody.frequency_penalty = params.frequency_penalty;
        if (params.presence_penalty !== undefined) requestBody.presence_penalty = params.presence_penalty;

        const response = await fetch(
          `${provider.base_url}/openai/deployments/${modelName}/chat/completions?api-version=2024-02-15-preview`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api-key': provider.api_key!,
            },
            body: JSON.stringify(requestBody),
          }
        );

        if (!response.ok) {
          const error = await response.text();
          return {
            content: '',
            tokensInput: 0,
            tokensOutput: 0,
            latencyMs: Date.now() - startTime,
            error: `Azure OpenAI API 错误: ${response.status} - ${error}`,
          };
        }

        const data = await response.json();
        return {
          content: data.choices[0].message.content,
          tokensInput: data.usage?.prompt_tokens || 0,
          tokensOutput: data.usage?.completion_tokens || 0,
          latencyMs: Date.now() - startTime,
        };
      }

      default:
        return {
          content: '',
          tokensInput: 0,
          tokensOutput: 0,
          latencyMs: Date.now() - startTime,
          error: `不支持的服务商类型: ${provider.type}`,
        };
    }
  } catch (e) {
    return {
      content: '',
      tokensInput: 0,
      tokensOutput: 0,
      latencyMs: Date.now() - startTime,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

// Streaming version for chat-style interactions
export async function streamAIModelWithMessages(
  provider: Provider,
  modelName: string,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  files?: FileAttachment[],
  options?: AICallOptions
): Promise<void> {
  if (!provider.api_key) {
    callbacks.onError?.('API Key 未配置');
    return;
  }

  const params = options?.parameters || {};

  try {
    switch (provider.type) {
      case 'openai':
      case 'custom': {
        const baseUrl = provider.base_url || 'https://api.openai.com';

        // Build messages with file attachments for the last user message
        const apiMessages = messages.map((m, index) => {
          if (m.role === 'user' && index === messages.length - 1 && files && files.length > 0) {
            // 首先处理文本文件
            let enhancedContent = m.content;
            for (const file of files) {
              if (isTextFile(file)) {
                const textContent = readTextContent(file.base64);
                enhancedContent += `\n\n[File: ${file.name}]\n\`\`\`\n${textContent}\n\`\`\``;
              }
            }

            const content: Array<{ type: string; text?: string; image_url?: { url: string }; file?: { filename: string; file_data: string } }> = [
              { type: 'text', text: enhancedContent },
            ];
            for (const file of files) {
              if (isImageFile(file)) {
                content.push({
                  type: 'image_url',
                  image_url: { url: `data:${file.type};base64,${file.base64}` },
                });
              } else if (isPdfFile(file)) {
                content.push({
                  type: 'file',
                  file: {
                    filename: file.name,
                    file_data: `data:application/pdf;base64,${file.base64}`,
                  },
                });
              }
            }
            return { role: m.role, content };
          }
          return { role: m.role, content: m.content };
        });

        const requestBody: Record<string, unknown> = {
          model: modelName,
          messages: apiMessages,
          temperature: params.temperature ?? 0.7,
          max_tokens: params.max_tokens ?? 4096,
          stream: true,
          stream_options: { include_usage: true },
        };

        if (params.top_p !== undefined) requestBody.top_p = params.top_p;
        if (options?.responseFormat) requestBody.response_format = options.responseFormat;

        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.api_key}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const error = await response.text();
          callbacks.onError?.(`API 错误: ${response.status} - ${error}`);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          callbacks.onError?.('无法读取响应流');
          return;
        }

        const decoder = new TextDecoder();
        let fullContent = '';
        let usage: StreamUsage = { tokensInput: 0, tokensOutput: 0 };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  fullContent += content;
                  callbacks.onToken(content);
                }
                // Extract usage from the final chunk
                if (parsed.usage) {
                  usage = {
                    tokensInput: parsed.usage.prompt_tokens || 0,
                    tokensOutput: parsed.usage.completion_tokens || 0,
                  };
                }
              } catch {
                // Ignore JSON parse errors for incomplete chunks
              }
            }
          }
        }

        callbacks.onComplete?.(fullContent, undefined, usage);
        break;
      }

      case 'anthropic': {
        const baseUrl = provider.base_url || 'https://api.anthropic.com';
        const systemMessage = messages.find((m) => m.role === 'system');
        const otherMessages = messages.filter((m) => m.role !== 'system');

        // Build messages with file attachments
        const apiMessages = otherMessages.map((m, index) => {
          if (m.role === 'user' && index === otherMessages.length - 1 && files && files.length > 0) {
            // 首先处理文本文件
            let enhancedContent = m.content;
            for (const file of files) {
              if (isTextFile(file)) {
                const textContent = readTextContent(file.base64);
                enhancedContent += `\n\n[File: ${file.name}]\n\`\`\`\n${textContent}\n\`\`\``;
              }
            }

            const content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];
            for (const file of files) {
              if (isImageFile(file)) {
                content.push({
                  type: 'image',
                  source: { type: 'base64', media_type: file.type, data: file.base64 },
                });
              } else if (isPdfFile(file)) {
                content.push({
                  type: 'document',
                  source: { type: 'base64', media_type: 'application/pdf', data: file.base64 },
                });
              }
            }
            content.push({ type: 'text', text: enhancedContent });
            return { role: m.role, content };
          }
          return { role: m.role, content: m.content };
        });

        const requestBody: Record<string, unknown> = {
          model: modelName,
          max_tokens: params.max_tokens ?? 4096,
          messages: apiMessages,
          stream: true,
        };

        if (systemMessage) requestBody.system = systemMessage.content;
        if (params.temperature !== undefined) requestBody.temperature = params.temperature;

        const response = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': provider.api_key!,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'pdfs-2024-09-25',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const error = await response.text();
          callbacks.onError?.(`Anthropic API 错误: ${response.status} - ${error}`);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          callbacks.onError?.('无法读取响应流');
          return;
        }

        const decoder = new TextDecoder();
        let fullContent = '';
        let usage: StreamUsage = { tokensInput: 0, tokensOutput: 0 };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              try {
                const parsed = JSON.parse(data);
                // Extract content from content_block_delta
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  fullContent += parsed.delta.text;
                  callbacks.onToken(parsed.delta.text);
                }
                // Extract input_tokens from message_start
                if (parsed.type === 'message_start' && parsed.message?.usage) {
                  usage.tokensInput = parsed.message.usage.input_tokens || 0;
                }
                // Extract output_tokens from message_delta
                if (parsed.type === 'message_delta' && parsed.usage) {
                  usage.tokensOutput = parsed.usage.output_tokens || 0;
                }
              } catch {
                // Ignore JSON parse errors
              }
            }
          }
        }

        callbacks.onComplete?.(fullContent, undefined, usage);
        break;
      }

      case 'gemini': {
        const baseUrl = provider.base_url || 'https://generativelanguage.googleapis.com';
        const systemMessage = messages.find((m) => m.role === 'system');
        const otherMessages = messages.filter((m) => m.role !== 'system');

        // Build contents with file attachments
        const contents = otherMessages.map((m, index) => {
          const role = m.role === 'assistant' ? 'model' : 'user';
          if (m.role === 'user' && index === otherMessages.length - 1 && files && files.length > 0) {
            // 首先处理文本文件
            let enhancedContent = m.content;
            for (const file of files) {
              if (isTextFile(file)) {
                const textContent = readTextContent(file.base64);
                enhancedContent += `\n\n[File: ${file.name}]\n\`\`\`\n${textContent}\n\`\`\``;
              }
            }

            const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];
            for (const file of files) {
              if (isImageFile(file) || isPdfFile(file)) {
                parts.push({ inline_data: { mime_type: file.type, data: file.base64 } });
              }
            }
            parts.push({ text: enhancedContent });
            return { role, parts };
          }
          return { role, parts: [{ text: m.content }] };
        });

        const generationConfig: Record<string, unknown> = {
          temperature: params.temperature ?? 0.7,
          maxOutputTokens: params.max_tokens ?? 8192,
        };

        // Add structured output support for Gemini
        if (options?.responseFormat) {
          generationConfig.responseMimeType = 'application/json';
          const responseSchema = (options.responseFormat as { json_schema?: { schema?: object } })?.json_schema?.schema;
          if (responseSchema) {
            generationConfig.responseSchema = responseSchema;
          }
        }

        const requestBody: Record<string, unknown> = { contents, generationConfig };
        if (systemMessage) {
          requestBody.systemInstruction = { parts: [{ text: systemMessage.content }] };
        }

        const response = await fetch(
          `${baseUrl}/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${provider.api_key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          }
        );

        if (!response.ok) {
          const error = await response.text();
          callbacks.onError?.(`Gemini API 错误: ${response.status} - ${error}`);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          callbacks.onError?.('无法读取响应流');
          return;
        }

        const decoder = new TextDecoder();
        let fullContent = '';
        let usage: StreamUsage = { tokensInput: 0, tokensOutput: 0 };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              try {
                const parsed = JSON.parse(data);
                const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                  fullContent += text;
                  callbacks.onToken(text);
                }
                // Extract usage from usageMetadata
                if (parsed.usageMetadata) {
                  usage = {
                    tokensInput: parsed.usageMetadata.promptTokenCount || 0,
                    tokensOutput: parsed.usageMetadata.candidatesTokenCount || 0,
                  };
                }
              } catch {
                // Ignore JSON parse errors
              }
            }
          }
        }

        callbacks.onComplete?.(fullContent, undefined, usage);
        break;
      }

      case 'azure': {
        if (!provider.base_url) {
          callbacks.onError?.('Azure OpenAI 需要配置 Base URL');
          return;
        }

        const requestBody: Record<string, unknown> = {
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: params.temperature ?? 0.7,
          max_tokens: params.max_tokens ?? 4096,
          stream: true,
          stream_options: { include_usage: true },
        };

        if (options?.responseFormat) requestBody.response_format = options.responseFormat;

        const response = await fetch(
          `${provider.base_url}/openai/deployments/${modelName}/chat/completions?api-version=2024-02-15-preview`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api-key': provider.api_key!,
            },
            body: JSON.stringify(requestBody),
          }
        );

        if (!response.ok) {
          const error = await response.text();
          callbacks.onError?.(`Azure OpenAI API 错误: ${response.status} - ${error}`);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          callbacks.onError?.('无法读取响应流');
          return;
        }

        const decoder = new TextDecoder();
        let fullContent = '';
        let usage: StreamUsage = { tokensInput: 0, tokensOutput: 0 };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  fullContent += content;
                  callbacks.onToken(content);
                }
                // Extract usage from the final chunk
                if (parsed.usage) {
                  usage = {
                    tokensInput: parsed.usage.prompt_tokens || 0,
                    tokensOutput: parsed.usage.completion_tokens || 0,
                  };
                }
              } catch {
                // Ignore JSON parse errors
              }
            }
          }
        }

        callbacks.onComplete?.(fullContent, undefined, usage);
        break;
      }

      default:
        callbacks.onError?.(`不支持的服务商类型: ${provider.type}`);
    }
  } catch (e) {
    callbacks.onError?.(e instanceof Error ? e.message : 'Unknown error');
  }
}

// Streaming version for single prompt (matches callAIModel signature)
export async function streamAIModel(
  provider: Provider,
  modelName: string,
  prompt: string,
  callbacks: StreamCallbacks,
  userInput?: string,
  files?: FileAttachment[],
  options?: AICallOptions
): Promise<void> {
  const fullPrompt = userInput ? `${prompt}\n\n${userInput}` : prompt;
  const messages: ChatMessage[] = [{ role: 'user', content: fullPrompt }];
  await streamAIModelWithMessages(provider, modelName, messages, callbacks, files, options);
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

function buildOpenAIContent(prompt: string, files?: FileAttachment[]): string | OpenAIContentPart[] {
  if (!files || files.length === 0) {
    return prompt;
  }

  const content: OpenAIContentPart[] = [];

  // 首先处理文本文件，将其内容嵌入到 prompt 中
  let enhancedPrompt = prompt;
  for (const file of files) {
    if (isTextFile(file)) {
      const textContent = readTextContent(file.base64);
      enhancedPrompt += `\n\n[File: ${file.name}]\n\`\`\`\n${textContent}\n\`\`\``;
    }
  }

  content.push({ type: 'text', text: enhancedPrompt });

  // 然后处理图片和 PDF 文件
  for (const file of files) {
    if (isImageFile(file)) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${file.type};base64,${file.base64}`,
        },
      });
    } else if (isPdfFile(file)) {
      content.push({
        type: 'file',
        file: {
          filename: file.name,
          file_data: `data:application/pdf;base64,${file.base64}`,
        },
      });
    }
  }

  return content;
}

async function callOpenAI(
  provider: Provider,
  modelName: string,
  prompt: string,
  files?: FileAttachment[],
  options?: AICallOptions
): Promise<AIResponse> {
  const startTime = Date.now();
  const baseUrl = provider.base_url || 'https://api.openai.com';
  const params = options?.parameters || {};

  const requestBody: Record<string, unknown> = {
    model: modelName,
    messages: [
      {
        role: 'user',
        content: buildOpenAIContent(prompt, files),
      },
    ],
    temperature: params.temperature ?? 0.7,
    max_tokens: params.max_tokens ?? 4096,
  };

  if (params.top_p !== undefined) {
    requestBody.top_p = params.top_p;
  }
  if (params.frequency_penalty !== undefined) {
    requestBody.frequency_penalty = params.frequency_penalty;
  }
  if (params.presence_penalty !== undefined) {
    requestBody.presence_penalty = params.presence_penalty;
  }

  if (options?.responseFormat) {
    requestBody.response_format = options.responseFormat;
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.api_key}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API 错误: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const latencyMs = Date.now() - startTime;

  return {
    content: data.choices[0].message.content,
    tokensInput: data.usage?.prompt_tokens || 0,
    tokensOutput: data.usage?.completion_tokens || 0,
    latencyMs,
  };
}

function buildAnthropicContent(prompt: string, files?: FileAttachment[]): unknown {
  if (!files || files.length === 0) {
    return prompt;
  }

  const content: Array<{
    type: string;
    text?: string;
    source?: { type: string; media_type: string; data: string };
  }> = [];

  // 首先处理文本文件，将其内容嵌入到 prompt 中
  let enhancedPrompt = prompt;
  for (const file of files) {
    if (isTextFile(file)) {
      const textContent = readTextContent(file.base64);
      enhancedPrompt += `\n\n[File: ${file.name}]\n\`\`\`\n${textContent}\n\`\`\``;
    }
  }

  // 处理图片和 PDF 文件
  for (const file of files) {
    if (isImageFile(file)) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: file.type,
          data: file.base64,
        },
      });
    } else if (isPdfFile(file)) {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: file.base64,
        },
      });
    }
  }

  content.push({ type: 'text', text: enhancedPrompt });

  return content;
}

async function callAnthropic(
  provider: Provider,
  modelName: string,
  prompt: string,
  files?: FileAttachment[],
  options?: AICallOptions
): Promise<AIResponse> {
  const startTime = Date.now();
  const baseUrl = provider.base_url || 'https://api.anthropic.com';
  const params = options?.parameters || {};

  const requestBody: Record<string, unknown> = {
    model: modelName,
    max_tokens: params.max_tokens ?? 4096,
    messages: [
      {
        role: 'user',
        content: buildAnthropicContent(prompt, files),
      },
    ],
  };

  if (params.temperature !== undefined) {
    requestBody.temperature = params.temperature;
  }
  if (params.top_p !== undefined) {
    requestBody.top_p = params.top_p;
  }

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.api_key!,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API 错误: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const latencyMs = Date.now() - startTime;

  return {
    content: data.content[0].text,
    tokensInput: data.usage?.input_tokens || 0,
    tokensOutput: data.usage?.output_tokens || 0,
    latencyMs,
  };
}

function buildGeminiParts(prompt: string, files?: FileAttachment[]): unknown[] {
  const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];

  // 首先处理文本文件，将其内容嵌入到 prompt 中
  let enhancedPrompt = prompt;
  if (files && files.length > 0) {
    for (const file of files) {
      if (isTextFile(file)) {
        const textContent = readTextContent(file.base64);
        enhancedPrompt += `\n\n[File: ${file.name}]\n\`\`\`\n${textContent}\n\`\`\``;
      }
    }
  }

  // 处理图片和 PDF 文件
  if (files && files.length > 0) {
    for (const file of files) {
      if (isImageFile(file) || isPdfFile(file)) {
        parts.push({
          inline_data: {
            mime_type: file.type,
            data: file.base64,
          },
        });
      }
    }
  }

  parts.push({ text: enhancedPrompt });

  return parts;
}

async function callGemini(
  provider: Provider,
  modelName: string,
  prompt: string,
  files?: FileAttachment[],
  options?: AICallOptions
): Promise<AIResponse> {
  const startTime = Date.now();
  const baseUrl = provider.base_url || 'https://generativelanguage.googleapis.com';
  const params = options?.parameters || {};

  const generationConfig: Record<string, unknown> = {
    temperature: params.temperature ?? 0.7,
    maxOutputTokens: params.max_tokens ?? 8192,
  };

  if (params.top_p !== undefined) {
    generationConfig.topP = params.top_p;
  }

  const requestBody: Record<string, unknown> = {
    contents: [
      {
        parts: buildGeminiParts(prompt, files),
      },
    ],
    generationConfig,
  };

  if (options?.responseFormat) {
    (requestBody.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
    const responseSchema = (options.responseFormat as { json_schema?: { schema?: object } })?.json_schema?.schema;
    if (responseSchema) {
      (requestBody.generationConfig as Record<string, unknown>).responseSchema = responseSchema;
    }
  }

  const response = await fetch(
    `${baseUrl}/v1beta/models/${modelName}:generateContent?key=${provider.api_key}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API 错误: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const latencyMs = Date.now() - startTime;

  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const tokensInput = data.usageMetadata?.promptTokenCount || 0;
  const tokensOutput = data.usageMetadata?.candidatesTokenCount || 0;

  return {
    content,
    tokensInput,
    tokensOutput,
    latencyMs,
  };
}

async function callAzureOpenAI(
  provider: Provider,
  modelName: string,
  prompt: string,
  files?: FileAttachment[],
  options?: AICallOptions
): Promise<AIResponse> {
  const startTime = Date.now();

  if (!provider.base_url) {
    throw new Error('Azure OpenAI 需要配置 Base URL');
  }

  const params = options?.parameters || {};

  const requestBody: Record<string, unknown> = {
    messages: [
      {
        role: 'user',
        content: buildOpenAIContent(prompt, files),
      },
    ],
    temperature: params.temperature ?? 0.7,
    max_tokens: params.max_tokens ?? 4096,
  };

  if (params.top_p !== undefined) {
    requestBody.top_p = params.top_p;
  }
  if (params.frequency_penalty !== undefined) {
    requestBody.frequency_penalty = params.frequency_penalty;
  }
  if (params.presence_penalty !== undefined) {
    requestBody.presence_penalty = params.presence_penalty;
  }

  if (options?.responseFormat) {
    requestBody.response_format = options.responseFormat;
  }

  const response = await fetch(`${provider.base_url}/openai/deployments/${modelName}/chat/completions?api-version=2024-02-15-preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': provider.api_key!,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Azure OpenAI API 错误: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const latencyMs = Date.now() - startTime;

  return {
    content: data.choices[0].message.content,
    tokensInput: data.usage?.prompt_tokens || 0,
    tokensOutput: data.usage?.completion_tokens || 0,
    latencyMs,
  };
}

async function callCustom(
  provider: Provider,
  modelName: string,
  prompt: string,
  files?: FileAttachment[],
  options?: AICallOptions
): Promise<AIResponse> {
  const startTime = Date.now();

  if (!provider.base_url) {
    throw new Error('自定义服务商需要配置 Base URL');
  }

  const params = options?.parameters || {};

  const requestBody: Record<string, unknown> = {
    model: modelName,
    messages: [
      {
        role: 'user',
        content: buildOpenAIContent(prompt, files),
      },
    ],
    temperature: params.temperature ?? 0.7,
    max_tokens: params.max_tokens ?? 4096,
  };

  if (params.top_p !== undefined) {
    requestBody.top_p = params.top_p;
  }
  if (params.frequency_penalty !== undefined) {
    requestBody.frequency_penalty = params.frequency_penalty;
  }
  if (params.presence_penalty !== undefined) {
    requestBody.presence_penalty = params.presence_penalty;
  }

  if (options?.responseFormat) {
    requestBody.response_format = options.responseFormat;
  }

  const response = await fetch(`${provider.base_url}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.api_key}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`自定义 API 错误: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const latencyMs = Date.now() - startTime;

  return {
    content: data.choices[0].message.content,
    tokensInput: data.usage?.prompt_tokens || 0,
    tokensOutput: data.usage?.completion_tokens || 0,
    latencyMs,
  };
}
