import type { ProviderType } from '../types/database';

/**
 * 模型能力推断工具
 * 用于根据服务商类型和模型名称推断模型的能力
 */

export interface ModelCapabilities {
  supportsVision: boolean;           // 支持图片
  supportsPdf: boolean;              // 支持 PDF
  supportsReasoning: boolean;        // 支持推理/思考
  supportsFunctionCalling: boolean;  // 支持函数调用
}

export interface FileUploadCapabilities {
  accept: string;           // input accept 属性
  canUploadImage: boolean;  // 是否可上传图片
  canUploadPdf: boolean;    // 是否可上传 PDF
  canUploadText: boolean;   // 是否可上传文本文件（始终为 true）
}

// 支持视觉的模型关键词
const VISION_MODEL_PATTERNS = [
  'vision',
  '4o',
  'gpt-4-turbo',
  'o1',
  'o3',
  'claude-3',
  'gemini',
  'llava',
  'cogvlm',
  'qwen-vl',
  'qwen2-vl',
  'internvl',
];

// 明确不支持视觉的模型关键词
const NON_VISION_MODEL_PATTERNS = [
  'text-embedding',
  'embedding',
  'whisper',
  'tts',
  'dall-e',
  'gpt-3.5',
  'gpt-3',
  'babbage',
  'davinci',
  'curie',
  'ada',
];

// 支持推理/思考的模型关键词
const REASONING_MODEL_PATTERNS = [
  'o1',           // OpenAI o1
  'o3',           // OpenAI o3
  'o4',           // OpenAI o4 (future)
  'gpt-5',        // OpenAI GPT-5
  'claude-3.7',   // Claude 3.7+ 支持 extended thinking
  'claude-sonnet-4',  // Claude Sonnet 4
  'claude-opus-4',    // Claude Opus 4
  'claude-4',     // Claude 4.x
  'gemini-2',     // Gemini 2.0 Flash Thinking
  'gemini-3',     // Gemini 3.0
  'qwq',          // Qwen QwQ
  'qwen3',        // Qwen3 有思考能力
  'deepseek-r',   // DeepSeek-R1
  'deepseek-reasoner', // DeepSeek Reasoner
  'thinking',     // 通用思考模型关键词
];

// 支持函数调用的模型关键词
const FUNCTION_CALLING_MODEL_PATTERNS = [
  'gpt-4',
  'gpt-3.5-turbo',
  'claude-3',
  'gemini',
  'qwen',
  'deepseek',
  'mistral',
  'command-r',
];

// 支持 PDF 的 OpenAI 模型
const OPENAI_PDF_MODELS = [
  'gpt-4o',
  'gpt-4-turbo',
  'o1',
  'o3',
  'chatgpt-4o',
];

/**
 * 根据模型名称智能推断是否支持视觉
 */
export function inferVisionSupport(modelId: string): boolean {
  const lowerModelId = modelId.toLowerCase();

  // 先检查是否明确不支持
  for (const pattern of NON_VISION_MODEL_PATTERNS) {
    if (lowerModelId.includes(pattern)) {
      return false;
    }
  }

  // 检查是否包含视觉相关关键词
  for (const pattern of VISION_MODEL_PATTERNS) {
    if (lowerModelId.includes(pattern)) {
      return true;
    }
  }

  // 默认支持（保守策略，用户可手动关闭）
  return true;
}

/**
 * 根据模型名称推断是否支持推理/思考功能
 */
