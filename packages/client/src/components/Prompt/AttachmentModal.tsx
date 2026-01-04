import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ZoomIn, ZoomOut, RotateCw, Download } from 'lucide-react';
import type { FileAttachment } from '../../lib/ai-service';
import { isImageFile, isPdfFile, isTextFile, readTextContent, getFileTypeName, getSyntaxLanguage } from '../../lib/file-utils';
import { Modal } from '../ui';

interface AttachmentModalProps {
  attachment: FileAttachment | null;
  isOpen: boolean;
  onClose: () => void;
}

export function AttachmentModal({ attachment, isOpen, onClose }: AttachmentModalProps) {
  const { t } = useTranslation('common');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  if (!attachment) return null;

  const isImage = isImageFile(attachment);
  const isPdf = isPdfFile(attachment);
  const isText = isTextFile(attachment);
  const typeName = getFileTypeName(attachment);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = `data:${attachment.type};base64,${attachment.base64}`;
    link.download = attachment.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleReset = () => {
    setZoom(1);
    setRotation(0);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        handleReset();
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
          {isImage && (
            <div className="flex items-center justify-center p-4 min-h-[300px]">
              <img
                src={`data:${attachment.type};base64,${attachment.base64}`}
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

          {isPdf && (
            <div className="h-[60vh]">
              <iframe
                src={`data:application/pdf;base64,${attachment.base64}`}
                className="w-full h-full border-0"
                title={attachment.name}
              />
            </div>
          )}

          {isText && (
            <div className="p-4">
              <pre className="text-sm text-slate-300 light:text-slate-700 whitespace-pre-wrap font-mono overflow-x-auto">
                <code className={`language-${getSyntaxLanguage(attachment)}`}>
                  {readTextContent(attachment.base64)}
                </code>
              </pre>
            </div>
          )}

          {!isImage && !isPdf && !isText && (
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
