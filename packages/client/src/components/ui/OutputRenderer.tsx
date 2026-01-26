import { useTranslation } from 'react-i18next';
import type { OutputRenderFormat, OutputRenderPreferences } from '../../lib/output-renderer-prefs';
import { MarkdownRenderer } from './MarkdownRenderer';

interface OutputRendererControlsProps {
  preferences: OutputRenderPreferences;
  onChange: (next: OutputRenderPreferences) => void;
  className?: string;
}

function buttonClass(active: boolean): string {
  return `px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
    active
      ? 'bg-cyan-500/20 text-cyan-300 light:bg-cyan-50 light:text-cyan-700'
      : 'text-slate-400 light:text-slate-600 hover:text-slate-200 light:hover:text-slate-900 hover:bg-slate-800/60 light:hover:bg-white'
  }`;
}

export function OutputRendererControls({ preferences, onChange, className }: OutputRendererControlsProps) {
  const { t } = useTranslation('common');

  const setFormat = (format: OutputRenderFormat) => {
    onChange({ format });
  };

  return (
    <div className={className ? `inline-flex items-center gap-1 p-1 rounded-lg bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 ${className}` : 'inline-flex items-center gap-1 p-1 rounded-lg bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200'}>
      <button type="button" onClick={() => setFormat('markdown')} className={buttonClass(preferences.format === 'markdown')}>
        {t('markdown')}
      </button>
      <button type="button" onClick={() => setFormat('text')} className={buttonClass(preferences.format === 'text')}>
        {t('plainText')}
      </button>
    </div>
  );
}

interface OutputRendererProps {
  content: string;
  preferences: OutputRenderPreferences;
  className?: string;
  isStreaming?: boolean;
}

export function OutputRenderer({ content, preferences, className, isStreaming = false }: OutputRendererProps) {
  if (preferences.format === 'text') {
    return (
      <pre className={className ? `whitespace-pre-wrap break-words font-mono ${className}` : 'whitespace-pre-wrap break-words font-mono'}>
        {content}
      </pre>
    );
  }

  return <MarkdownRenderer content={content} className={className ?? ''} isStreaming={isStreaming} />;
}
