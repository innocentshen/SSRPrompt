import { Image, FileText, File, Code, FileType } from 'lucide-react';
import type { FileAttachment } from '../../lib/ai-service';
import { isImageFile, isPdfFile, getFileIconType, getFileTypeName } from '../../lib/file-utils';

interface AttachmentPreviewProps {
  attachment: FileAttachment;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  showName?: boolean;
}

const SIZE_CLASSES = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-20 h-20',
};

const ICON_SIZE_CLASSES = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
};

function getIconComponent(type: 'image' | 'pdf' | 'code' | 'text' | 'file') {
  switch (type) {
    case 'image':
      return Image;
    case 'pdf':
      return FileType;
    case 'code':
      return Code;
    case 'text':
      return FileText;
    default:
      return File;
  }
}

function getIconColorClass(type: 'image' | 'pdf' | 'code' | 'text' | 'file') {
  switch (type) {
    case 'image':
      return 'bg-emerald-500/10 text-emerald-400 light:bg-emerald-100 light:text-emerald-600';
    case 'pdf':
      return 'bg-red-500/10 text-red-400 light:bg-red-100 light:text-red-600';
    case 'code':
      return 'bg-amber-500/10 text-amber-400 light:bg-amber-100 light:text-amber-600';
    case 'text':
      return 'bg-blue-500/10 text-blue-400 light:bg-blue-100 light:text-blue-600';
    default:
      return 'bg-slate-500/10 text-slate-400 light:bg-slate-100 light:text-slate-600';
  }
}

export function AttachmentPreview({
  attachment,
  size = 'md',
  onClick,
  showName = false,
}: AttachmentPreviewProps) {
  const isImage = isImageFile(attachment);
  const iconType = getFileIconType(attachment);
  const Icon = getIconComponent(iconType);
  const typeName = getFileTypeName(attachment);

  const containerClass = `
    ${SIZE_CLASSES[size]}
    rounded-lg overflow-hidden
    ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-cyan-500/50 transition-all' : ''}
  `.trim();

  const handleClick = () => {
    if (onClick) {
      onClick();
    }
  };

  if (isImage) {
    return (
      <div className={showName ? 'flex flex-col items-center gap-1' : ''}>
        <div className={containerClass} onClick={handleClick}>
          <img
            src={`data:${attachment.type};base64,${attachment.base64}`}
            alt={attachment.name}
            className="w-full h-full object-cover"
          />
        </div>
        {showName && (
          <span className="text-xs text-slate-500 light:text-slate-600 max-w-[80px] truncate text-center">
            {attachment.name}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={showName ? 'flex flex-col items-center gap-1' : ''}>
      <div
        className={`${containerClass} ${getIconColorClass(iconType)} flex items-center justify-center`}
        onClick={handleClick}
        title={`${typeName}: ${attachment.name}`}
      >
        <Icon className={ICON_SIZE_CLASSES[size]} />
      </div>
      {showName && (
        <span className="text-xs text-slate-500 light:text-slate-600 max-w-[80px] truncate text-center">
          {attachment.name}
        </span>
      )}
    </div>
  );
}

// 附件列表组件 - 用于展示多个附件
interface AttachmentListProps {
  attachments: FileAttachment[];
  size?: 'sm' | 'md' | 'lg';
  maxVisible?: number;
  onPreview?: (attachment: FileAttachment) => void;
}

export function AttachmentList({
  attachments,
  size = 'sm',
  maxVisible = 3,
  onPreview,
}: AttachmentListProps) {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  const visibleAttachments = attachments.slice(0, maxVisible);
  const remainingCount = attachments.length - maxVisible;

  return (
    <div className="flex items-center gap-1">
      {visibleAttachments.map((attachment, index) => (
        <AttachmentPreview
          key={index}
          attachment={attachment}
          size={size}
          onClick={onPreview ? () => onPreview(attachment) : undefined}
        />
      ))}
      {remainingCount > 0 && (
        <div className={`${SIZE_CLASSES[size]} rounded-lg bg-slate-700 light:bg-slate-200 flex items-center justify-center`}>
          <span className="text-xs text-slate-400 light:text-slate-600 font-medium">
            +{remainingCount}
          </span>
        </div>
      )}
    </div>
  );
}
