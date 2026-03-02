import { useTranslation } from 'react-i18next';
import { Check, X, Pencil } from 'lucide-react';
import { Button } from '../ui';
import { diffText, type DiffOp } from '../../lib/text-diff';
import { useMemo, useState } from 'react';

interface SuggestionDiffPreviewProps {
  messageTitle: string;
  originalText: string;
  suggestedText: string;
  failReason?: 'no_match' | 'ambiguous_match';
  onApply: () => void;
  onSkip: () => void;
  onManualEdit: (text: string) => void;
}

function DiffDisplay({ ops }: { ops: DiffOp[] }) {
  return (
    <div className="font-mono text-sm whitespace-pre-wrap break-words leading-relaxed">
      {ops.map((op, i) => {
        if (op.type === 'equal') {
          return (
            <span key={i} className="text-slate-300 light:text-slate-700">
              {op.value}
            </span>
          );
        }
        if (op.type === 'delete') {
          return (
            <span
              key={i}
              className="bg-red-500/20 text-red-300 light:bg-red-100 light:text-red-700 line-through"
            >
              {op.value}
            </span>
          );
        }
        // insert
        return (
          <span
            key={i}
            className="bg-green-500/20 text-green-300 light:bg-green-100 light:text-green-700"
          >
            {op.value}
          </span>
        );
      })}
    </div>
  );
}

export function SuggestionDiffPreview({
  messageTitle,
  originalText,
  suggestedText,
  failReason,
  onApply,
  onSkip,
  onManualEdit,
}: SuggestionDiffPreviewProps) {
  const { t } = useTranslation('prompts');
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(suggestedText);

  const diffOps = useMemo(() => diffText(originalText, suggestedText), [originalText, suggestedText]);

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 light:bg-amber-50 p-4">
      {/* Header with failure reason */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-amber-400 light:text-amber-700">
            {failReason === 'ambiguous_match'
              ? t('ambiguousMatch', { defaultValue: 'Ambiguous Match - Multiple occurrences found' })
              : t('noMatchFound', { defaultValue: 'No Match Found - Text not found in prompt' })}
          </span>
        </div>
        <span className="text-xs text-slate-500">{messageTitle}</span>
      </div>

      {/* Diff Preview */}
      <div className="mb-3 p-3 bg-slate-800/50 light:bg-white rounded-lg border border-slate-700 light:border-slate-200">
        <div className="text-xs text-slate-500 mb-2">
          {t('diffPreview', { defaultValue: 'Diff Preview' })}
        </div>
        <DiffDisplay ops={diffOps} />
      </div>

      {/* Manual edit mode */}
      {isEditing && (
        <div className="mb-3">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full p-3 text-sm bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-y min-h-[80px]"
            rows={4}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={onSkip}
          className="text-xs text-slate-400"
        >
          <X className="w-3 h-3 mr-1" />
          {t('skip', { defaultValue: 'Skip' })}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (isEditing) {
              onManualEdit(editText);
              setIsEditing(false);
            } else {
              setIsEditing(true);
            }
          }}
          className="text-xs text-amber-400"
        >
          <Pencil className="w-3 h-3 mr-1" />
          {isEditing
            ? t('confirmEdit', { defaultValue: 'Confirm Edit' })
            : t('manualEdit', { defaultValue: 'Manual Edit' })}
        </Button>
        {!isEditing && (
          <Button
            variant="primary"
            size="sm"
            onClick={onApply}
            className="text-xs"
          >
            <Check className="w-3 h-3 mr-1" />
            {t('forceApply', { defaultValue: 'Force Apply' })}
          </Button>
        )}
      </div>
    </div>
  );
}
