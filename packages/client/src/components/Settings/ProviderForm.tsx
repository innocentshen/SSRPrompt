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
  Search,
  Pencil,
} from 'lucide-react';
import { Button, Checkbox, Input, Select, Toggle, Modal, useToast } from '../ui';
import type { Provider, Model, ProviderType, UpdateModelDto } from '../../types';
import { inferVisionSupport, inferReasoningSupport, inferFunctionCallingSupport } from '../../lib/model-capabilities';
import { getErrorMessage } from '../../lib/error-messages';
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
  isAdmin?: boolean;
  onAddModel: (
    modelId: string,
    name: string,
    options?: {
      supportsVision?: boolean;
      supportsReasoning?: boolean;
      supportsFunctionCalling?: boolean;
      maxContextLength?: number;
      inputPricePerM?: number;
      outputPricePerM?: number;
    }
  ) => Promise<void>;
  onUpdateModel: (modelId: string, data: UpdateModelDto) => Promise<Model | null>;
  onRemoveModel: (modelId: string) => Promise<void>;
  onToggleVision?: (modelId: string, enabled: boolean) => Promise<void>;
  onToggleReasoning?: (modelId: string, enabled: boolean) => Promise<void>;
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
  isAdmin = false,
  onAddModel,
  onUpdateModel,
  onRemoveModel,
  onToggleVision,
  onToggleReasoning,
  onTestConnection,
}: ProviderFormProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ProviderType>('openai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [isSystem, setIsSystem] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [saving, setSaving] = useState(false);
  const [showModelEditor, setShowModelEditor] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [savingModelEditor, setSavingModelEditor] = useState(false);
  const [modelFormId, setModelFormId] = useState('');
  const [modelFormName, setModelFormName] = useState('');
  const [modelFormMaxContextLength, setModelFormMaxContextLength] = useState('8000');
  const [modelFormInputPricePerM, setModelFormInputPricePerM] = useState('0');
  const [modelFormOutputPricePerM, setModelFormOutputPricePerM] = useState('0');
  const [modelFormSupportsVision, setModelFormSupportsVision] = useState(false);
  const [modelFormSupportsReasoning, setModelFormSupportsReasoning] = useState(false);
  const [modelFormSupportsFunctionCalling, setModelFormSupportsFunctionCalling] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [selectedFetchedModels, setSelectedFetchedModels] = useState<Set<string>>(new Set());
  const [modelFilter, setModelFilter] = useState('');
  const { showToast } = useToast();
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const isSystemProvider = provider?.isSystem ?? false;
  const isReadonlySystemProvider = isSystemProvider && !isAdmin;
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return models;
    return models.filter((model) => {
      const modelName = model.name?.toLowerCase() ?? '';
      const modelId = model.modelId?.toLowerCase() ?? '';
      return modelId.includes(query) || modelName.includes(query);
    });
  }, [models, modelSearch]);

  const formatPricePerM = (value: number | undefined) => {
    if (!Number.isFinite(value)) return '0';
    return Number(value).toString();
  };

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
      setIsSystem(provider.isSystem);
    } else {
      setName('');
      setType('openai');
      setApiKey('');
      setBaseUrl('');
      setEnabled(false);
      setIsSystem(false);
    }
    setShowApiKey(false);
    setTestResult(null);
    setModelSearch('');
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
      // System providers are maintained by admins; normal users can only enable/disable them.
      if (isReadonlySystemProvider) {
        await onSave({ enabled });
        return;
      }

      const trimmedApiKey = apiKey.trim();
      await onSave({
        name,
        type,
        ...(trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
        baseUrl: baseUrl || null,
        enabled,
        ...(isAdmin ? { isSystem } : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  const resetModelEditor = () => {
    setEditingModel(null);
    setModelFormId('');
    setModelFormName('');
    setModelFormMaxContextLength('8000');
    setModelFormInputPricePerM('0');
    setModelFormOutputPricePerM('0');
    setModelFormSupportsVision(false);
    setModelFormSupportsReasoning(false);
    setModelFormSupportsFunctionCalling(false);
  };

  const openCreateModelEditor = () => {
    resetModelEditor();
    setShowModelEditor(true);
  };

  const openEditModelEditor = (model: Model) => {
    setEditingModel(model);
    setModelFormId(model.modelId || '');
    setModelFormName(model.name || '');
    setModelFormMaxContextLength(String(model.maxContextLength ?? 8000));
    setModelFormInputPricePerM(String(model.inputPricePerM ?? 0));
    setModelFormOutputPricePerM(String(model.outputPricePerM ?? 0));
    setModelFormSupportsVision(model.supportsVision ?? inferVisionSupport(model.modelId));
    setModelFormSupportsReasoning(model.supportsReasoning ?? inferReasoningSupport(model.modelId));
    setModelFormSupportsFunctionCalling(model.supportsFunctionCalling ?? inferFunctionCallingSupport(model.modelId));
    setShowModelEditor(true);
  };

  const closeModelEditor = () => {
    if (savingModelEditor) return;
    setShowModelEditor(false);
    resetModelEditor();
  };

  const handleSaveModelEditor = async () => {
    const trimmedModelId = modelFormId.trim();
    if (!trimmedModelId) {
      showToast('error', t('modelIdPlaceholder'));
      return;
    }

    const parsedMaxContext = Number.parseInt(modelFormMaxContextLength.trim(), 10);
    if (!Number.isFinite(parsedMaxContext) || parsedMaxContext < 256) {
      showToast('error', `${t('maxContextLength')} >= 256`);
      return;
    }

    const parsedInputPrice = Number.parseFloat(modelFormInputPricePerM.trim());
    const parsedOutputPrice = Number.parseFloat(modelFormOutputPricePerM.trim());

    if (!Number.isFinite(parsedInputPrice) || parsedInputPrice < 0) {
      showToast('error', t('inputPricePerM', { defaultValue: 'Input Price/1M' }));
      return;
    }

    if (!Number.isFinite(parsedOutputPrice) || parsedOutputPrice < 0) {
      showToast('error', t('outputPricePerM', { defaultValue: 'Output Price/1M' }));
      return;
    }

    setSavingModelEditor(true);
    try {
      if (editingModel) {
        const updated = await onUpdateModel(editingModel.id, {
          modelId: trimmedModelId,
          name: modelFormName.trim() || trimmedModelId,
          maxContextLength: parsedMaxContext,
          inputPricePerM: parsedInputPrice,
          outputPricePerM: parsedOutputPrice,
          supportsVision: modelFormSupportsVision,
          supportsReasoning: modelFormSupportsReasoning,
          supportsFunctionCalling: modelFormSupportsFunctionCalling,
        });
        if (updated) {
          showToast('success', t('modelUpdated'));
          closeModelEditor();
        }
        return;
      }

      await onAddModel(trimmedModelId, modelFormName.trim() || trimmedModelId, {
        maxContextLength: parsedMaxContext,
        inputPricePerM: parsedInputPrice,
        outputPricePerM: parsedOutputPrice,
        supportsVision: modelFormSupportsVision,
        supportsReasoning: modelFormSupportsReasoning,
        supportsFunctionCalling: modelFormSupportsFunctionCalling,
      });
      closeModelEditor();
    } finally {
      setSavingModelEditor(false);
    }
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
      showToast('error', t('fetchModelsFailed') + ': ' + getErrorMessage(err));
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
        supportsReasoning: inferReasoningSupport(model.id),
        supportsFunctionCalling: inferFunctionCallingSupport(model.id),
        maxContextLength: model.maxContextLength ?? 8000,
        inputPricePerM: 0,
        outputPricePerM: 0,
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
    <div className="flex-1 overflow-hidden">
      <div className="w-full h-full max-w-5xl mx-auto p-6 flex flex-col gap-6 overflow-hidden">
        <div className="flex-shrink-0 rounded-xl border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-white p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-white light:text-slate-900">{t('providerConfig')}</h2>
            <div className="flex items-center gap-3">
              <span className="px-2 py-1 rounded-md bg-slate-800 light:bg-slate-100 border border-slate-700 light:border-slate-300 text-xs text-slate-400 light:text-slate-600">
                {provider.type}
              </span>
              <span className="px-2 py-1 rounded-md bg-slate-800 light:bg-slate-100 border border-slate-700 light:border-slate-300 text-xs text-slate-400 light:text-slate-600">
                {models.length}
              </span>
              {isAdmin && (
                <Toggle enabled={isSystem} onChange={setIsSystem} label={t('systemProvider')} size="sm" />
              )}
              <Toggle enabled={enabled} onChange={setEnabled} label={t('enable')} />
            </div>
          </div>

          {isReadonlySystemProvider && (
            <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-slate-50 px-4 py-3">
              <p className="text-sm text-slate-300 light:text-slate-700">
                {t('systemProviderDesc')}
              </p>
            </div>
          )}

          <div className="space-y-5">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <Input
                label={t('providerName')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('providerNamePlaceholder')}
                disabled={isReadonlySystemProvider}
                className={isReadonlySystemProvider ? 'opacity-60 cursor-not-allowed' : ''}
              />

              <Select
                label={t('providerType')}
                value={type}
                onChange={(e) => handleTypeChange(e.target.value as ProviderType)}
                options={providerTypes}
                disabled={isReadonlySystemProvider}
                className={isReadonlySystemProvider ? 'opacity-60 cursor-not-allowed' : ''}
              />
            </div>

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
                    disabled={isReadonlySystemProvider}
                    className={`w-full px-3 py-2 pr-10 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all ${isReadonlySystemProvider ? 'opacity-60 cursor-not-allowed' : ''}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    disabled={isReadonlySystemProvider}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 light:text-slate-400 hover:text-slate-300 light:hover:text-slate-600"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Button
                  variant="secondary"
                  onClick={handleTest}
                  disabled={isReadonlySystemProvider || !apiKey || testing}
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
                disabled={isReadonlySystemProvider}
                className={isReadonlySystemProvider ? 'opacity-60 cursor-not-allowed' : ''}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 rounded-xl border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-white p-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-medium text-white light:text-slate-900">{t('modelManagement')}</h3>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={openCreateModelEditor}
                disabled={isReadonlySystemProvider}
              >
                <Plus className="w-4 h-4" />
                <span>{t('addModel')}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleFetchModels}
                loading={fetchingModels}
                disabled={isReadonlySystemProvider || fetchingModels}
              >
                <RefreshCw className={`w-4 h-4 ${fetchingModels ? 'animate-spin' : ''}`} />
                <span>{t('autoFetch')}</span>
              </Button>
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 light:text-slate-400" />
            <input
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder={t('searchModels')}
              className="w-full pl-9 pr-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto bg-slate-800/50 light:bg-white rounded-lg border border-slate-700 light:border-slate-200 divide-y divide-slate-700 light:divide-slate-200">
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
                    <p className="text-[11px] text-slate-500 light:text-slate-600">
                      {t('inputPricePerM', { defaultValue: 'Input /1M' })}: {formatPricePerM(model.inputPricePerM)} | {t('outputPricePerM', { defaultValue: 'Output /1M' })}: {formatPricePerM(model.outputPricePerM)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* 能力图标 */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onToggleVision?.(model.id, !(model.supportsVision ?? inferVisionSupport(model.modelId)))}
                        title={t('vision')}
                        disabled={isReadonlySystemProvider}
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
                      <button
                        type="button"
                        onClick={() => onToggleReasoning?.(model.id, !(model.supportsReasoning ?? inferReasoningSupport(model.modelId)))}
                        title={t('supportsReasoning')}
                        disabled={isReadonlySystemProvider}
                        className={`p-1 rounded transition-colors ${
                          (model.supportsReasoning ?? inferReasoningSupport(model.modelId))
                            ? 'bg-slate-700/50 light:bg-slate-200 hover:bg-slate-600 light:hover:bg-slate-300'
                            : 'bg-slate-800/50 light:bg-slate-100 hover:bg-slate-700 light:hover:bg-slate-200'
                        }`}
                      >
                        <Brain className={`w-3 h-3 ${(model.supportsReasoning ?? inferReasoningSupport(model.modelId)) ? 'text-purple-400' : 'text-slate-500'}`} />
                      </button>
                      {(model.supportsFunctionCalling ?? inferFunctionCallingSupport(model.modelId)) && (
                        <span title={t('supportsFunctionCalling')} className="p-1 rounded bg-slate-700/50 light:bg-slate-200">
                          <Wrench className="w-3 h-3 text-amber-400" />
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => openEditModelEditor(model)}
                      disabled={isReadonlySystemProvider}
                      title={tCommon('edit')}
                      className="p-1.5 text-slate-500 light:text-slate-500 hover:text-cyan-400 hover:bg-slate-700 light:hover:bg-slate-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onRemoveModel(model.id)}
                      disabled={isReadonlySystemProvider}
                      className="p-1.5 text-slate-500 light:text-slate-400 hover:text-rose-500 hover:bg-slate-700 light:hover:bg-slate-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex-shrink-0 flex items-center justify-between border-t border-slate-700 light:border-slate-200 pt-4">
          <Button variant="danger" onClick={onDelete} disabled={isReadonlySystemProvider}>
            <Trash2 className="w-4 h-4" />
            <span>{t('deleteProvider')}</span>
          </Button>
          <Button onClick={handleSave} loading={saving}>
            {t('saveConfig')}
          </Button>
        </div>
      </div>

      <Modal
        isOpen={showModelEditor}
        onClose={closeModelEditor}
        title={editingModel ? t('editModel', { defaultValue: 'Edit Model' }) : t('addModel')}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label={t('modelIdPlaceholder')}
            value={modelFormId}
            onChange={(e) => setModelFormId(e.target.value)}
            placeholder={t('modelIdPlaceholder')}
            disabled={isReadonlySystemProvider}
          />
          <Input
            label={t('displayNamePlaceholder')}
            value={modelFormName}
            onChange={(e) => setModelFormName(e.target.value)}
            placeholder={t('displayNamePlaceholder')}
            disabled={isReadonlySystemProvider}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label={t('maxContextLength')}
              value={modelFormMaxContextLength}
              onChange={(e) => setModelFormMaxContextLength(e.target.value)}
              placeholder={t('maxContextLengthPlaceholder')}
              type="number"
              min={256}
              disabled={isReadonlySystemProvider}
            />
            <Input
              label={t('inputPricePerM', { defaultValue: 'Input Price / 1M Tokens' })}
              value={modelFormInputPricePerM}
              onChange={(e) => setModelFormInputPricePerM(e.target.value)}
              placeholder="0"
              type="number"
              step="0.000001"
              min="0"
              disabled={isReadonlySystemProvider}
            />
            <Input
              label={t('outputPricePerM', { defaultValue: 'Output Price / 1M Tokens' })}
              value={modelFormOutputPricePerM}
              onChange={(e) => setModelFormOutputPricePerM(e.target.value)}
              placeholder="0"
              type="number"
              step="0.000001"
              min="0"
              disabled={isReadonlySystemProvider}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 text-sm text-slate-200 light:text-slate-800">
              <Checkbox
                checked={modelFormSupportsVision}
                onChange={(e) => setModelFormSupportsVision(e.target.checked)}
                disabled={isReadonlySystemProvider}
              />
              <span>{t('supportsVision')}</span>
            </label>
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 text-sm text-slate-200 light:text-slate-800">
              <Checkbox
                checked={modelFormSupportsReasoning}
                onChange={(e) => setModelFormSupportsReasoning(e.target.checked)}
                disabled={isReadonlySystemProvider}
              />
              <span>{t('supportsReasoning')}</span>
            </label>
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 text-sm text-slate-200 light:text-slate-800">
              <Checkbox
                checked={modelFormSupportsFunctionCalling}
                onChange={(e) => setModelFormSupportsFunctionCalling(e.target.checked)}
                disabled={isReadonlySystemProvider}
              />
              <span>{t('supportsFunctionCalling')}</span>
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={closeModelEditor} disabled={savingModelEditor}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleSaveModelEditor} loading={savingModelEditor} disabled={isReadonlySystemProvider}>
              {editingModel ? tCommon('save') : tCommon('add')}
            </Button>
          </div>
        </div>
      </Modal>

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
                <Checkbox
                  checked={selectedFetchedModels.has(model.id)}
                  onChange={() => toggleModelSelection(model.id)}
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

