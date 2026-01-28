import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Sparkles, Users, FileText } from 'lucide-react';
import { ProviderList } from '../components/Settings/ProviderList';
import { ProviderForm } from '../components/Settings/ProviderForm';
import { AddProviderModal } from '../components/Settings/AddProviderModal';
import { OptimizationSettings } from '../components/Settings/OptimizationSettings';
import { OcrSettings } from '../components/Settings/OcrSettings';
import { UserManagement } from '../components/Settings/UserManagement';
import { useToast } from '../components/ui';
import { providersApi, modelsApi } from '../api';
import { useGlobalStore } from '../store/useGlobalStore';
import { useAuthStore } from '../store/useAuthStore';
import { invalidateModelsCache, invalidateProvidersCache } from '../lib/cache-events';
import type { Provider, Model, ProviderType } from '../types';

type SettingsTab = 'providers' | 'optimization' | 'ocr' | 'users';

export function SettingsPage() {
  const { t } = useTranslation('settings');
  const { showToast } = useToast();
  const { fetchProvidersAndModels: refreshGlobalStore } = useGlobalStore();
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.includes('admin') ?? false;
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [, setLoading] = useState(false);

  const selectedProvider = providers.find((p) => p.id === selectedProviderId) || null;
  const selectedModels = models.filter((m) => m.providerId === selectedProviderId);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      // 并行加载 providers 和 models
      const [providersData, modelsData] = await Promise.all([
        providersApi.list(),
        modelsApi.list(),
      ]);

      setProviders(providersData);
      setModels(modelsData);

      if (providersData.length > 0) {
        setSelectedProviderId((prev) => prev ?? providersData[0].id);
      }
    } catch (err) {
      console.error('Failed to load providers:', err);
      showToast('error', t('loadFailed'));
    }
    setLoading(false);
  }, [showToast, t]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const handleAddProvider = async (name: string, type: ProviderType, isSystem?: boolean) => {
    try {
      const newProvider = await providersApi.create({
        name,
        type,
        apiKey: '',
        enabled: true,
        ...(isSystem !== undefined && { isSystem }),
      });

      setProviders((prev) => [...prev, newProvider]);
      setSelectedProviderId(newProvider.id);
      showToast('success', t('providerAddedSuccess'));
      setShowAddModal(false);
      // Sync to global store for other pages
      refreshGlobalStore(true);
      invalidateProvidersCache(newProvider);
    } catch (err) {
      console.error('Failed to add provider:', err);
      showToast('error', t('addProviderFailed'));
    }
  };

  const handleSaveProvider = async (data: Partial<Provider>) => {
    if (!selectedProviderId) return;
    try {
      const updated = await providersApi.update(selectedProviderId, {
        name: data.name,
        type: data.type,
        apiKey: data.apiKey,
        baseUrl: data.baseUrl,
        enabled: data.enabled,
        ...(isAdmin && typeof data.isSystem === 'boolean' && { isSystem: data.isSystem }),
      });

      setProviders((prev) =>
        prev.map((p) => (p.id === selectedProviderId ? updated : p))
      );
      showToast('success', t('configSaved'));
      // Sync to global store for other pages
      refreshGlobalStore(true);
      invalidateProvidersCache(updated);
    } catch (err) {
      console.error('Failed to save provider:', err);
      showToast('error', t('saveConfigFailed'));
    }
  };

  const handleDeleteProvider = async () => {
    if (!selectedProviderId) return;
    try {
      await providersApi.delete(selectedProviderId);

      const remaining = providers.filter((p) => p.id !== selectedProviderId);
      setProviders(remaining);
      setModels((prev) => prev.filter((m) => m.providerId !== selectedProviderId));
      setSelectedProviderId(remaining[0]?.id || null);
      showToast('success', t('providerDeletedSuccess'));
      // Sync to global store for other pages
      refreshGlobalStore(true);
      invalidateProvidersCache({});
    } catch (err) {
      console.error('Failed to delete provider:', err);
      showToast('error', t('deleteProviderFailed'));
    }
  };

  const handleAddModel = async (
    modelId: string,
    name: string,
    options?: { supportsVision?: boolean; supportsReasoning?: boolean; maxContextLength?: number }
  ) => {
    if (!selectedProviderId) return;
    try {
      const newModel = await modelsApi.create(selectedProviderId, {
        modelId,
        name,
        capabilities: ['chat'],
        supportsVision: options?.supportsVision,
        supportsReasoning: options?.supportsReasoning,
        maxContextLength: options?.maxContextLength,
      });

      setModels((prev) => [...prev, newModel]);
      showToast('success', t('modelAddedSuccess'));
      // Sync to global store for other pages
      refreshGlobalStore(true);
      invalidateModelsCache(newModel);
    } catch (err) {
      console.error('Failed to add model:', err);
      showToast('error', t('addModelFailed'));
    }
  };

  const handleToggleVision = async (modelId: string, supportsVision: boolean) => {
    try {
      const updated = await modelsApi.update(modelId, { supportsVision });
      setModels((prev) =>
        prev.map((m) => (m.id === modelId ? updated : m))
      );
      // Sync to global store for other pages
      refreshGlobalStore(true);
      invalidateModelsCache(updated);
    } catch (err) {
      console.error('Failed to update model:', err);
      showToast('error', t('updateModelFailed'));
    }
  };

  const handleToggleReasoning = async (modelId: string, supportsReasoning: boolean) => {
    try {
      const updated = await modelsApi.update(modelId, { supportsReasoning });
      setModels((prev) =>
        prev.map((m) => (m.id === modelId ? updated : m))
      );
      // Sync to global store for other pages
      refreshGlobalStore(true);
      invalidateModelsCache(updated);
    } catch (err) {
      console.error('Failed to update model:', err);
      showToast('error', t('updateModelFailed'));
    }
  };

  const handleRemoveModel = async (modelId: string) => {
    try {
      await modelsApi.delete(modelId);
      setModels((prev) => prev.filter((m) => m.id !== modelId));
      showToast('success', t('modelDeletedSuccess'));
      // Sync to global store for other pages
      refreshGlobalStore(true);
      invalidateModelsCache({});
    } catch (err) {
      console.error('Failed to delete model:', err);
      showToast('error', t('deleteModelFailed'));
    }
  };

  const handleTestConnection = async (apiKey: string, baseUrl: string, type: ProviderType): Promise<boolean> => {
    if (!apiKey) {
      showToast('error', t('fillApiKeyFirst'));
      return false;
    }

    try {
      const result = await providersApi.testConnection({
        type,
        apiKey,
        baseUrl: baseUrl || null,
      });

      if (result.success) {
        showToast('success', t('connectionTestSuccess'));
        return true;
      } else {
        showToast('error', result.message || t('connectionTestFailed'));
        return false;
      }
    } catch (err) {
      console.error('Connection test failed:', err);
      showToast('error', t('connectionTestFailed'));
      return false;
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-950 light:bg-slate-50">
      <div className="flex-shrink-0 flex border-b border-slate-800 light:border-slate-200 px-6">
        <button
          onClick={() => setActiveTab('providers')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'providers'
              ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
              : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
          }`}
        >
          <Bot className="w-4 h-4" />
          {t('providers')}
        </button>
        <button
          onClick={() => setActiveTab('optimization')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'optimization'
              ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
              : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          {t('optimization')}
        </button>
        <button
          onClick={() => setActiveTab('ocr')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'ocr'
              ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
              : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          {t('fileOcr')}
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'users'
                ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
                : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            {t('userManagement')}
          </button>
        )}
      </div>

      {activeTab === 'providers' ? (
        <div className="flex-1 flex overflow-hidden">
          <ProviderList
            providers={providers}
            selectedId={selectedProviderId}
            onSelect={setSelectedProviderId}
            onAdd={() => setShowAddModal(true)}
          />
          <ProviderForm
            provider={selectedProvider}
            models={selectedModels}
            isAdmin={isAdmin}
            onSave={handleSaveProvider}
            onDelete={handleDeleteProvider}
            onAddModel={handleAddModel}
            onRemoveModel={handleRemoveModel}
            onToggleVision={handleToggleVision}
            onToggleReasoning={handleToggleReasoning}
            onTestConnection={handleTestConnection}
          />
          <AddProviderModal
            isOpen={showAddModal}
            onClose={() => setShowAddModal(false)}
            onAdd={handleAddProvider}
            isAdmin={isAdmin}
          />
        </div>
      ) : activeTab === 'optimization' ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl">
            <OptimizationSettings />
          </div>
        </div>
      ) : activeTab === 'ocr' ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl">
            <OcrSettings />
          </div>
        </div>
      ) : activeTab === 'users' ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl">
            <UserManagement />
          </div>
        </div>
      ) : null}
    </div>
  );
}
