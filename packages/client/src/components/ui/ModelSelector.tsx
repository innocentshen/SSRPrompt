import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
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

// 渚涘簲鍟嗗浘鏍囬鑹?
const PROVIDER_COLORS: Record<string, string> = {
  openai: 'bg-emerald-500',
  anthropic: 'bg-orange-500',
  gemini: 'bg-blue-500',
  openrouter: 'bg-purple-500',
  custom: 'bg-slate-500',
};

// 渚涘簪鍟嗘樉绀哄悕绉?
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
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [dropdownPosition, setDropdownPosition] = useState<{
    direction: 'up' | 'down';
    top?: number;
    bottom?: number;
    left: number;
    width: number;
  } | null>(null);

  // 鐐瑰嚮澶栭儴鍏抽棴
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;

      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 鎵撳紑鏃惰仛鐒︽悳绱㈡
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // 璁＄畻涓嬫媺妗嗘柟鍚?
  const calculateDirection = useCallback((): 'up' | 'down' => {
    if (!containerRef.current) return 'down';

    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const dropdownHeight = 350; // 浼扮畻涓嬫媺妗嗛珮搴?

    // 濡傛灉涓嬫柟绌洪棿涓嶅涓斾笂鏂圭┖闂存洿澶氾紝鍒欏悜涓婂睍寮€
    if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
      return 'up';
    }
    return 'down';
  }, []);

  const updateDropdownPosition = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const direction = calculateDirection();

    const horizontalPadding = 8;
    const minWidth = 280;
    const width = Math.max(rect.width, minWidth);

    let left = rect.left;
    if (left + width > window.innerWidth - horizontalPadding) {
      left = Math.max(horizontalPadding, window.innerWidth - horizontalPadding - width);
    }
    if (left < horizontalPadding) left = horizontalPadding;

    const offset = 4;

    setDropdownPosition(
      direction === 'down'
        ? { direction, left, width, top: rect.bottom + offset }
        : { direction, left, width, bottom: window.innerHeight - rect.top + offset }
    );
  }, [calculateDirection]);

  const handleToggle = () => {
    if (disabled) return;

    if (!isOpen) {
      updateDropdownPosition();
    }
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    if (!isOpen) {
      setDropdownPosition(null);
      return;
    }

    updateDropdownPosition();

    const handleViewportChange = () => {
      updateDropdownPosition();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [isOpen, updateDropdownPosition]);

  // 鑾峰彇鍚敤鐨勪緵搴斿晢
  const enabledProviders = providers.filter((p) => p.enabled);
  const enabledProviderIds = enabledProviders.map((p) => p.id);

  // 杩囨护骞跺垎缁勬ā鍨?
  const filteredModels = models.filter((m) => {
    const matchesSearch = !searchQuery ||
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.modelId.toLowerCase().includes(searchQuery.toLowerCase());
    const hasEnabledProvider = enabledProviderIds.includes(m.providerId);
    return matchesSearch && hasEnabledProvider;
  });

  // 鎸変緵搴斿晢鍒嗙粍
  const groupedModels = enabledProviders.reduce((acc, provider) => {
    const providerModels = filteredModels.filter((m) => m.providerId === provider.id);
    if (providerModels.length > 0) {
      acc.push({
        provider,
        models: providerModels,
      });
    }
    return acc;
  }, [] as { provider: Provider; models: Model[] }[]);

  // 鑾峰彇褰撳墠閫変腑鐨勬ā鍨?
  const selectedModel = models.find((m) => m.id === selectedModelId);
  const selectedProvider = selectedModel
    ? providers.find((p) => p.id === selectedModel.providerId)
    : null;

  const handleSelect = (modelId: string) => {
    onSelect(modelId);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div ref={containerRef} className="relative">
      {/* 瑙﹀彂鎸夐挳 */}
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

      {/* 涓嬫媺闈㈡澘 */}
      {isOpen && dropdownPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            left: dropdownPosition.left,
            width: dropdownPosition.width,
            top: dropdownPosition.direction === 'down' ? dropdownPosition.top : undefined,
            bottom: dropdownPosition.direction === 'up' ? dropdownPosition.bottom : undefined,
          }}
          className="z-[1000] min-w-[280px] bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg shadow-xl overflow-hidden"
        >
          {/* 鎼滅储妗?*/}
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

          {/* 妯″瀷鍒楄〃 */}
          <div className="max-h-[300px] overflow-y-auto">
            {groupedModels.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">
                {searchQuery ? t('noMatchingModels') : t('noAvailableModels')}
              </div>
            ) : (
              groupedModels.map(({ provider, models: providerModels }) => (
                <div key={provider.id}>
                  {/* 渚涘簪鍟嗘爣棰?*/}
                  <div className="px-3 py-2 bg-slate-750 light:bg-slate-50 sticky top-0">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${PROVIDER_COLORS[provider.type] || 'bg-slate-500'}`} />
                      <span className="text-xs font-medium text-slate-400 light:text-slate-600 uppercase tracking-wider">
                        {provider.name || PROVIDER_NAMES[provider.type] || provider.type}
                      </span>
                    </div>
                  </div>
                  {/* 妯″瀷鍒楄〃 */}
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
        </div>,
        document.body
      )}
    </div>
  );
}
