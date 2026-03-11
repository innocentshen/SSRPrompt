import { AppError } from '@ssrprompt/shared';

import type { MultimodalOcrParams } from '@ssrprompt/shared';
import type { ContentPart } from './chat.service.js';

export const MULTIMODAL_DEFAULT_PROMPT = [
  'You are an OCR-style document transcription model.',
  'Extract the attached file faithfully into Markdown.',
  'Do not summarize, translate, rewrite, or omit content.',
  'Preserve headings, paragraphs, lists, tables, and code blocks when present.',
  'If some text is unreadable, mark it clearly in Markdown.',
  'Output Markdown only.',
].join(' ');

export function getMultimodalPrompt(params: MultimodalOcrParams): string {
  return params.prompt?.trim() || MULTIMODAL_DEFAULT_PROMPT;
}

export function buildMultimodalOcrUserParts(
  params: MultimodalOcrParams,
  file: { buffer: Buffer; mimeType: string; filename: string },
  providerType?: string | null
): ContentPart[] {
  const promptPart: ContentPart = {
    type: 'text',
    text: getMultimodalPrompt(params),
  };

  const attachmentPart: ContentPart =
    file.mimeType === 'application/pdf'
      ? {
          type: 'file',
          file: {
            filename: file.filename,
            file_data: `data:${file.mimeType};base64,${file.buffer.toString('base64')}`,
          },
        }
      : {
          type: 'image_url',
          image_url: {
            url: `data:${file.mimeType};base64,${file.buffer.toString('base64')}`,
          },
        };

  // Gemini document handling is sensitive to part ordering for PDF inputs.
  // Put the PDF part first so the follow-up prompt reliably applies to the document.
  if (providerType === 'gemini' && file.mimeType === 'application/pdf') {
    return [attachmentPart, promptPart];
  }

  return [promptPart, attachmentPart];
}

export function buildMultimodalOcrUserPartsFromPageImages(
  params: MultimodalOcrParams,
  pageImages: Array<{ mimeType: string; dataUrl: string }>
): ContentPart[] {
  const parts: ContentPart[] = [
    {
      type: 'text',
      text: getMultimodalPrompt(params),
    },
  ];

  pageImages.forEach((image, index) => {
    if (pageImages.length > 1) {
      parts.push({
        type: 'text',
        text: `PDF page ${index + 1}:`,
      });
    }
    parts.push({
      type: 'image_url',
      image_url: {
        url: image.dataUrl,
      },
    });
  });

  return parts;
}

const OPENAI_PDF_MODEL_PATTERNS = ['gpt-4o', 'gpt-4-turbo', 'o1', 'o3', 'chatgpt-4o'];

function openaiModelSupportsPdf(modelId?: string | null): boolean {
  const lowerModelId = modelId?.toLowerCase().trim() || '';
  if (!lowerModelId) return false;
  return OPENAI_PDF_MODEL_PATTERNS.some((pattern) => lowerModelId.includes(pattern));
}

export function supportsMultimodalPdfInput(providerType?: string | null, modelId?: string | null): boolean {
  const normalizedProvider = providerType?.trim().toLowerCase() || '';
  const lowerModelId = modelId?.toLowerCase().trim() || '';

  if (!normalizedProvider) return false;
  if (normalizedProvider === 'gemini' || normalizedProvider === 'anthropic') return true;

  if (normalizedProvider === 'openrouter') {
    if (lowerModelId.includes('gemini') || lowerModelId.includes('claude')) return true;
    return openaiModelSupportsPdf(modelId);
  }

  if (normalizedProvider === 'openai' || normalizedProvider === 'custom') {
    if (lowerModelId.includes('gemini') || lowerModelId.includes('claude')) return true;
    return openaiModelSupportsPdf(modelId);
  }

  return false;
}

export function assertNonEmptyOcrOutput(fullText: string): void {
  if (fullText.trim().length > 0) return;
  throw new AppError(502, 'PROVIDER_ERROR', 'OCR returned empty content');
}
