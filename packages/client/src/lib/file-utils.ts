import type { FileAttachment } from './ai-service';

// Supported text MIME types
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

// Supported image MIME types
export const IMAGE_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

// Supported PDF MIME types
export const PDF_FILE_TYPES = [
  'application/pdf',
];

// All supported file types
export const ALL_SUPPORTED_FILE_TYPES = [
  ...IMAGE_FILE_TYPES,
  ...PDF_FILE_TYPES,
  ...TEXT_FILE_TYPES,
];

// File extension → MIME mapping (fallback when browser doesn't provide a reliable MIME)
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

export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.slice(lastDot) : '';
}

export function isImageFile(file: FileAttachment | { type: string; name?: string }): boolean {
  if (IMAGE_FILE_TYPES.includes(file.type)) return true;

  if (file.name) {
    const ext = getFileExtension(file.name).toLowerCase();
    const mimeType = EXTENSION_TO_MIME[ext];
    return mimeType ? IMAGE_FILE_TYPES.includes(mimeType) : false;
  }

  return file.type.startsWith('image/');
}

export function isPdfFile(file: FileAttachment | { type: string; name?: string }): boolean {
  if (file.type === 'application/pdf') return true;

  if (file.name) {
    const ext = getFileExtension(file.name).toLowerCase();
    return ext === '.pdf';
  }

  return false;
}

export function isTextFile(file: FileAttachment | { type: string; name?: string }): boolean {
  if (TEXT_FILE_TYPES.includes(file.type)) return true;

  if (file.name) {
    const ext = getFileExtension(file.name).toLowerCase();
    const mimeType = EXTENSION_TO_MIME[ext];
    return mimeType ? TEXT_FILE_TYPES.includes(mimeType) : false;
  }

  return file.type.startsWith('text/');
}

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
 * A lightweight placeholder for legacy callers that used to embed file bytes in the frontend.
 * File bytes are now stored server-side (fileId) and expanded by the backend when sending to the LLM.
 */
export function getFileContentForAI(file: FileAttachment): { type: 'text'; content: string } {
  return {
    type: 'text',
    content: `[File: ${file.name}] (fileId=${file.fileId})`,
  };
}

export function getFileInputAccept(): string {
  return '.png,.jpg,.jpeg,.gif,.webp,image/*,.pdf,application/pdf,.txt,.md,.json,.csv,.xml,.yaml,.yml';
}

export function isSupportedFileType(file: File | { type: string; name?: string }): boolean {
  if (ALL_SUPPORTED_FILE_TYPES.includes(file.type)) return true;

  if (file.name) {
    const ext = getFileExtension(file.name).toLowerCase();
    return ext in EXTENSION_TO_MIME;
  }

  return false;
}

export function getFileIconType(
  file: FileAttachment | { type: string; name?: string }
): 'image' | 'pdf' | 'code' | 'text' | 'file' {
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
