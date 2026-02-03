import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ZoomIn, ZoomOut, RotateCw, Download, Loader2 } from 'lucide-react';
import type { FileAttachment } from '../../lib/ai-service';
import { isImageFile, isPdfFile, isTextFile, getFileTypeName, getSyntaxLanguage } from '../../lib/file-utils';
import { filesApi } from '../../api/files';
import { Modal } from '../ui';

interface AttachmentModalProps {
  attachment: FileAttachment | null;
  isOpen: boolean;
  onClose: () => void;
  downloadBlob?: (fileId: string, options?: { signal?: AbortSignal }) => Promise<Blob>;
}

export function AttachmentModal({ attachment, isOpen, onClose, downloadBlob }: AttachmentModalProps) {
  const { t } = useTranslation('common');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const fetchBlob = downloadBlob ?? filesApi.downloadBlob;

  const attachmentId = attachment?.fileId;
  const isImage = attachment ? isImageFile(attachment) : false;
  const isPdf = attachment ? isPdfFile(attachment) : false;
  const isText = attachment ? isTextFile(attachment) : false;
  const typeName = attachment ? getFileTypeName(attachment) : '';

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  useEffect(() => {
    if (!isOpen) return;
    if (!attachmentId) return;

    const abortController = new AbortController();
    let urlToRevoke: string | null = null;

    setLoading(true);
    setLoadError(null);
    setTextContent(null);
    setObjectUrl(null);

    (async () => {
      try {
        const blob = await fetchBlob(attachmentId, { signal: abortController.signal });
        if (abortController.signal.aborted) return;

        if (isText) {
          const text = await blob.text();
          setTextContent(text);
          return;
        }

        urlToRevoke = URL.createObjectURL(blob);
        setObjectUrl(urlToRevoke);
      } catch (e) {
        if (abortController.signal.aborted) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      abortController.abort();
      if (urlToRevoke) {
        URL.revokeObjectURL(urlToRevoke);
      }
    };
  }, [attachmentId, fetchBlob, isOpen, isText]);

  // Avoid keeping a revoked blob URL in state between open/close cycles.
  // Otherwise, the next open can briefly render the stale blob URL and trigger net::ERR_FILE_NOT_FOUND.
  useEffect(() => {
    if (isOpen) return;
    setLoading(false);
    setLoadError(null);
    setObjectUrl(null);
    setTextContent(null);
  }, [isOpen]);

  const handleDownload = async () => {
    if (!attachment) return;
    try {
      const blob = await fetchBlob(attachment.fileId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleReset = () => {
    setZoom(1);
    setRotation(0);
  };

  if (!attachment) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        handleReset();
        // Clear the current preview state immediately on close to prevent stale blob URLs on reopen.
        setLoading(false);
        setLoadError(null);
        setObjectUrl(null);
        setTextContent(null);
        onClose();
      }}
      title={attachment.name}
      size="xl"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400 light:text-slate-600">
              {typeName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isImage && (
              <>
                <button
                  onClick={handleZoomOut}
                  className="p-2 rounded-lg bg-slate-800 light:bg-slate-100 hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-600 transition-colors"
                  title={t('zoomOut')}
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-sm text-slate-400 light:text-slate-600 min-w-[50px] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={handleZoomIn}
                  className="p-2 rounded-lg bg-slate-800 light:bg-slate-100 hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-600 transition-colors"
                  title={t('zoomIn')}
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={handleRotate}
                  className="p-2 rounded-lg bg-slate-800 light:bg-slate-100 hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-600 transition-colors"
                  title={t('rotate')}
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              onClick={handleDownload}
              className="p-2 rounded-lg bg-slate-800 light:bg-slate-100 hover:bg-slate-700 light:hover:bg-slate-200 text-slate-400 light:text-slate-600 transition-colors"
              title={t('download')}
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/50 light:bg-slate-50">
          {loading && (
            <div className="p-8 flex items-center justify-center gap-2 text-slate-400 light:text-slate-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">{t('loading')}</span>
            </div>
          )}

          {loadError && (
            <div className="p-6 text-sm text-rose-300 light:text-rose-700">
              {loadError}
            </div>
          )}

          {isImage && !loading && !loadError && objectUrl && (
            <div className="flex items-center justify-center p-4 min-h-[300px]">
              <img
                src={objectUrl}
                alt={attachment.name}
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  transition: 'transform 0.2s ease',
                  maxWidth: '100%',
                  maxHeight: '100%',
                }}
              />
            </div>
          )}

          {isPdf && !loading && !loadError && objectUrl && (
            <div className="h-[60vh]">
              <iframe
                src={objectUrl}
                className="w-full h-full border-0"
                title={attachment.name}
              />
            </div>
          )}

          {isText && !loading && !loadError && textContent !== null && (
            <div className="p-4">
              <pre className="text-sm text-slate-300 light:text-slate-700 whitespace-pre-wrap font-mono overflow-x-auto">
                <code className={`language-${getSyntaxLanguage(attachment)}`}>
                  {textContent}
                </code>
              </pre>
            </div>
          )}

          {!loading && !loadError && !isImage && !isPdf && !isText && (
            <div className="p-8 text-center text-slate-500 light:text-slate-400">
              <p>{t('cannotPreviewFileType')}</p>
              <p className="text-sm mt-2">{t('clickDownloadToGetFile')}</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
