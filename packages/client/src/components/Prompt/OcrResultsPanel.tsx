import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Copy, Loader2, Maximize2, ScanText } from 'lucide-react';
import { Badge, Modal } from '../ui';
import { Collapsible } from '../ui/Collapsible';
import { ocrApi } from '../../api/ocr';
import type { FileAttachment, OcrProvider, OcrResultItem } from '../../types';

interface OcrResultsPanelProps {
  attachments: FileAttachment[];
  provider?: OcrProvider | null;
  defaultOpen?: boolean;
  heightClassName?: string;
}

function isOcrEligible(file: FileAttachment): boolean {
  return file.type.startsWith('image/') || file.type === 'application/pdf';
}

function providerLabel(provider?: string | null): string {
  if (!provider) return '';
  switch (provider) {
    case 'paddle':
      return 'PaddleOCR';
    case 'paddle_vl':
      return 'PaddleOCR-VL';
    case 'paddle_vl_1_5':
      return 'PaddleOCR-VL-1.5';
    case 'datalab':
      return 'Datalab';
    case 'mineru':
      return 'MinerU';
    default:
      return provider;
  }
}

export function OcrResultsPanel({ attachments, provider, defaultOpen = true, heightClassName }: OcrResultsPanelProps) {
  const { t } = useTranslation('common');
  const [results, setResults] = useState<OcrResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [expandedOcr, setExpandedOcr] = useState<{ title: string; text: string } | null>(null);

  const ocrAttachments = useMemo(() => attachments.filter(isOcrEligible), [attachments]);
  const fileIds = useMemo(
    () => Array.from(new Set(ocrAttachments.map((file) => file.fileId))),
    [ocrAttachments]
  );
  const hasFixedHeight = Boolean(heightClassName);
  const containerClassName = hasFixedHeight ? `flex flex-col ${heightClassName}` : undefined;
  const contentClassName = hasFixedHeight ? 'flex-1 min-h-0 overflow-y-auto' : undefined;

  useEffect(() => {
    if (fileIds.length === 0) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    ocrApi
      .getResults({ fileIds, provider: provider || undefined })
      .then((data) => {
        if (!active) return;
        setResults(data);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message || t('ocrResultsError'));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [fileIds, provider, t]);

  const resultsByFile = useMemo(() => {
    const map = new Map<string, OcrResultItem[]>();
    for (const item of results) {
      const list = map.get(item.fileId) || [];
      list.push(item);
      map.set(item.fileId, list);
    }
    return map;
  }, [results]);

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Ignore copy errors.
    }
  };

  if (ocrAttachments.length === 0) {
    return null;
  }

  return (
    <Collapsible
      title={t('ocrResults')}
      defaultOpen={defaultOpen}
      icon={<ScanText className="w-4 h-4 text-slate-400" />}
      action={provider ? <span className="text-xs text-slate-500 light:text-slate-600">{providerLabel(provider)}</span> : null}
      className={containerClassName}
      contentClassName={contentClassName}
    >
      <div className="space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-slate-500 light:text-slate-600 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{t('ocrResultsLoading')}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-rose-400 light:text-rose-600 text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-3">
            {ocrAttachments.map((file) => {
              const items = resultsByFile.get(file.fileId) || [];
              return (
                <div
                  key={file.fileId}
                  className="p-3 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-200 light:text-slate-800 truncate">{file.name}</span>
                    {items.length === 0 && (
                      <span className="text-xs text-slate-500 light:text-slate-600">
                        {t('ocrResultsMissing')}
                      </span>
                    )}
                  </div>

                  {items.map((item) => {
                    const copyKey = `${item.fileId}_${item.provider}`;
                    const isSuccess = item.status === 'success';
                    return (
                      <div key={copyKey} className="mt-2 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs text-slate-500 light:text-slate-600">
                            <span>{providerLabel(item.provider)}</span>
                            <Badge variant={isSuccess ? 'success' : 'error'}>
                              {isSuccess ? t('success') : t('ocrResultsFailed')}
                            </Badge>
                          </div>
                          {isSuccess && item.fullText && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedOcr({
                                    title: `${file.name} - ${providerLabel(item.provider)}`,
                                    text: item.fullText || '',
                                  })
                                }
                                className="p-1 text-slate-400 hover:text-cyan-400 transition-colors"
                                title={t('expand')}
                              >
                                <Maximize2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCopy(item.fullText, copyKey)}
                                className="p-1 text-slate-400 hover:text-cyan-400 transition-colors"
                                title={t('copy')}
                              >
                                {copiedKey === copyKey ? (
                                  <Check className="w-3.5 h-3.5" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          )}
                        </div>

                        {isSuccess ? (
                          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-slate-300 light:text-slate-700">
                            {item.fullText || t('ocrResultsEmpty')}
                          </pre>
                        ) : (
                          <div className="text-xs text-rose-400 light:text-rose-600">
                            {item.errorMessage || t('ocrResultsFailed')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Modal
        isOpen={!!expandedOcr}
        onClose={() => setExpandedOcr(null)}
        title={expandedOcr?.title || t('ocrResults')}
        size="xl"
      >
        <div className="p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg max-h-[60vh] overflow-y-auto">
          <pre className="whitespace-pre-wrap font-mono text-xs text-slate-300 light:text-slate-700">
            {expandedOcr?.text || t('ocrResultsEmpty')}
          </pre>
        </div>
      </Modal>
    </Collapsible>
  );
}
