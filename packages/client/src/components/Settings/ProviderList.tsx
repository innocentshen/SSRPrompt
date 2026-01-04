import { Plus, Bot, Sparkles, Cpu, Server, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types';

interface ProviderListProps {
  providers: Provider[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

const providerIcons: Record<string, typeof Bot> = {
  openai: Sparkles,
  anthropic: Bot,
  gemini: Cpu,
  openrouter: Globe,
  custom: Server,
};

const providerColors: Record<string, string> = {
  openai: 'from-emerald-500 to-green-500',
  anthropic: 'from-amber-500 to-orange-500',
  gemini: 'from-blue-500 to-cyan-500',
  openrouter: 'from-purple-500 to-pink-500',
  custom: 'from-slate-500 to-slate-600',
};

export function ProviderList({ providers, selectedId, onSelect, onAdd }: ProviderListProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="w-64 bg-slate-900/50 light:bg-white border-r border-slate-700 light:border-slate-200 flex flex-col">
      <div className="p-4 border-b border-slate-700 light:border-slate-200">
        <h2 className="text-sm font-semibold text-slate-300 light:text-slate-700">{t('providerList')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {providers.map((provider) => {
          const Icon = providerIcons[provider.type] || Server;
          const isSelected = selectedId === provider.id;
          return (
            <button
              key={provider.id}
              onClick={() => onSelect(provider.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                isSelected
                  ? 'bg-slate-800 light:bg-cyan-50 border border-slate-600 light:border-cyan-200'
                  : 'hover:bg-slate-800/50 light:hover:bg-slate-100'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-lg bg-gradient-to-br ${providerColors[provider.type]} flex items-center justify-center flex-shrink-0`}
              >
                <Icon className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">
                  {provider.name}
                </p>
                <p className="text-xs text-slate-500 light:text-slate-600 capitalize">{provider.type}</p>
              </div>
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  provider.enabled ? 'bg-emerald-500' : 'bg-slate-600 light:bg-slate-400'
                }`}
              />
            </button>
          );
        })}
      </div>

      <div className="p-3 border-t border-slate-700 light:border-slate-200">
        <button
          onClick={onAdd}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 light:bg-white hover:bg-slate-700 light:hover:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-300 light:text-slate-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('addProvider')}</span>
        </button>
      </div>
    </div>
  );
}
