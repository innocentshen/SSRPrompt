import type { FileAttachment } from './ai-service';
import type { ModelParameters, TestCaseResult } from '../types';

export type CsvColumn = { key: string; label: string };

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCsv(columns: CsvColumn[], rows: Array<Record<string, unknown>>): string {
  const header = columns.map((column) => csvEscape(column.label)).join(',');
  const lines = rows.map((row) => columns.map((column) => csvEscape(row[column.key])).join(','));
  return [header, ...lines].join('\r\n');
}

export function formatModelParameters(params?: ModelParameters | null): string {
  if (!params) return '';
  const entries: string[] = [];
  if (params.temperature !== undefined) entries.push(`temperature=${params.temperature}`);
  if (params.max_tokens !== undefined) entries.push(`max_tokens=${params.max_tokens}`);
  if (params.top_p !== undefined) entries.push(`top_p=${params.top_p}`);
  if (params.frequency_penalty !== undefined) entries.push(`frequency_penalty=${params.frequency_penalty}`);
  if (params.presence_penalty !== undefined) entries.push(`presence_penalty=${params.presence_penalty}`);
  return entries.join('; ');
}

export function formatScoreDetails(scores: Record<string, number>, feedback: Record<string, unknown>): string {
  const entries = Object.entries(scores || {});
  if (entries.length === 0) return '';
  return entries
    .map(([name, score]) => {
      const scoreValue = typeof score === 'number' && !Number.isNaN(score) ? (score * 10).toFixed(1) : String(score);
      const feedbackValue = feedback?.[name];
      let feedbackText = '';
      if (feedbackValue !== undefined && feedbackValue !== null && feedbackValue !== '') {
        if (typeof feedbackValue === 'string') {
          feedbackText = feedbackValue;
        } else {
          try {
            feedbackText = JSON.stringify(feedbackValue);
          } catch {
            feedbackText = String(feedbackValue);
          }
        }
      }
      return feedbackText ? `${name}:${scoreValue} (${feedbackText})` : `${name}:${scoreValue}`;
    })
    .join(' | ');
}

export function formatAttachmentLinks(apiBaseUrl: string, attachments?: FileAttachment[] | null): string {
  if (!attachments || attachments.length === 0) return '';
  return attachments
    .map((attachment) => {
      const link = `${apiBaseUrl}/files/${attachment.fileId}`;
      return attachment.name ? `${attachment.name}: ${link}` : link;
    })
    .join('; ');
}

export function mergeResultsByTestCase(prev: TestCaseResult[], updates: TestCaseResult[]): TestCaseResult[] {
  if (updates.length === 0) return prev;
  const updatesById = new Map(updates.map((result) => [result.testCaseId, result]));
  const prevIds = new Set(prev.map((result) => result.testCaseId));
  const next = prev.map((result) => updatesById.get(result.testCaseId) ?? result);
  for (const result of updates) {
    if (!prevIds.has(result.testCaseId)) {
      next.push(result);
    }
  }
  return next;
}

export function formatTimestampForFilename(dateValue: string | Date | null | undefined): string {
  if (!dateValue) return 'unknown-time';
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'unknown-time';
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export function sanitizeFilenamePart(value: string, fallback: string): string {
  const trimmed = value.trim();
  const base = trimmed || fallback;
  const sanitized = base
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '');
  return sanitized || fallback;
}

export function readImportProgressNumber(progress: Record<string, unknown> | null | undefined, key: string): number {
  const value = progress ? progress[key] : undefined;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function readImportProgressString(progress: Record<string, unknown> | null | undefined, key: string): string {
  const value = progress ? progress[key] : undefined;
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

export function formatImportJobError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const record = err as { message?: unknown };
    if (typeof record.message === 'string') return record.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
