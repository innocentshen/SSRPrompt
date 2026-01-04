import { useState, useEffect } from 'react';
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
  Image,
  Brain,
  Wrench,
} from 'lucide-react';
import { Button, Input, Select, Toggle, Modal, useToast } from '../ui';
import type { Provider, Model, ProviderType } from '../../types';
import { inferVisionSupport, inferReasoningSupport, inferFunctionCallingSupport } from '../../lib/model-capabilities';

interface FetchedModel {
  id: string;
  name: string;
  owned_by?: string;
}

interface ProviderFormProps {
  provider: Provider | null;
  models: Model[];
  onSave: (data: Partial<Provider>) => Promise<void>;
  onDelete: () => Promise<void>;
  onAddModel: (modelId: string, name: string) => Promise<void>;
  onRemoveModel: (modelId: string) => Promise<void>;
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
  const [fetchingModels, setFetchingModels] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [selectedFetchedModels, setSelectedFetchedModels] = useState<Set<string>>(new Set());
  const [modelFilter, setModelFilter] = useState('');
  const { showToast } = useToast();
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');

  const providerTypes = providerTypesStatic.map(p => ({
    value: p.value,
    label: p.isCustom ? t('customOpenAICompatible') : p.label
  }));

  useEffect(() => {
    if (provider) {
      setName(provider.name);
      setType(provider.type);
      setApiKey(provider.api_key);
      setBaseUrl(provider.base_url || '');
      setEnabled(provider.enabled);
    } else {
      setName('');
      setType('openai');
      setApiKey('');
      setBaseUrl('');
      setEnabled(false);
    }
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
      await onSave({ name, type, api_key: apiKey, base_url: baseUrl || null, enabled });
    } finally {
      setSaving(false);
    }
  };

  const handleAddModel = async () => {
    if (!newModelId.trim()) return;
    await onAddModel(newModelId.trim(), newModelName.trim() || newModelId.trim());
    setNewModelId('');
    setNewModelName('');
  };

  const handleFetchModels = async () => {
    if (!apiKey) {
      showToast('error', t('fillApiKeyFirst'));
      return;
    }

    setFetchingModels(true);
    try {
      let modelsUrl = '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const effectiveBaseUrl = baseUrl || defaultBaseUrls[type];

      if (type === 'openai' || type === 'custom' || type === 'openrouter') {
        const cleanBaseUrl = effectiveBaseUrl.replace(/#$/, '').replace(/\/$/, '');
        modelsUrl = `${cleanBaseUrl}/v1/models`;
        headers['Authorization'] = `Bearer ${apiKey.split(',')[0].trim()}`;
        if (type === 'openrouter') {
          headers['HTTP-Referer'] = window.location.origin;
        }
      } else if (type === 'anthropic') {
        showToast('info', t('anthropicNoAutoFetch'));
        setFetchingModels(false);
        return;
      } else if (type === 'gemini') {
        const cleanBaseUrl = effectiveBaseUrl.replace(/\/$/, '');
        modelsUrl = `${cleanBaseUrl}/v1beta/models?key=${apiKey.split(',')[0].trim()}`;
      } else {
        showToast('error', t('providerNoAutoFetch'));
        setFetchingModels(false);
        return;
      }

      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: type !== 'gemini' ? headers : undefined,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      let modelList: FetchedModel[] = [];

      if (type === 'gemini') {
        modelList = (data.models || []).map((m: any) => ({
          id: m.name?.replace('models/', '') || m.name,
          name: m.displayName || m.name?.replace('models/', ''),
          owned_by: 'google',
        }));
      } else {
        modelList = (data.data || []).map((m: any) => ({
          id: m.id,
          name: m.id,
          owned_by: m.owned_by,
        }));
      }

      const existingModelIds = new Set(models.map(m => m.model_id));
      modelList = modelList.filter(m => !existingModelIds.has(m.id));

      if (modelList.length === 0) {
        showToast('info', t('noNewModelsFound'));
        setFetchingModels(false);
        return;
      }

      modelList.sort((a, b) => a.id.localeCompare(b.id));
      setFetchedModels(modelList);
      setSelectedFetchedModels(new Set());
      setShowModelPicker(true);
      showToast('success', t('foundModelsCount', { count: modelList.length }));
    } catch (err: any) {
      showToast('error', t('fetchModelsFailed') + ': ' + (err.message || 'Network error'));
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
      await onAddModel(model.id, model.name);
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
                  placeholder="sk-..."
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
              disabled={!apiKey}
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
              <Button variant="secondary" onClick={handleAddModel} disabled={!newModelId.trim()}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            <div className="bg-slate-800/50 light:bg-white rounded-lg border border-slate-700 light:border-slate-200 divide-y divide-slate-700 light:divide-slate-200">
              {models.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-500 light:text-slate-600">
                  {t('noModelsAddOrFetch')}
                </div>
              ) : (
                models.map((model) => (
                  <div
                    key={model.id}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-200 light:text-slate-800">{model.name}</p>
                      <p className="text-xs text-slate-500 light:text-slate-600">{model.model_id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* 能力图标 */}
                      <div className="flex items-center gap-1">
                        {(model.supports_vision ?? inferVisionSupport(model.model_id)) && (
                          <span title={t('supportsVision')} className="p-1 rounded bg-slate-700/50 light:bg-slate-200">
                            <Image className="w-3 h-3 text-cyan-400" />
                          </span>
                        )}
                        {(model.supports_reasoning ?? inferReasoningSupport(model.model_id)) && (
                          <span title={t('supportsReasoning')} className="p-1 rounded bg-slate-700/50 light:bg-slate-200">
                            <Brain className="w-3 h-3 text-purple-400" />
                          </span>
                        )}
                        {(model.supports_function_calling ?? inferFunctionCallingSupport(model.model_id)) && (
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
