import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Eye,
  EyeOff,
  Check,
  X,
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Brain,
  Wrench,
} from 'lucide-react';
import { Button, Input, Select, Toggle, Modal, useToast } from '../ui';
import type { Provider, Model, ProviderType } from '../../types';
import { inferVisionSupport, inferReasoningSupport, inferFunctionCallingSupport } from '../../lib/model-capabilities';
import { providersApi } from '../../api';

interface FetchedModel {
  id: string;
  name: string;
  owned_by?: string;
  maxContextLength?: number;
}

interface ProviderFormProps {
  provider: Provider | null;
  models: Model[];
  onSave: (data: Partial<Provider>) => Promise<void>;
  onDelete: () => Promise<void>;
  onAddModel: (modelId: string, name: string, options?: { supportsVision?: boolean; maxContextLength?: number }) => Promise<void>;
  onRemoveModel: (modelId: string) => Promise<void>;
  onToggleVision?: (modelId: string, enabled: boolean) => Promise<void>;
  onTestConnection: (apiKey: string, baseUrl: string, type: ProviderType) => Promise<boolean>;
}

const providerTypesStatic = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'custom', label: '', isCustom: true },
];

const defaultBaseUrls: Record<ProviderType, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  openrouter: 'https://openrouter.ai/api',
  custom: '',
};

