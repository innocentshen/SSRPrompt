import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check } from 'lucide-react';
import { MarkdownRenderer } from '../ui';
import { AttachmentList } from './AttachmentPreview';
import { ThinkingBlock } from './ThinkingBlock';
import { useToast } from '../../store/useUIStore';
import type { FileAttachment } from '../../lib/ai-service';

export type ChatTranscriptMessage = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  attachments?: FileAttachment[];
  thinking?: string;
  modelId?: string;
  assistantLabel?: string;
};

export interface ChatTranscriptProps {
  messages: ChatTranscriptMessage[];
  assistantLabel: string;
  userLabel?: string;
  onPreviewAttachment?: (attachment: FileAttachment) => void;
  className?: string;
}

function getSystemLabel(lang: string): string {
  if (lang.startsWith('zh')) return '系统';
  if (lang.startsWith('ja')) return 'システム';
  return 'System';
}

export function ChatTranscript({
  messages,
  assistantLabel,
  userLabel,
  onPreviewAttachment,
  className,
}: ChatTranscriptProps) {
  const { showToast } = useToast();
  const { t, i18n } = useTranslation('prompts');
  const { t: tCommon } = useTranslation('common');
  const effectiveUserLabel = userLabel ?? t('userLabel');
  const systemLabel = getSystemLabel(i18n.language);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (messageId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      showToast('error', t('copyFailed'));
    }
  };

  return (
    <div className={className ? `space-y-3 ${className}` : 'space-y-3'}>
      {messages.map((message, index) => {
        const id = message.id || `msg_${index}`;
        const isUser = message.role === 'user';
        const isAssistant = message.role === 'assistant';
        const isSystem = message.role === 'system';

        const wrapperClass = isSystem
          ? 'flex justify-center'
          : isUser
            ? 'flex justify-end'
            : 'flex justify-start';

        const bubbleBase = 'max-w-[85%] px-4 py-3 rounded-2xl border shadow-sm';
        const bubbleClass = isSystem
          ? `${bubbleBase} bg-slate-800/30 light:bg-slate-50 border-slate-700 light:border-slate-200 text-slate-200 light:text-slate-800`
          : isUser
            ? `${bubbleBase} bg-cyan-500/15 light:bg-cyan-50 border-cyan-500/30 light:border-cyan-200 text-slate-100 light:text-slate-900 rounded-br-md`
            : `${bubbleBase} bg-slate-800/50 light:bg-white border-slate-700 light:border-slate-200 text-slate-100 light:text-slate-900 rounded-bl-md`;

        const label = isSystem
          ? systemLabel
          : isUser
            ? effectiveUserLabel
            : (message.assistantLabel || assistantLabel);
        const labelColor = isSystem
          ? 'text-slate-400 light:text-slate-500'
          : isUser
            ? 'text-cyan-300 light:text-cyan-700'
            : 'text-slate-400 light:text-slate-500';

        return (
          <div key={id} className={wrapperClass}>
            <div className={bubbleClass}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className={`text-xs font-medium ${labelColor}`}>{label}</span>
              {!isSystem && (
                  <button
                    type="button"
                    onClick={() => void handleCopy(id, message.content)}
                    className="p-1 rounded hover:bg-slate-700/40 light:hover:bg-slate-100 text-slate-400 light:text-slate-500 hover:text-slate-200 light:hover:text-slate-700 transition-colors"
                    title={tCommon('copy')}
                  >
                    {copiedId === id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>

              {isAssistant && message.thinking && message.thinking.trim() && (
                <div className="mb-2">
                  <ThinkingBlock thinking={message.thinking} defaultExpanded={false} className="mb-0" />
                </div>
              )}

              {message.content ? (
                <MarkdownRenderer content={message.content} />
              ) : (
                <span className="text-sm text-slate-500 light:text-slate-400">{t('empty')}</span>
              )}

              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-2">
                  <AttachmentList
                    attachments={message.attachments}
                    size="sm"
                    maxVisible={8}
                    onPreview={onPreviewAttachment}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
