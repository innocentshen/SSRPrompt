import { Brain } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReasoningEffort } from '../../types/database';
import { inferReasoningSupport } from '../../lib/model-capabilities';

interface ReasoningSelectorProps {
  value: ReasoningEffort;
  onChange: (effort: ReasoningEffort) => void;
  modelId: string;
  disabled?: boolean;
}

const EFFORT_OPTIONS: { value: ReasoningEffort; labelKey: string; descKey: string }[] = [
  { value: 'default', labelKey: 'reasoningDefault', descKey: 'reasoningDefaultDesc' },
  { value: 'none', labelKey: 'reasoningNone', descKey: 'reasoningNoneDesc' },
  { value: 'low', labelKey: 'reasoningLow', descKey: 'reasoningLowDesc' },
  { value: 'medium', labelKey: 'reasoningMedium', descKey: 'reasoningMediumDesc' },
  { value: 'high', labelKey: 'reasoningHigh', descKey: 'reasoningHighDesc' },
];

export function ReasoningSelector({
  value,
  onChange,
  modelId,
  disabled,
}: ReasoningSelectorProps) {
  const { t } = useTranslation('common');
  const supportsReasoning = inferReasoningSupport(modelId);

  if (!supportsReasoning) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <Brain className="w-4 h-4 text-purple-400" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ReasoningEffort)}
        disabled={disabled}
        className="px-2 py-1 text-sm bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50"
        title={t('reasoningEffort')}
      >
        {EFFORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {t(opt.labelKey)}
          </option>
        ))}
      </select>
    </div>
  );
}
