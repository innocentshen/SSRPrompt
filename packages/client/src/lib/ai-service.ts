import type { Provider, ReasoningEffort } from '../types';
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
  reasoning?: {
    enabled: boolean;
    effort: ReasoningEffort;
  };
  signal?: AbortSignal;
}

export interface StreamUsage {
  tokensInput: number;
  tokensOutput: number;
}

// 推理强度到 token 预算的映射
const EFFORT_TO_BUDGET: Record<ReasoningEffort, number> = {
  default: 0,
  none: 0,
  low: 0.05,
  medium: 0.5,
  high: 0.8,
};

/**
 * 计算 Anthropic thinking token 预算
 */
function calculateThinkingBudget(
  effort: ReasoningEffort,
  tokenRange: { min: number; max: number } = { min: 1024, max: 64000 }
): number {
  const ratio = EFFORT_TO_BUDGET[effort];
  return Math.round(tokenRange.min + (tokenRange.max - tokenRange.min) * ratio);
}

/**
 * 构建推理参数
 */
export function buildReasoningParams(
  providerType: string,
  modelName: string,
  reasoning?: { enabled: boolean; effort: ReasoningEffort },
  baseUrl?: string
): Record<string, unknown> {
  const lowerModelName = modelName.toLowerCase();

  // 检测是否是 OpenRouter（通过 base_url 判断）
  const isOpenRouter = providerType === 'openrouter' || (baseUrl && baseUrl.includes('openrouter'));

  // OpenRouter 使用 reasoning.effort 格式
  if (isOpenRouter) {
    if (!reasoning?.enabled || reasoning.effort === 'default' || reasoning.effort === 'none') {
      return {};
    }
    return {
      reasoning: {
        effort: reasoning.effort,
      },
    };
  }

  // Gemini 2.5 Pro / Gemini 3 Pro 思考模式始终开启，需要特殊处理
  // 即使用户选择 "default"，也需要让 Gemini 自己决定思考预算
  if (providerType === 'gemini') {
    // Gemini 2.5 Pro / Gemini 3 Pro: 思考无法关闭
    if (/gemini-2\.5-pro|gemini-3.*pro/.test(lowerModelName)) {
      // 如果用户选择了具体的 effort，计算对应的 budget
      if (reasoning?.enabled && reasoning.effort !== 'default' && reasoning.effort !== 'none') {
        const budget = calculateThinkingBudget(reasoning.effort, { min: 128, max: 32768 });
        return {
          generationConfig: {
            thinkingConfig: {
              thinkingBudget: budget,
            },
          },
        };
      }
      // 默认情况下不传 thinkingConfig，让 Gemini 自己决定（但思考仍然开启）
      return {};
    }
    // Gemini 2.5 Flash 等: 可以设置为 0 关闭思考
    if (/gemini-2|gemini-3|gemini-.*thinking/.test(lowerModelName)) {
      if (reasoning?.enabled && reasoning.effort !== 'default' && reasoning.effort !== 'none') {
        const budget = calculateThinkingBudget(reasoning.effort, { min: 0, max: 24576 });
        return {
          generationConfig: {
            thinkingConfig: {
              thinkingBudget: budget,
            },
          },
        };
      }
      return {};
    }
  }

  // 其他模型：如果未启用或选择 default/none，返回空
  if (!reasoning?.enabled || reasoning.effort === 'default' || reasoning.effort === 'none') {
    return {};
  }

  const effort = reasoning.effort;

  switch (providerType) {
    case 'openai':
      // OpenAI o1/o3/o4 系列支持 reasoning_effort
      if (/^o[134]|gpt-5/.test(lowerModelName)) {
        return { reasoning_effort: effort };
      }
      return {};

    case 'anthropic':
      // Claude 3.7+ 支持 thinking (3.5 不支持)
      if (/claude-3\.[7-9]|claude-sonnet-4|claude-opus-4|claude-4/.test(lowerModelName)) {
        const budget = calculateThinkingBudget(effort);
        return {
          thinking: {
            type: 'enabled',
            budget_tokens: budget,
          },
        };
      }
      return {};

    // Gemini 已在函数开头处理，这里不再需要

    case 'openrouter':
      // OpenRouter 使用 reasoning.effort 格式
      return {
        reasoning: {
          effort: effort,
        },
      };

    case 'custom':
      // Custom provider (包括 NewAPI、one-api 等中转站)
      // 注意：中转站可能将请求路由到不同的后端（Bedrock、OpenRouter 等）
      // 不同后端支持的参数格式不同，需要谨慎处理

      // Gemini 系列 - 大多数中转站支持 reasoning.effort 格式
      if (/gemini-2\.5|gemini-3|gemini-.*flash.*preview|gemini-.*pro.*preview/.test(lowerModelName)) {
        return {
          reasoning: {
            effort: effort,
          },
        };
      }

      // Qwen 系列 (QwQ, Qwen3) - 使用 reasoning.effort 格式
      if (/qwen3|qwq/.test(lowerModelName)) {
        return {
          reasoning: {
            effort: effort,
          },
        };
      }

      // DeepSeek 系列 (R1, Reasoner) - 使用 reasoning.effort 格式
      if (/deepseek-r|deepseek-reasoner/.test(lowerModelName)) {
        return {
          reasoning: {
            effort: effort,
          },
        };
      }

      // 其他模型：如果模型名称包含 thinking/reasoning 关键词，尝试启用
      if (/thinking|reasoning|r1/.test(lowerModelName)) {
        return {
          reasoning: {
            effort: effort,
          },
        };
      }

      // Claude 和 OpenAI 系列：不发送 reasoning 参数
      // 因为中转站可能将它们路由到 Bedrock 等后端，这些后端不支持 reasoning 参数
      // 用户如果需要思考功能，应该使用原生 provider type (anthropic/openai)

      // 默认不发送 reasoning 参数
      return {};

    default:
      return {};
  }
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onThinkingToken?: (token: string) => void;
  onComplete?: (fullContent: string, thinking?: string, usage?: StreamUsage) => void;
  onError?: (error: string) => void;
  onAbort?: () => void;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name?: unknown }).name === 'AbortError';
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
    case 'openrouter':
      return await callOpenRouter(provider, modelName, fullPrompt, files, options);
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

        // 添加推理参数
        const reasoningParams = buildReasoningParams('anthropic', modelName, options?.reasoning);
        Object.assign(requestBody, reasoningParams);

        const response = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': provider.api_key!,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'pdfs-2024-09-25,interleaved-thinking-2025-05-14',
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

        // 添加推理参数 (Gemini 的 thinkingConfig 需要合并到 generationConfig)
        const reasoningParams = buildReasoningParams('gemini', modelName, options?.reasoning);
        if (reasoningParams.generationConfig) {
          Object.assign(generationConfig, reasoningParams.generationConfig);
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

  // Debug: 打印 provider 类型
  console.log('[AI Service Debug] provider.type:', provider.type, 'modelName:', modelName);

  try {
    switch (provider.type) {
      case 'openai':
      case 'openrouter':
      case 'custom': {
        const baseUrl = provider.type === 'openrouter'
          ? (provider.base_url || 'https://openrouter.ai/api')
          : (provider.base_url || 'https://api.openai.com');

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

        // 添加推理参数（传入 baseUrl 以检测 OpenRouter）
        const reasoningParams = buildReasoningParams(provider.type, modelName, options?.reasoning, baseUrl);
        Object.assign(requestBody, reasoningParams);

        // Debug: 打印请求体
        console.log('[Custom API Debug] requestBody:', JSON.stringify(requestBody, null, 2));

        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.api_key}`,
          },
          body: JSON.stringify(requestBody),
          signal: options?.signal,
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
        let fullThinking = '';
        let usage: StreamUsage = { tokensInput: 0, tokensOutput: 0 };
        let reasoningDetails: Array<{ type: string; text?: string }> = [];

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
                const choice = parsed.choices?.[0];
                const delta = choice?.delta;

                // Debug: 打印完整的 choice 结构（只打印前几次）
                if (choice && fullContent.length < 100) {
                  console.log('[Custom API Debug] full choice:', JSON.stringify(choice));
                }

                // 处理标准 content
                if (delta?.content) {
                  fullContent += delta.content;
                  callbacks.onToken(delta.content);
                  // 让出主线程，给浏览器一帧的时间渲染
                  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
                }

                // 处理 OpenRouter 的流式 reasoning 字段
                if (delta?.reasoning) {
                  fullThinking += delta.reasoning;
                  callbacks.onThinkingToken?.(delta.reasoning);
                  // 让出主线程，给浏览器一帧的时间渲染
                  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
                }

                // 处理 OpenRouter 的 reasoning_content 字段 (某些模型使用)
                if (delta?.reasoning_content) {
                  fullThinking += delta.reasoning_content;
                  callbacks.onThinkingToken?.(delta.reasoning_content);
                  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
                }

                // 处理最终消息中的 reasoning_details (非流式部分)
                const message = choice?.message;
                if (message?.reasoning_details) {
                  reasoningDetails = message.reasoning_details;
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

        // 从 reasoning_details 中提取思考文本 (如果流式没有获取到)
        if (!fullThinking && reasoningDetails.length > 0) {
          fullThinking = reasoningDetails
            .filter((item) => item.type === 'reasoning.text' && item.text)
            .map((item) => item.text)
            .join('\n\n');
        }

        // 如果有思考内容，将其包装成标签格式
        if (fullThinking) {
          fullContent = `<think>${fullThinking}</think>${fullContent}`;
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

        // 添加推理参数
        const reasoningParams = buildReasoningParams('anthropic', modelName, options?.reasoning);
        Object.assign(requestBody, reasoningParams);

        const response = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': provider.api_key!,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'pdfs-2024-09-25,interleaved-thinking-2025-05-14',
          },
          body: JSON.stringify(requestBody),
          signal: options?.signal,
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
        let fullThinking = '';
        let usage: StreamUsage = { tokensInput: 0, tokensOutput: 0 };
        let currentBlockType: 'text' | 'thinking' | null = null;

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

                // Track content block type (text or thinking)
                if (parsed.type === 'content_block_start') {
                  if (parsed.content_block?.type === 'thinking') {
                    currentBlockType = 'thinking';
                  } else if (parsed.content_block?.type === 'text') {
                    currentBlockType = 'text';
                  }
                }

                // Handle content_block_delta
                if (parsed.type === 'content_block_delta') {
                  // Handle thinking delta
                  if (parsed.delta?.type === 'thinking_delta' && parsed.delta?.thinking) {
                    fullThinking += parsed.delta.thinking;
                    callbacks.onThinkingToken?.(parsed.delta.thinking);
                    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
                  }
                  // Handle text delta
                  else if (parsed.delta?.text) {
                    fullContent += parsed.delta.text;
                    callbacks.onToken(parsed.delta.text);
                    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
                  }
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

        callbacks.onComplete?.(fullContent, fullThinking || undefined, usage);
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

        // 添加推理参数 (Gemini 的 thinkingConfig 需要合并到 generationConfig)
        const reasoningParams = buildReasoningParams('gemini', modelName, options?.reasoning);
        if (reasoningParams.generationConfig) {
          Object.assign(generationConfig, reasoningParams.generationConfig);
        }

        const response = await fetch(
          `${baseUrl}/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${provider.api_key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: options?.signal,
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
        let fullThinking = '';
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
                const parts = parsed.candidates?.[0]?.content?.parts;
                // Debug: 打印 Gemini 返回的 parts 结构
                if (parts && Array.isArray(parts)) {
                  console.log('[Gemini Debug] parts:', JSON.stringify(parts, null, 2));
                }
                if (parts && Array.isArray(parts)) {
                  for (const part of parts) {
                    // Gemini 2.5 思考内容: part.thought 为 true 表示是思考内容
                    if (part.thought === true && part.text) {
                      fullThinking += part.text;
                      callbacks.onThinkingToken?.(part.text);
                      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
                    } else if (part.text && !part.thought) {
                      // 普通文本内容
                      fullContent += part.text;
                      callbacks.onToken(part.text);
                    }
                  }
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

        callbacks.onComplete?.(fullContent, fullThinking || undefined, usage);
        break;
      }

      default:
        callbacks.onError?.(`不支持的服务商类型: ${provider.type}`);
    }
  } catch (e) {
    if (isAbortError(e)) {
      callbacks.onAbort?.();
      return;
    }
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

  // 添加推理参数
  const reasoningParams = buildReasoningParams('openai', modelName, options?.reasoning);
  Object.assign(requestBody, reasoningParams);

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

  // 添加推理参数
  const reasoningParams = buildReasoningParams('anthropic', modelName, options?.reasoning);
  Object.assign(requestBody, reasoningParams);

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.api_key!,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25,interleaved-thinking-2025-05-14',
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

  // 添加推理参数 (Gemini 的 thinkingConfig 需要合并到 generationConfig)
  const reasoningParams = buildReasoningParams('gemini', modelName, options?.reasoning);
  if (reasoningParams.generationConfig) {
    Object.assign(requestBody.generationConfig as Record<string, unknown>, reasoningParams.generationConfig);
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

  // 添加推理参数
  const reasoningParams = buildReasoningParams('custom', modelName, options?.reasoning);
  Object.assign(requestBody, reasoningParams);

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

async function callOpenRouter(
  provider: Provider,
  modelName: string,
  prompt: string,
  files?: FileAttachment[],
  options?: AICallOptions
): Promise<AIResponse> {
  const startTime = Date.now();
  const baseUrl = provider.base_url || 'https://openrouter.ai/api';
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

  // 添加推理参数
  const reasoningParams = buildReasoningParams('openrouter', modelName, options?.reasoning);
  Object.assign(requestBody, reasoningParams);

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.api_key}`,
      'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API 错误: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const latencyMs = Date.now() - startTime;

  // 提取思考内容（如果有）
  let thinking = '';
  if (data.choices[0]?.message?.reasoning) {
    thinking = data.choices[0].message.reasoning;
  }

  return {
    content: data.choices[0].message.content,
    thinking: thinking || undefined,
    tokensInput: data.usage?.prompt_tokens || 0,
    tokensOutput: data.usage?.completion_tokens || 0,
    latencyMs,
  };
}
