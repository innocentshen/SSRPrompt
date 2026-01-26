import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Download, ExternalLink, Eye, Globe, Loader2, Sparkles } from 'lucide-react';
import { HtmlArtifactsModal } from './HtmlArtifactsModal';

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const raw = match[1]?.trim();
  return raw ? raw.replace(/\s+/g, ' ').slice(0, 80) : null;
}

function toFileName(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  return (base || 'html-artifact') + '.html';
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function openInNewTab(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) return;
  win.document.title = filename;
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

interface HtmlArtifactsCardProps {
  html: string;
  isStreaming?: boolean;
}

export function HtmlArtifactsCard({ html, isStreaming = false }: HtmlArtifactsCardProps) {
  const { t } = useTranslation('common');
  const htmlContent = html || '';
  const title = useMemo(() => extractHtmlTitle(htmlContent) || 'HTML Artifacts', [htmlContent]);
  const [open, setOpen] = useState(false);

  const hasContent = htmlContent.trim().length > 0;

  const tailPreview = useMemo(() => {
    if (!hasContent) return '';
    const lines = htmlContent.trim().split('\n');
    return lines.slice(-3).join('\n');
  }, [hasContent, htmlContent]);

  return (
    <>
      <div className="my-3 border border-slate-700 light:border-slate-200 rounded-xl overflow-hidden bg-slate-900/40 light:bg-white">
        <div className="flex items-center gap-3 px-4 py-4 bg-slate-800/60 light:bg-slate-50 border-b border-slate-700 light:border-slate-200">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
              isStreaming
                ? 'bg-gradient-to-br from-amber-400 to-amber-700 shadow-[0_6px_14px_-8px_rgba(245,158,11,0.65)]'
                : 'bg-gradient-to-br from-sky-400 to-sky-800 shadow-[0_6px_14px_-8px_rgba(56,189,248,0.55)]'
            }`}
          >
            {isStreaming ? <Sparkles className="w-5 h-5 text-white" /> : <Globe className="w-5 h-5 text-white" />}
          </div>

          <div className="min-w-0 flex-1 flex flex-col gap-1">
            <div className="text-sm font-bold text-slate-100 light:text-slate-900 truncate">{title}</div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border border-slate-700 light:border-slate-200 bg-slate-900/50 light:bg-white text-slate-300 light:text-slate-700 w-fit">
              <Code className="w-3 h-3" />
              <span>HTML</span>
            </span>
          </div>
        </div>

        <div className="bg-slate-900/20 light:bg-white">
          {isStreaming && !hasContent ? (
            <div className="flex items-center justify-center gap-2 px-4 py-6">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400 light:text-cyan-600" />
              <span className="text-sm text-slate-400 light:text-slate-600">{t('loading')}</span>
            </div>
          ) : isStreaming && hasContent ? (
            <>
              <div className="m-4 rounded-lg overflow-hidden border border-slate-800 light:border-slate-200 bg-slate-950/70 light:bg-slate-100 font-mono">
                <div className="p-3 text-[13px] leading-relaxed text-slate-200 light:text-slate-800 min-h-[80px]">
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-400 light:text-emerald-700 font-bold flex-shrink-0">$</span>
                    <span className="whitespace-pre-wrap break-words flex-1">
                      {tailPreview}
                      <span className="inline-block w-[2px] h-[14px] bg-emerald-400 light:bg-emerald-700 align-baseline ml-1 animate-cursor-blink" />
                    </span>
                  </div>
                </div>
              </div>

              <div className="px-4 pb-4">
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  disabled={!hasContent}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-cyan-500/20 text-cyan-200 light:bg-cyan-50 light:text-cyan-700 border border-cyan-500/25 light:border-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Eye className="w-4 h-4" />
                  <span>{t('preview')}</span>
                </button>
              </div>
            </>
          ) : (
            <div className="px-3 py-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(true)}
                disabled={!hasContent}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-200 light:text-slate-800 hover:bg-slate-800/60 light:hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Eye className="w-4 h-4 text-slate-400" />
                <span>{t('preview')}</span>
              </button>
              <button
                type="button"
                onClick={() => openInNewTab(toFileName(title), htmlContent)}
                disabled={!hasContent}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-200 light:text-slate-800 hover:bg-slate-800/60 light:hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={t('openExternal')}
              >
                <ExternalLink className="w-4 h-4 text-slate-400" />
                <span>{t('openExternal')}</span>
              </button>
              <button
                type="button"
                onClick={() => downloadTextFile(toFileName(title), htmlContent)}
                disabled={!hasContent}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-200 light:text-slate-800 hover:bg-slate-800/60 light:hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={t('download')}
              >
                <Download className="w-4 h-4 text-slate-400" />
                <span>{t('download')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <HtmlArtifactsModal isOpen={open} title={title} html={htmlContent} onClose={() => setOpen(false)} />
    </>
  );
}