export function ProviderForm({
  provider,
  models,
  onSave,
  onDelete,
  onAddModel,
  onRemoveModel,
  onToggleVision,
  onTestConnection,
}: ProviderFormProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ProviderType>('openai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [saving, setSaving] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [newModelMaxContextLength, setNewModelMaxContextLength] = useState('8000');
  const [newModelSupportsVision, setNewModelSupportsVision] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [selectedFetchedModels, setSelectedFetchedModels] = useState<Set<string>>(new Set());
  const [modelFilter, setModelFilter] = useState('');
  const { showToast } = useToast();
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const filteredModels = useMemo(() => {
    const query = newModelId.trim().toLowerCase();
    if (!query) return models;
    return models.filter((model) => {
      const modelName = model.name?.toLowerCase() ?? '';
      const modelId = model.modelId?.toLowerCase() ?? '';
      return modelId.includes(query) || modelName.includes(query);
    });
  }, [models, newModelId]);

  const providerTypes = providerTypesStatic.map(p => ({
    value: p.value,
    label: p.isCustom ? t('customOpenAICompatible') : p.label
  }));

  useEffect(() => {
    if (provider) {
      setName(provider.name);
      setType(provider.type);
      // Never re-hydrate the stored API key back into the input.
      // Backend returns a masked value (e.g. "sk-xxxx...") for security; sending it back would overwrite the real key.
      setApiKey('');
      setBaseUrl(provider.baseUrl || '');
      setEnabled(provider.enabled);
    } else {
      setName('');
      setType('openai');
      setApiKey('');
      setBaseUrl('');
      setEnabled(false);
    }
    setShowApiKey(false);
    setTestResult(null);
  }, [provider]);

  const handleTypeChange = (newType: ProviderType) => {
    setType(newType);
    if (!baseUrl || Object.values(defaultBaseUrls).includes(baseUrl)) {
      setBaseUrl(defaultBaseUrls[newType]);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const effectiveBaseUrl = baseUrl || defaultBaseUrls[type];
      const success = await onTestConnection(apiKey, effectiveBaseUrl, type);
      setTestResult(success ? 'success' : 'error');
    } catch {
      setTestResult('error');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const trimmedApiKey = apiKey.trim();
      await onSave({
        name,
        type,
        ...(trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
        baseUrl: baseUrl || null,
        enabled,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddModel = async () => {
    if (!newModelId.trim()) return;
    const parsedMaxContext = Number.parseInt(newModelMaxContextLength, 10);
    await onAddModel(newModelId.trim(), newModelName.trim() || newModelId.trim(), {
      supportsVision: newModelSupportsVision,
      maxContextLength: Number.isFinite(parsedMaxContext) ? parsedMaxContext : undefined,
    });
    setNewModelId('');
    setNewModelName('');
    setNewModelMaxContextLength('8000');
    setNewModelSupportsVision(false);
  };

  const handleFetchModels = async () => {
    if (!provider) return;
    if (type === 'anthropic') {
      showToast('info', t('anthropicNoAutoFetch'));
      return;
    }

    setFetchingModels(true);
    try {
      const effectiveBaseUrl = baseUrl || defaultBaseUrls[type];
      const modelList = await providersApi.discoverModels(provider.id, {
        type,
        ...(effectiveBaseUrl ? { baseUrl: effectiveBaseUrl } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });

      const existingModelIds = new Set(models.map(m => m.modelId));
      const newModels = modelList.filter(m => !existingModelIds.has(m.id));

      if (newModels.length === 0) {
        showToast('info', t('noNewModelsFound'));
        setFetchingModels(false);
        return;
      }

      newModels.sort((a, b) => a.id.localeCompare(b.id));
      setFetchedModels(newModels);
      setSelectedFetchedModels(new Set());
      setShowModelPicker(true);
      showToast('success', t('foundModelsCount', { count: newModels.length }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error';
      showToast('error', t('fetchModelsFailed') + ': ' + message);
    } finally {
      setFetchingModels(false);
    }
  };

  const toggleModelSelection = (modelId: string) => {
    setSelectedFetchedModels(prev => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const handleAddSelectedModels = async () => {
    const modelsToAdd = fetchedModels.filter(m => selectedFetchedModels.has(m.id));
    for (const model of modelsToAdd) {
      await onAddModel(model.id, model.name, {
        supportsVision: inferVisionSupport(model.id),
        maxContextLength: model.maxContextLength ?? 8000,
      });
    }
    setShowModelPicker(false);
    setSelectedFetchedModels(new Set());
    showToast('success', t('modelsAddedCount', { count: modelsToAdd.length }));
  };

  if (!provider) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800 light:bg-slate-200 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-slate-600 light:text-slate-400" />
          </div>
          <p className="text-slate-500 light:text-slate-600">{t('selectProviderToConfigure')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white light:text-slate-900">{t('providerConfig')}</h2>
          <Toggle enabled={enabled} onChange={setEnabled} label={t('enable')} />
        </div>

        <div className="space-y-5">
          <Input
            label={t('providerName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('providerNamePlaceholder')}
          />

          <Select
            label={t('providerType')}
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as ProviderType)}
            options={providerTypes}
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
              API Key
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                 <input
                   type={showApiKey ? 'text' : 'password'}
                   value={apiKey}
                   onChange={(e) => setApiKey(e.target.value)}
                   placeholder={provider?.apiKey ? provider.apiKey : 'sk-...'}
                   className="w-full px-3 py-2 pr-10 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                 />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 light:text-slate-400 hover:text-slate-300 light:hover:text-slate-600"
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button
                variant="secondary"
                onClick={handleTest}
                disabled={!apiKey || testing}
              >
                {testing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : testResult === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : testResult === 'error' ? (
                  <X className="w-4 h-4 text-rose-500" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>{t('test')}</span>
              </Button>
            </div>
            <p className="text-xs text-slate-500 light:text-slate-600">
              {t('apiKeyHint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <Input
              label={t('apiAddress')}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={defaultBaseUrls[type] || 'https://api.example.com'}
              hint={
                type === 'custom'
                  ? t('customBaseUrlHint')
                  : t('defaultBaseUrlHint')
              }
            />
          </div>
        </div>

        <div className="border-t border-slate-700 light:border-slate-200 pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-white light:text-slate-900">{t('modelManagement')}</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleFetchModels}
              loading={fetchingModels}
              disabled={fetchingModels}
            >
              <RefreshCw className={`w-4 h-4 ${fetchingModels ? 'animate-spin' : ''}`} />
              <span>{t('autoFetch')}</span>
            </Button>
          </div>

            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder={t('modelIdPlaceholder')}
                  value={newModelId}
                  onChange={(e) => setNewModelId(e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder={t('displayNamePlaceholder')}
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder={t('maxContextLengthPlaceholder')}
                  value={newModelMaxContextLength}
                  onChange={(e) => setNewModelMaxContextLength(e.target.value)}
                  className="w-40"
                  type="number"
                  min={256}
                  title={t('maxContextLength')}
                />
                <label
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 text-sm text-slate-200 light:text-slate-800"
                  title={t('supportsVision')}
                >
                  <input
                    type="checkbox"
                    checked={newModelSupportsVision}
                    onChange={(e) => setNewModelSupportsVision(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-600 light:border-slate-400 bg-slate-900 light:bg-white text-cyan-500 focus:ring-cyan-500/50"
                  />
                  <span className="text-xs whitespace-nowrap">{t('supportsVision')}</span>
                </label>
                <Button variant="secondary" onClick={handleAddModel} disabled={!newModelId.trim()}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

            <div className="bg-slate-800/50 light:bg-white rounded-lg border border-slate-700 light:border-slate-200 divide-y divide-slate-700 light:divide-slate-200">
              {models.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-500 light:text-slate-600">
                  {t('noModelsAddOrFetch')}
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-500 light:text-slate-600">
                  {t('noMatchingModels')}
                </div>
              ) : (
                filteredModels.map((model) => (
                  <div
                    key={model.id}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-200 light:text-slate-800">{model.name}</p>
                      <p className="text-xs text-slate-500 light:text-slate-600">{model.modelId}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* 能力图标 */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onToggleVision?.(model.id, !(model.supportsVision ?? inferVisionSupport(model.modelId)))}
                          title={t('vision')}
                          className={`p-1 rounded transition-colors ${
                            (model.supportsVision ?? inferVisionSupport(model.modelId))
                              ? 'bg-slate-700/50 light:bg-slate-200 hover:bg-slate-600 light:hover:bg-slate-300'
                              : 'bg-slate-800/50 light:bg-slate-100 hover:bg-slate-700 light:hover:bg-slate-200'
                          }`}
                        >
                          {(model.supportsVision ?? inferVisionSupport(model.modelId)) ? (
                            <Eye className="w-3 h-3 text-cyan-400" />
                          ) : (
                            <EyeOff className="w-3 h-3 text-slate-500" />
                          )}
                        </button>
                        {(model.supportsReasoning ?? inferReasoningSupport(model.modelId)) && (
                          <span title={t('supportsReasoning')} className="p-1 rounded bg-slate-700/50 light:bg-slate-200">
                            <Brain className="w-3 h-3 text-purple-400" />
                          </span>
                        )}
                        {(model.supportsFunctionCalling ?? inferFunctionCallingSupport(model.modelId)) && (
                          <span title={t('supportsFunctionCalling')} className="p-1 rounded bg-slate-700/50 light:bg-slate-200">
                            <Wrench className="w-3 h-3 text-amber-400" />
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => onRemoveModel(model.id)}
                        className="p-1.5 text-slate-500 light:text-slate-400 hover:text-rose-500 hover:bg-slate-700 light:hover:bg-slate-200 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-slate-700 light:border-slate-200">
          <Button variant="danger" onClick={onDelete}>
            <Trash2 className="w-4 h-4" />
            <span>{t('deleteProvider')}</span>
          </Button>
          <Button onClick={handleSave} loading={saving}>
            {t('saveConfig')}
          </Button>
        </div>
      </div>

      <Modal
        isOpen={showModelPicker}
        onClose={() => {
          setShowModelPicker(false);
          setModelFilter('');
        }}
        title={t('selectModelsToAdd')}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            placeholder={t('searchModels')}
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
          />

          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400 light:text-slate-600">
              {modelFilter
                ? t('filteredModels', { count: fetchedModels.filter(m => m.id.toLowerCase().includes(modelFilter.toLowerCase()) || m.name.toLowerCase().includes(modelFilter.toLowerCase())).length })
                : t('foundModels', { count: fetchedModels.length })}
              {t('selectedCount', { count: selectedFetchedModels.size })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const filteredIds = fetchedModels
                    .filter(m => !modelFilter || m.id.toLowerCase().includes(modelFilter.toLowerCase()) || m.name.toLowerCase().includes(modelFilter.toLowerCase()))
                    .map(m => m.id);
                  setSelectedFetchedModels(new Set([...selectedFetchedModels, ...filteredIds]));
                }}
              >
                {modelFilter ? t('selectAllFiltered') : t('selectAll')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedFetchedModels(new Set())}
              >
                {t('deselectAll')}
              </Button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto border border-slate-700 light:border-slate-300 rounded-lg divide-y divide-slate-700 light:divide-slate-200">
            {fetchedModels
              .filter(m => !modelFilter || m.id.toLowerCase().includes(modelFilter.toLowerCase()) || m.name.toLowerCase().includes(modelFilter.toLowerCase()))
              .map((model) => (
              <label
                key={model.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800/50 light:hover:bg-slate-100 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedFetchedModels.has(model.id)}
                  onChange={() => toggleModelSelection(model.id)}
                  className="w-4 h-4 rounded border-slate-600 light:border-slate-400 bg-slate-800 light:bg-white text-cyan-500 focus:ring-cyan-500/50"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">{model.name}</p>
                  <p className="text-xs text-slate-500 light:text-slate-500 truncate">{model.id}</p>
                </div>
                {model.owned_by && (
                  <span className="text-xs text-slate-600 light:text-slate-500">{model.owned_by}</span>
                )}
              </label>
            ))}
            {fetchedModels.filter(m => !modelFilter || m.id.toLowerCase().includes(modelFilter.toLowerCase()) || m.name.toLowerCase().includes(modelFilter.toLowerCase())).length === 0 && (
              <div className="p-4 text-center text-sm text-slate-500 light:text-slate-600">
                {t('noMatchingModels')}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => {
              setShowModelPicker(false);
              setModelFilter('');
            }}>
              {tCommon('cancel')}
            </Button>
            <Button
              onClick={handleAddSelectedModels}
              disabled={selectedFetchedModels.size === 0}
            >
              {t('addSelectedModels', { count: selectedFetchedModels.size })}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
