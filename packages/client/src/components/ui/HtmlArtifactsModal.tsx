import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Eye, Maximize2, Minimize2, SplitSquareHorizontal, X, Copy, Download } from 'lucide-react';

type ViewMode = 'split' | 'code' | 'preview';

const STORAGE_KEY = 'ssrprompt_html_artifacts_view_mode';

function loadViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'split' || stored === 'code' || stored === 'preview') return stored;
  } catch {
    // ignore
  }
  return 'split';
}

function saveViewMode(mode: ViewMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
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

interface HtmlArtifactsModalProps {
  isOpen: boolean;
  title: string;
  html: string;
  onClose: () => void;
}

export function HtmlArtifactsModal({ isOpen, title, html, onClose }: HtmlArtifactsModalProps) {
  const { t } = useTranslation('common');
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode());
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [splitPercent, setSplitPercent] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    saveViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(html);
    } catch {
      // ignore
    }
  }, [html]);

  const onDownload = useCallback(() => {
    downloadTextFile(toFileName(title), html);
  }, [html, title]);

  const onStartDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!containerRef.current) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
  };

  const onDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDragging) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(20, Math.min(80, (x / rect.width) * 100));
    setSplitPercent(pct);
  };

  const onEndDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDragging) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setIsDragging(false);
  };

  const previewKey = useMemo(() => html, [html]);

  if (!isOpen) return null;

  const overlayPadding = isFullscreen ? 'p-0' : 'p-6';
  const panelRadius = isFullscreen ? 'rounded-none' : 'rounded-2xl';
  const panelSize = isFullscreen ? 'w-screen h-screen' : 'w-[92vw] max-w-[1400px] h-[86vh]';

  const viewButtonClass = (active: boolean) =>
    `inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors border ${
      active
        ? 'bg-cyan-500/15 text-cyan-200 border-cyan-500/30'
        : 'bg-slate-800/50 text-slate-300 border-slate-700 hover:bg-slate-800 hover:text-white'
    } light:${active ? 'bg-cyan-50 text-cyan-700 border-cyan-200' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`;

  return (
    <div className={`fixed inset-0 z-[100] ${overlayPadding}`}>
      <div
        className="absolute inset-0 bg-black/70 light:bg-black/40 backdrop-blur-sm"
        onClick={isFullscreen ? undefined : onClose}
      />

      <div
        className={`relative ${panelSize} ${panelRadius} bg-slate-900 light:bg-white border border-slate-700 light:border-slate-200 shadow-2xl overflow-hidden`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 light:border-slate-200">
          <div className="min-w-0 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-sky-500/80 flex-shrink-0" />
            <h3 className="text-sm font-semibold text-slate-100 light:text-slate-900 truncate">{title}</h3>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <button type="button" className={viewButtonClass(viewMode === 'split')} onClick={() => setViewMode('split')}>
              <SplitSquareHorizontal className="w-4 h-4" />
              <span>{t('split') ?? 'Split'}</span>
            </button>
            <button type="button" className={viewButtonClass(viewMode === 'code')} onClick={() => setViewMode('code')}>
              <Code className="w-4 h-4" />
              <span>{t('source')}</span>
            </button>
            <button type="button" className={viewButtonClass(viewMode === 'preview')} onClick={() => setViewMode('preview')}>
              <Eye className="w-4 h-4" />
              <span>{t('preview')}</span>
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void onCopy()}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/70 light:text-slate-500 light:hover:text-slate-900 light:hover:bg-slate-100 transition-colors"
              title={t('copy')}
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onDownload}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/70 light:text-slate-500 light:hover:text-slate-900 light:hover:bg-slate-100 transition-colors"
              title={t('download')}
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsFullscreen((v) => !v)}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/70 light:text-slate-500 light:hover:text-slate-900 light:hover:bg-slate-100 transition-colors"
              title={isFullscreen ? t('collapse') : t('expand')}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/70 light:text-slate-500 light:hover:text-slate-900 light:hover:bg-slate-100 transition-colors"
              title={t('close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="md:hidden px-4 py-2 border-b border-slate-800 light:border-slate-100 bg-slate-900/50 light:bg-white">
          <div className="flex items-center gap-2">
            <button type="button" className={viewButtonClass(viewMode === 'split')} onClick={() => setViewMode('split')}>
              <SplitSquareHorizontal className="w-4 h-4" />
              <span>{t('split') ?? 'Split'}</span>
            </button>
            <button type="button" className={viewButtonClass(viewMode === 'code')} onClick={() => setViewMode('code')}>
              <Code className="w-4 h-4" />
              <span>{t('source')}</span>
            </button>
            <button type="button" className={viewButtonClass(viewMode === 'preview')} onClick={() => setViewMode('preview')}>
              <Eye className="w-4 h-4" />
              <span>{t('preview')}</span>
            </button>
          </div>
        </div>

        <div className="h-[calc(100%-52px)] md:h-[calc(100%-56px)] min-h-0">
          {viewMode === 'split' ? (
            <div ref={containerRef} className="h-full w-full flex min-h-0">
              <div
                className="h-full min-h-0 overflow-hidden"
                style={{ width: `${splitPercent}%` }}
              >
                <div className="h-full min-h-0 bg-slate-950 light:bg-slate-50 border-r border-slate-800 light:border-slate-200">
                  <pre className="h-full overflow-auto p-4 text-xs leading-relaxed text-slate-200 light:text-slate-800 whitespace-pre">
                    {html}
                  </pre>
                </div>
              </div>

              <button
                type="button"
                onPointerDown={onStartDrag}
                onPointerMove={onDrag}
                onPointerUp={onEndDrag}
                onPointerCancel={onEndDrag}
                className="w-2 cursor-col-resize bg-slate-900 light:bg-white hover:bg-slate-800 light:hover:bg-slate-100 transition-colors"
                aria-label="Resize"
                title="Resize"
              />

              <div className="flex-1 min-w-0 h-full min-h-0 overflow-hidden bg-white">
                <iframe
                  key={previewKey}
                  title={t('preview')}
                  srcDoc={html}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  className="w-full h-full border-0 bg-white"
                />
              </div>
            </div>
          ) : viewMode === 'code' ? (
            <div className="h-full min-h-0 bg-slate-950 light:bg-slate-50">
              <pre className="h-full overflow-auto p-4 text-xs leading-relaxed text-slate-200 light:text-slate-800 whitespace-pre">
                {html}
              </pre>
            </div>
          ) : (
            <div className="h-full min-h-0 bg-white">
              <iframe
                key={previewKey}
                title={t('preview')}
                srcDoc={html}
                sandbox="allow-scripts allow-same-origin allow-forms"
                className="w-full h-full border-0 bg-white"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
