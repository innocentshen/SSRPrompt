import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ChevronDown, Check, Cpu } from 'lucide-react';
import type { Model, Provider } from '../../types';

interface ModelSelectorProps {
  models: Model[];
  providers: Provider[];
  selectedModelId: string;
  onSelect: (modelId: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

// 供应商图标颜色
const PROVIDER_COLORS: Record<string, string> = {
  openai: 'bg-emerald-500',
  anthropic: 'bg-orange-500',
  gemini: 'bg-blue-500',
  openrouter: 'bg-purple-500',
  custom: 'bg-slate-500',
};

// 供应商显示名称
const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google',
  openrouter: 'OpenRouter',
  custom: 'Custom',
};

export function ModelSelector({
  models,
  providers,
  selectedModelId,
  onSelect,
  disabled = false,
  placeholder,
}: ModelSelectorProps) {
  const { t } = useTranslation('common');
  const actualPlaceholder = placeholder || t('selectModel');
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [openDirection, setOpenDirection] = useState<'up' | 'down'>('down');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 打开时聚焦搜索框
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // 计算下拉框方向
  const calculateDirection = () => {
    if (!containerRef.current) return 'down';

    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const dropdownHeight = 350; // 估算下拉框高度

    // 如果下方空间不够且上方空间更多，则向上展开
    if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
      return 'up';
    }
    return 'down';
  };

  const handleToggle = () => {
    if (disabled) return;

    if (!isOpen) {
      setOpenDirection(calculateDirection());
    }
    setIsOpen(!isOpen);
  };

  // 获取启用的供应商
  const enabledProviders = providers.filter((p) => p.enabled);
  const enabledProviderIds = enabledProviders.map((p) => p.id);

  // 过滤并分组模型
  const filteredModels = models.filter((m) => {
    const matchesSearch = !searchQuery ||
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.model_id.toLowerCase().includes(searchQuery.toLowerCase());
    const hasEnabledProvider = enabledProviderIds.includes(m.provider_id);
    return matchesSearch && hasEnabledProvider;
  });

  // 按供应商分组
  const groupedModels = enabledProviders.reduce((acc, provider) => {
    const providerModels = filteredModels.filter((m) => m.provider_id === provider.id);
    if (providerModels.length > 0) {
      acc.push({
        provider,
        models: providerModels,
      });
    }
    return acc;
  }, [] as { provider: Provider; models: Model[] }[]);

  // 获取当前选中的模型
  const selectedModel = models.find((m) => m.id === selectedModelId);
  const selectedProvider = selectedModel
    ? providers.find((p) => p.id === selectedModel.provider_id)
    : null;

  const handleSelect = (modelId: string) => {
    onSelect(modelId);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div ref={containerRef} className="relative">
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={`
          w-full flex items-center justify-between gap-2 px-3 py-2
          bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg
          text-sm text-left
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-cyan-500 cursor-pointer'}
          transition-colors
        `}
      >
        <div className="flex items-center gap-2 min-w-0">
          {selectedModel && selectedProvider ? (
            <>
              <div className={`w-2 h-2 rounded-full ${PROVIDER_COLORS[selectedProvider.type] || 'bg-slate-500'}`} />
              <span className="text-slate-200 light:text-slate-800 truncate">{selectedModel.name}</span>
            </>
          ) : (
            <>
              <Cpu className="w-4 h-4 text-slate-500" />
              <span className="text-slate-500">{actualPlaceholder}</span>
            </>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* 下拉面板 */}
      {isOpen && (
        <div
          className={`absolute z-50 w-full min-w-[280px] bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg shadow-xl overflow-hidden ${
            openDirection === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {/* 搜索框 */}
          <div className="p-2 border-b border-slate-700 light:border-slate-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('searchModels')}
                className="w-full pl-9 pr-3 py-2 bg-slate-700 light:bg-slate-100 border-0 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
            </div>
          </div>

          {/* 模型列表 */}
          <div className="max-h-[300px] overflow-y-auto">
            {groupedModels.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">
                {searchQuery ? t('noMatchingModels') : t('noAvailableModels')}
              </div>
            ) : (
              groupedModels.map(({ provider, models: providerModels }) => (
                <div key={provider.id}>
                  {/* 供应商标题 */}
                  <div className="px-3 py-2 bg-slate-750 light:bg-slate-50 sticky top-0">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${PROVIDER_COLORS[provider.type] || 'bg-slate-500'}`} />
                      <span className="text-xs font-medium text-slate-400 light:text-slate-600 uppercase tracking-wider">
                        {provider.name || PROVIDER_NAMES[provider.type] || provider.type}
                      </span>
                    </div>
                  </div>
                  {/* 模型列表 */}
                  {providerModels.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => handleSelect(model.id)}
                      className={`
                        w-full flex items-center justify-between gap-2 px-3 py-2 text-left
                        hover:bg-slate-700 light:hover:bg-slate-100 transition-colors
                        ${selectedModelId === model.id ? 'bg-slate-700/50 light:bg-cyan-50' : ''}
                      `}
                    >
                      <span className="text-sm text-slate-200 light:text-slate-800 truncate pl-4">
                        {model.name}
                      </span>
                      {selectedModelId === model.id && (
                        <Check className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
