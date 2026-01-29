import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import type { OutputRenderFormat, OutputRenderPreferences } from '../../lib/output-renderer-prefs';
import { MarkdownRenderer } from './MarkdownRenderer';
import { HtmlArtifactsCard } from './HtmlArtifactsCard';

interface OutputRendererControlsProps {
  preferences: OutputRenderPreferences;
  onChange: (next: OutputRenderPreferences) => void;
  className?: string;
}

export function OutputRendererControls({ preferences, onChange, className }: OutputRendererControlsProps) {
  const { t } = useTranslation('common');

  const options: { value: OutputRenderFormat; label: string }[] = [
    { value: 'auto', label: t('autoDetect') },
    { value: 'json', label: 'JSON' },
    { value: 'html', label: 'HTML' },
    { value: 'markdown', label: 'Markdown' },
    { value: 'text', label: t('plainText') },
  ];

  return (
    <div className={`relative ${className ?? ''}`}>
      <select
        value={preferences.format}
        onChange={(e) => onChange({ format: e.target.value as OutputRenderFormat })}
        className="appearance-none pl-2 pr-6 py-1 text-xs rounded-md bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 text-slate-300 light:text-slate-700 focus:outline-none focus:border-cyan-500 cursor-pointer"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 light:text-slate-400 pointer-events-none" />
    </div>
  );
}

/**
 * Detect the most appropriate render format for the given content.
 *
 * Priority:
 * 1. Contains markdown fenced code blocks (```) → markdown
 * 2. Looks like an HTML document (<!DOCTYPE or <html) → html
 * 3. Valid JSON (starts with { or [) → json
 * 4. Has markdown syntax features (headings, lists, tables, bold, links) → markdown
 * 5. Fallback → text
 */
function detectFormat(content: string): OutputRenderFormat {
  const trimmed = content.trimStart();

  // 1. Fenced code blocks → markdown
  if (trimmed.includes('```')) {
    return 'markdown';
  }

  // 2. HTML document → html
  const head = trimmed.slice(0, 512).toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || (head.includes('<html') && content.toLowerCase().includes('</html>'))) {
    return 'html';
  }

  // 3. JSON → json
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(content);
      return 'json';
    } catch {
      // Not valid JSON, continue detection
    }
  }

  // 4. Markdown syntax features
  const hasMarkdownSyntax =
    /^#{1,6}\s/m.test(trimmed) ||           // headings
    /^\s*[-*+]\s/m.test(trimmed) ||          // unordered lists
    /^\s*\d+\.\s/m.test(trimmed) ||          // ordered lists
    /\|.*\|.*\|/m.test(trimmed) ||           // tables
    /\*\*.+?\*\*/m.test(trimmed) ||          // bold
    /\[.+?\]\(.+?\)/m.test(trimmed);         // links

  if (hasMarkdownSyntax) {
    return 'markdown';
  }

  // 5. Fallback → text
  return 'text';
}

/**
 * Format JSON string with indentation for display
 */
function formatJson(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}

interface OutputRendererProps {
  content: string;
  preferences: OutputRenderPreferences;
  className?: string;
  isStreaming?: boolean;
}

export function OutputRenderer({ content, preferences, className, isStreaming = false }: OutputRendererProps) {
  const effectiveFormat = preferences.format === 'auto' ? detectFormat(content) : preferences.format;

  // Plain text rendering
  if (effectiveFormat === 'text') {
    return (
      <pre className={`whitespace-pre-wrap break-words font-mono text-slate-300 light:text-slate-700 ${className ?? ''}`}>
        {content}
      </pre>
    );
  }

  // JSON rendering with formatting
  if (effectiveFormat === 'json') {
    const formatted = formatJson(content);
    return (
      <pre className={`whitespace-pre-wrap break-words font-mono text-slate-300 light:text-slate-700 ${className ?? ''}`}>
        {formatted}
      </pre>
    );
  }

  // HTML rendering with preview
  if (effectiveFormat === 'html') {
    return <HtmlArtifactsCard html={content} isStreaming={isStreaming} />;
  }

  // Markdown rendering
  return <MarkdownRenderer content={content} className={className ?? ''} isStreaming={isStreaming} />;
}
