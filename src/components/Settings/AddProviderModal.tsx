import { useState } from 'react';
import { Cloud, Bot, Sparkles, Cpu, Server } from 'lucide-react';
import { Modal, Button, Input, Select } from '../ui';
import type { ProviderType } from '../../types';

interface AddProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string, type: ProviderType) => Promise<void>;
}

const providerTypes = [
  { value: 'openai', label: 'OpenAI', icon: Sparkles, color: 'from-emerald-500 to-green-500' },
  { value: 'anthropic', label: 'Anthropic', icon: Bot, color: 'from-amber-500 to-orange-500' },
  { value: 'gemini', label: 'Google Gemini', icon: Cpu, color: 'from-blue-500 to-cyan-500' },
  { value: 'azure', label: 'Azure OpenAI', icon: Cloud, color: 'from-sky-500 to-blue-500' },
  { value: 'custom', label: '自定义 (OpenAI 兼容)', icon: Server, color: 'from-slate-500 to-slate-600' },
];

export function AddProviderModal({ isOpen, onClose, onAdd }: AddProviderModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ProviderType>('openai');
  const [loading, setLoading] = useState(false);

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
    <Modal isOpen={isOpen} onClose={onClose} title="添加服务商" size="md">
      <form onSubmit={handleSubmit} className="space-y-6">
        <Input
          label="服务商名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="给服务商起个名字，如：我的 OpenAI"
          autoFocus
        />

        <div className="space-y-3">
          <label className="block text-sm font-medium text-slate-300">
            服务商类型
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
                      ? 'bg-slate-800 border-cyan-500 ring-2 ring-cyan-500/20'
                      : 'border-slate-700 hover:border-slate-600 hover:bg-slate-800/50'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-lg bg-gradient-to-br ${providerType.color} flex items-center justify-center`}
                  >
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-slate-200">
                      {providerType.label}
                    </p>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border-2 transition-colors ${
                      isSelected
                        ? 'border-cyan-500 bg-cyan-500'
                        : 'border-slate-600'
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

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={loading} disabled={!name.trim()}>
            添加
          </Button>
        </div>
      </form>
    </Modal>
  );
}
