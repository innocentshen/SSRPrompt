import { isImageFile as checkIsImage, isPdfFile as checkIsPdf, isTextFile as checkIsText } from './file-utils';
import { filesApi } from '../api/files';

export interface FileAttachment {
  fileId: string;
  name: string;
  type: string;
  size?: number;
}

// 思考内容提取结果
export interface ThinkingContent {
  thinking: string;
  content: string;
}

// 思考内容检测正则模式
const THINKING_PATTERNS = [
  /<thinking>(?:\s*[:\uFF1A]\s*)?([\s\S]*?)<\/thinking>(?:\s*[:\uFF1A]\s*)?/gi,
  /<think>(?:\s*[:\uFF1A]\s*)?([\s\S]*?)<\/think>(?:\s*[:\uFF1A]\s*)?/gi,
  /<thought>(?:\s*[:\uFF1A]\s*)?([\s\S]*?)<\/thought>(?:\s*[:\uFF1A]\s*)?/gi,
  /<reasoning>(?:\s*[:\uFF1A]\s*)?([\s\S]*?)<\/reasoning>(?:\s*[:\uFF1A]\s*)?/gi,
  /\[THINKING\](?:\s*[:\uFF1A]\s*)?([\s\S]*?)\[\/THINKING\](?:\s*[:\uFF1A]\s*)?/gi,
  /◁think▷(?:\s*[:\uFF1A]\s*)?([\s\S]*?)◁\/think▷(?:\s*[:\uFF1A]\s*)?/gi,
  /<seed:think>(?:\s*[:\uFF1A]\s*)?([\s\S]*?)<\/seed:think>(?:\s*[:\uFF1A]\s*)?/gi,
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
        const cleaned = match[1].replace(/^\s*[:\uFF1A]\s*/, '').trim();
        if (!cleaned) continue;
        thinking += (thinking ? '\n\n' : '') + cleaned;
      }
    }

    // Remove thinking blocks from content
    content = content.replace(pattern, '');
  }

  // Clean up ###Response header if it exists (from ###Thinking format)
  content = content.replace(/^###\s*Response\s*\n?/gim, '');

  // Some models place a ":" separator between thinking and the final answer.
  // If we've extracted thinking, strip a leading separator from the remaining content.
  if (thinking.trim()) {
    content = content.replace(/^\s*[:\uFF1A]\s*/, '');
  }

  return {
    thinking: thinking.trim(),
    content: content.trim(),
  };
}

/**
 * 上传文件到文件服务，返回 fileId 引用
 */
export async function uploadFileAttachment(file: File): Promise<FileAttachment> {
  const uploaded = await filesApi.upload(file);
  return {
    fileId: uploaded.id,
    name: uploaded.name,
    type: uploaded.type,
    size: uploaded.size,
  };
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