export function inferReasoningSupport(modelId: string): boolean {
  const lowerModelId = modelId.toLowerCase();

  for (const pattern of REASONING_MODEL_PATTERNS) {
    if (lowerModelId.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * 根据模型名称推断是否支持函数调用
 */
export function inferFunctionCallingSupport(modelId: string): boolean {
  const lowerModelId = modelId.toLowerCase();

  // 嵌入模型等不支持函数调用
  for (const pattern of NON_VISION_MODEL_PATTERNS) {
    if (lowerModelId.includes(pattern)) {
      return false;
    }
  }

  // 检查是否包含函数调用相关关键词
  for (const pattern of FUNCTION_CALLING_MODEL_PATTERNS) {
    if (lowerModelId.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  // 默认不支持
  return false;
}

/**
 * 检测服务商是否原生支持 PDF
 */
function providerSupportsPdf(providerType: ProviderType): boolean {
  return providerType === 'gemini' || providerType === 'anthropic';
}

/**
 * 检测 OpenAI 类型服务商的模型是否支持 PDF
 */
function openaiModelSupportsPdf(modelId: string): boolean {
  const lowerModelId = modelId.toLowerCase();
  return OPENAI_PDF_MODELS.some(pattern => lowerModelId.includes(pattern));
}

/**
 * 检测 Custom 服务商中的模型是否支持 PDF
 * 根据模型名称推断
 */
function customModelSupportsPdf(modelId: string): boolean {
  const lowerModelId = modelId.toLowerCase();

  // Gemini 模型
  if (lowerModelId.includes('gemini')) {
    return true;
  }

  // Claude 模型
  if (lowerModelId.includes('claude')) {
    return true;
  }

  // OpenAI 兼容的高级模型
  if (openaiModelSupportsPdf(modelId)) {
    return true;
  }

  return false;
}

/**
 * 推断模型的 PDF 支持能力
 */
export function inferPdfSupport(providerType: ProviderType, modelId: string): boolean {
  // Gemini 和 Anthropic 原生支持
  if (providerSupportsPdf(providerType)) {
    return true;
  }

  // OpenAI 根据模型判断
  if (providerType === 'openai') {
    return openaiModelSupportsPdf(modelId);
  }

  // Custom 服务商根据模型名称推断
  if (providerType === 'custom') {
    return customModelSupportsPdf(modelId);
  }

  return false;
}

/**
 * 获取模型的完整能力
 */
export function getModelCapabilities(
  providerType: ProviderType,
  modelId: string,
  userConfiguredVision?: boolean,
  userConfiguredReasoning?: boolean,
  userConfiguredFunctionCalling?: boolean
): ModelCapabilities {
  // 视觉能力：优先使用用户配置，否则智能推断
  const supportsVision = userConfiguredVision ?? inferVisionSupport(modelId);

  // PDF 能力：根据服务商和模型推断
  const supportsPdf = supportsVision && inferPdfSupport(providerType, modelId);

  // 推理能力：优先使用用户配置，否则智能推断
  const supportsReasoning = userConfiguredReasoning ?? inferReasoningSupport(modelId);

  // 函数调用能力：优先使用用户配置，否则智能推断
  const supportsFunctionCalling = userConfiguredFunctionCalling ?? inferFunctionCallingSupport(modelId);

  return {
    supportsVision,
    supportsPdf,
    supportsReasoning,
    supportsFunctionCalling,
  };
}

/**
 * 获取文件上传能力配置
 * 用于设置 input 的 accept 属性和控制上传按钮状态
 */
export function getFileUploadCapabilities(
  providerType: ProviderType,
  modelId: string,
  supportsVision: boolean
): FileUploadCapabilities {
  const capabilities = getModelCapabilities(providerType, modelId, supportsVision);

  // 构建 accept 字符串
  const acceptParts: string[] = [];

  // 文本文件始终可上传
  acceptParts.push('.txt', '.md', '.json', '.csv', '.xml', '.yaml', '.yml');

  if (capabilities.supportsVision) {
    acceptParts.push('image/*');
  }

  if (capabilities.supportsPdf) {
    acceptParts.push('application/pdf');
  }

  return {
    accept: acceptParts.join(','),
    canUploadImage: capabilities.supportsVision,
    canUploadPdf: capabilities.supportsPdf,
    canUploadText: true, // 始终支持
  };
}

/**
 * 检查文件类型是否被允许上传
 */
export function isFileTypeAllowed(
  file: File | { type: string; name?: string },
  providerType: ProviderType,
  modelId: string,
  supportsVision: boolean
): boolean {
  const capabilities = getFileUploadCapabilities(providerType, modelId, supportsVision);
  const fileType = file.type.toLowerCase();
  const fileName = file.name?.toLowerCase() || '';

  // 文本文件始终允许
  const textExtensions = ['.txt', '.md', '.json', '.csv', '.xml', '.yaml', '.yml'];
  const textMimeTypes = [
    'text/plain', 'text/markdown', 'application/json',
    'text/csv', 'application/xml', 'text/xml', 'text/yaml', 'application/x-yaml'
  ];

  if (textMimeTypes.includes(fileType) || textExtensions.some(ext => fileName.endsWith(ext))) {
    return true;
  }

  // 图片
  if (fileType.startsWith('image/')) {
    return capabilities.canUploadImage;
  }

  // PDF
  if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
    return capabilities.canUploadPdf;
  }

  return false;
}
