import type { FileAttachment } from './ai-service';

// 支持的文本文件 MIME 类型
export const TEXT_FILE_TYPES = [
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
  'application/xml',
  'text/xml',
  'text/yaml',
  'application/x-yaml',
];

// 支持的图片文件 MIME 类型
export const IMAGE_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

// 支持的 PDF 文件 MIME 类型
export const PDF_FILE_TYPES = [
  'application/pdf',
];

// 所有支持的文件类型
export const ALL_SUPPORTED_FILE_TYPES = [
  ...IMAGE_FILE_TYPES,
  ...PDF_FILE_TYPES,
  ...TEXT_FILE_TYPES,
];

// 文件扩展名到 MIME 类型的映射
const EXTENSION_TO_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

/**
 * 检测是否为图片文件
 */
export function isImageFile(file: FileAttachment | { type: string; name?: string }): boolean {
  if (IMAGE_FILE_TYPES.includes(file.type)) {
    return true;
  }
  // 通过扩展名检测
  if (file.name) {
    const ext = getFileExtension(file.name).toLowerCase();
    const mimeType = EXTENSION_TO_MIME[ext];
    return mimeType ? IMAGE_FILE_TYPES.includes(mimeType) : false;
  }
  return file.type.startsWith('image/');
}

/**
 * 检测是否为 PDF 文件
 */
export function isPdfFile(file: FileAttachment | { type: string; name?: string }): boolean {
  if (file.type === 'application/pdf') {
    return true;
  }
  // 通过扩展名检测
  if (file.name) {
    const ext = getFileExtension(file.name).toLowerCase();
    return ext === '.pdf';
  }
  return false;
}

/**
 * 检测是否为文本文件
 */
export function isTextFile(file: FileAttachment | { type: string; name?: string }): boolean {
  if (TEXT_FILE_TYPES.includes(file.type)) {
    return true;
  }
  // 通过扩展名检测
  if (file.name) {
    const ext = getFileExtension(file.name).toLowerCase();
    const mimeType = EXTENSION_TO_MIME[ext];
    return mimeType ? TEXT_FILE_TYPES.includes(mimeType) : false;
  }
  return file.type.startsWith('text/');
}

/**
 * 获取文件扩展名
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.slice(lastDot) : '';
}

/**
 * 获取文件类型的友好名称
 */
export function getFileTypeName(file: FileAttachment | { type: string; name?: string }): string {
  if (isImageFile(file)) return '图片';
  if (isPdfFile(file)) return 'PDF';
  if (isTextFile(file)) {
    const ext = file.name ? getFileExtension(file.name).toLowerCase() : '';
    switch (ext) {
      case '.md':
      case '.markdown':
        return 'Markdown';
      case '.json':
        return 'JSON';
      case '.csv':
        return 'CSV';
      case '.xml':
        return 'XML';
      case '.yaml':
      case '.yml':
        return 'YAML';
      default:
        return '文本';
    }
  }
  return '文件';
}

/**
 * 从 base64 解码文本内容
 */
export function readTextContent(base64: string): string {
  try {
    // 使用 atob 解码 base64，然后处理 UTF-8
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    // 如果 UTF-8 解码失败，尝试直接解码
    try {
      return atob(base64);
    } catch {
      return '[无法解码文件内容]';
    }
  }
}

/**
 * 获取用于 AI 调用的文件内容描述
 * 文本文件会被解码并以特定格式嵌入
 */
export function getFileContentForAI(file: FileAttachment): { type: 'text' | 'image' | 'pdf'; content: string } {
  if (isTextFile(file)) {
    const textContent = readTextContent(file.base64);
    return {
      type: 'text',
      content: `[File: ${file.name}]\n\`\`\`\n${textContent}\n\`\`\``,
    };
  }
  if (isImageFile(file)) {
    return {
      type: 'image',
      content: `data:${file.type};base64,${file.base64}`,
    };
  }
  if (isPdfFile(file)) {
    return {
      type: 'pdf',
      content: `data:application/pdf;base64,${file.base64}`,
    };
  }
  // 未知类型作为文本处理
  return {
    type: 'text',
    content: `[File: ${file.name}] (unsupported file type)`,
  };
}

/**
 * 获取文件上传的 accept 属性值
 */
export function getFileInputAccept(): string {
  return 'image/*,application/pdf,.txt,.md,.json,.csv,.xml,.yaml,.yml';
}

/**
 * 检查文件类型是否受支持
 */
export function isSupportedFileType(file: File | { type: string; name?: string }): boolean {
  if (ALL_SUPPORTED_FILE_TYPES.includes(file.type)) {
    return true;
  }
  // 通过扩展名检测
  if (file.name) {
    const ext = getFileExtension(file.name).toLowerCase();
    return ext in EXTENSION_TO_MIME;
  }
  return false;
}

/**
 * 获取文件的显示图标类型
 */
export function getFileIconType(file: FileAttachment | { type: string; name?: string }): 'image' | 'pdf' | 'code' | 'text' | 'file' {
  if (isImageFile(file)) return 'image';
  if (isPdfFile(file)) return 'pdf';
  if (isTextFile(file)) {
    const ext = file.name ? getFileExtension(file.name).toLowerCase() : '';
    if (['.json', '.xml', '.yaml', '.yml'].includes(ext)) {
      return 'code';
    }
    return 'text';
  }
  return 'file';
}

/**
 * 获取语法高亮语言
 */
export function getSyntaxLanguage(file: FileAttachment | { name?: string }): string {
  if (!file.name) return 'text';
  const ext = getFileExtension(file.name).toLowerCase();
  switch (ext) {
    case '.json':
      return 'json';
    case '.xml':
      return 'xml';
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.csv':
      return 'csv';
    default:
      return 'text';
  }
}
