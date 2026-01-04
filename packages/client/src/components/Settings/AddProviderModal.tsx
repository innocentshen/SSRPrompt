import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Sparkles, Cpu, Server, Globe } from 'lucide-react';
import { Modal, Button, Input, Select } from '../ui';
import type { ProviderType } from '../../types';

interface AddProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string, type: ProviderType) => Promise<void>;
}

export function AddProviderModal({ isOpen, onClose, onAdd }: AddProviderModalProps) {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const [name, setName] = useState('');
  const [type, setType] = useState<ProviderType>('openai');
  const [loading, setLoading] = useState(false);

  const providerTypes = [
    { value: 'openai', label: 'OpenAI', icon: Sparkles, color: 'from-emerald-500 to-green-500' },
    { value: 'anthropic', label: 'Anthropic', icon: Bot, color: 'from-amber-500 to-orange-500' },
    { value: 'gemini', label: 'Google Gemini', icon: Cpu, color: 'from-blue-500 to-cyan-500' },
    { value: 'openrouter', label: 'OpenRouter', icon: Globe, color: 'from-purple-500 to-pink-500' },
    { value: 'custom', label: t('customOpenAICompatible'), icon: Server, color: 'from-slate-500 to-slate-600' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onAdd(name.trim(), type);
      setName('');
      setType('openai');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const selectedType = providerTypes.find((t) => t.value === type);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('addProvider')} size="md">
      <form onSubmit={handleSubmit} className="space-y-6">
        <Input
          label={t('providerName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('providerNamePlaceholder')}
          autoFocus
        />

        <div className="space-y-3">
          <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
            {t('providerType')}
          </label>
          <div className="grid grid-cols-1 gap-2">
            {providerTypes.map((providerType) => {
              const Icon = providerType.icon;
              const isSelected = type === providerType.value;
              return (
                <button
                  key={providerType.value}
                  type="button"
                  onClick={() => setType(providerType.value as ProviderType)}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                    isSelected
                      ? 'bg-slate-800 light:bg-cyan-50 border-cyan-500 ring-2 ring-cyan-500/20'
                      : 'border-slate-700 light:border-slate-300 hover:border-slate-600 light:hover:border-slate-400 hover:bg-slate-800/50 light:hover:bg-slate-100'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-lg bg-gradient-to-br ${providerType.color} flex items-center justify-center`}
                  >
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-slate-200 light:text-slate-800">
                      {providerType.label}
                    </p>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border-2 transition-colors ${
                      isSelected
                        ? 'border-cyan-500 bg-cyan-500'
                        : 'border-slate-600 light:border-slate-400'
                    }`}
                  >
                    {isSelected && (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="w-1.5 h-1.5 bg-white rounded-full" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-700 light:border-slate-200">
          <Button type="button" variant="ghost" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={loading} disabled={!name.trim()}>
            {tCommon('add')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
