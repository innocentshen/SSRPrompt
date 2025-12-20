import type { Provider } from '../types';

export interface FileAttachment {
  name: string;
  type: string;
  base64: string;
}

interface AIResponse {
  content: string;
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
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
  return file.type.startsWith('image/');
}

export function isPdfFile(file: FileAttachment): boolean {
  return file.type === 'application/pdf';
}

export async function callAIModel(
  provider: Provider,
  modelName: string,
  prompt: string,
  userInput?: string,
  files?: FileAttachment[]
): Promise<AIResponse> {
  if (!provider.api_key) {
    throw new Error('API Key 未配置');
  }

  const fullPrompt = userInput ? `${prompt}\n\n${userInput}` : prompt;

  switch (provider.type) {
    case 'openai':
      return await callOpenAI(provider, modelName, fullPrompt, files);
    case 'anthropic':
      return await callAnthropic(provider, modelName, fullPrompt, files);
    case 'gemini':
      return await callGemini(provider, modelName, fullPrompt, files);
    case 'azure':
      return await callAzureOpenAI(provider, modelName, fullPrompt, files);
    case 'custom':
      return await callCustom(provider, modelName, fullPrompt, files);
    default:
      throw new Error(`不支持的服务商类型: ${provider.type}`);
  }
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

function buildOpenAIContent(prompt: string, files?: FileAttachment[]): string | OpenAIContentPart[] {
  if (!files || files.length === 0) {
    return prompt;
  }

  const content: OpenAIContentPart[] = [
    { type: 'text', text: prompt },
  ];

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
  files?: FileAttachment[]
): Promise<AIResponse> {
  const startTime = Date.now();
  const baseUrl = provider.base_url || 'https://api.openai.com';

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.api_key}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        {
          role: 'user',
          content: buildOpenAIContent(prompt, files),
        },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    }),
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
    }
  }

  content.push({ type: 'text', text: prompt });

  return content;
}

async function callAnthropic(
  provider: Provider,
  modelName: string,
  prompt: string,
  files?: FileAttachment[]
): Promise<AIResponse> {
  const startTime = Date.now();
  const baseUrl = provider.base_url || 'https://api.anthropic.com';

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.api_key!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: buildAnthropicContent(prompt, files),
        },
      ],
    }),
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

  parts.push({ text: prompt });

  return parts;
}

async function callGemini(
  provider: Provider,
  modelName: string,
  prompt: string,
  files?: FileAttachment[]
): Promise<AIResponse> {
  const startTime = Date.now();
  const baseUrl = provider.base_url || 'https://generativelanguage.googleapis.com';

  const response = await fetch(
    `${baseUrl}/v1beta/models/${modelName}:generateContent?key=${provider.api_key}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: buildGeminiParts(prompt, files),
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
        },
      }),
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
  files?: FileAttachment[]
): Promise<AIResponse> {
  const startTime = Date.now();

  if (!provider.base_url) {
    throw new Error('Azure OpenAI 需要配置 Base URL');
  }

  const response = await fetch(`${provider.base_url}/openai/deployments/${modelName}/chat/completions?api-version=2024-02-15-preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': provider.api_key!,
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: buildOpenAIContent(prompt, files),
        },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    }),
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
  files?: FileAttachment[]
): Promise<AIResponse> {
  const startTime = Date.now();

  if (!provider.base_url) {
    throw new Error('自定义服务商需要配置 Base URL');
  }

  const response = await fetch(`${provider.base_url}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.api_key}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        {
          role: 'user',
          content: buildOpenAIContent(prompt, files),
        },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    }),
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
