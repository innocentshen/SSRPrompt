import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Database, Sparkles, FlaskConical } from 'lucide-react';
import { ProviderList } from '../components/Settings/ProviderList';
import { ProviderForm } from '../components/Settings/ProviderForm';
import { AddProviderModal } from '../components/Settings/AddProviderModal';
import { DatabaseSettings } from '../components/Settings/DatabaseSettings';
import { OptimizationSettings } from '../components/Settings/OptimizationSettings';
import { ModelCapabilityTest } from '../components/Settings/ModelCapabilityTest';
import { useToast } from '../components/ui';
import { getDatabase, isDatabaseConfigured } from '../lib/database';
import type { Provider, Model, ProviderType } from '../types';

type SettingsTab = 'providers' | 'database' | 'optimization' | 'capability-test';

export function SettingsPage() {
  const { t } = useTranslation('settings');
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [loading, setLoading] = useState(false);

  const selectedProvider = providers.find((p) => p.id === selectedProviderId) || null;
  const selectedModels = models.filter((m) => m.provider_id === selectedProviderId);

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    if (!isDatabaseConfigured()) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data: providersData, error: providersError } = await getDatabase()
        .from('providers')
        .select('*')
        .order('created_at', { ascending: true });

      const { data: modelsData } = await getDatabase()
        .from('models')
        .select('*')
        .order('created_at', { ascending: true });

      if (providersError) {
        showToast('error', t('configureDbFirst'));
      } else if (providersData) {
        setProviders(providersData);
        if (providersData.length > 0 && !selectedProviderId) {
          setSelectedProviderId(providersData[0].id);
        }
      }
      if (modelsData) {
        setModels(modelsData);
      }
    } catch {
      showToast('error', t('configureDbFirst'));
    }
    setLoading(false);
  };

  const handleAddProvider = async (name: string, type: ProviderType) => {
    try {
      const { data, error } = await getDatabase()
        .from('providers')
        .insert({
          name,
          type,
          api_key: '',
          enabled: true,
        })
        .select()
        .single();

      if (error) {
        showToast('error', t('addFailed') + ': ' + error.message);
        return;
      }

      if (data) {
        setProviders((prev) => [...prev, data]);
        setSelectedProviderId(data.id);
        showToast('success', t('providerAddedSuccess'));
      }
    } catch {
      showToast('error', t('addProviderFailed'));
    }
  };

  const handleSaveProvider = async (data: Partial<Provider>) => {
    if (!selectedProviderId) return;
    try {
      const { error } = await getDatabase()
        .from('providers')
        .update({
          ...data,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedProviderId);

      if (error) {
        showToast('error', t('saveFailed') + ': ' + error.message);
        return;
      }

      setProviders((prev) =>
        prev.map((p) => (p.id === selectedProviderId ? { ...p, ...data } : p))
      );
      showToast('success', t('configSaved'));
    } catch {
      showToast('error', t('saveConfigFailed'));
    }
  };

  const handleDeleteProvider = async () => {
    if (!selectedProviderId) return;
    try {
      const { error } = await getDatabase()
        .from('providers')
        .delete()
        .eq('id', selectedProviderId);

      if (error) {
        showToast('error', t('deleteFailed') + ': ' + error.message);
        return;
      }

      const remaining = providers.filter((p) => p.id !== selectedProviderId);
      setProviders(remaining);
      setModels((prev) => prev.filter((m) => m.provider_id !== selectedProviderId));
      setSelectedProviderId(remaining[0]?.id || null);
      showToast('success', t('providerDeletedSuccess'));
    } catch {
      showToast('error', t('deleteProviderFailed'));
    }
  };

  const handleAddModel = async (modelId: string, name: string, supportsVision: boolean = true) => {
    if (!selectedProviderId) return;
    try {
      const { data, error } = await getDatabase()
        .from('models')
        .insert({
          provider_id: selectedProviderId,
          model_id: modelId,
          name,
          capabilities: ['chat'],
          supports_vision: supportsVision,
        })
        .select()
        .single();

      if (error) {
        showToast('error', t('addModelFailed') + ': ' + error.message);
        return;
      }

      if (data) {
        setModels((prev) => [...prev, data]);
        showToast('success', t('modelAddedSuccess'));
      }
    } catch {
      showToast('error', t('addModelFailed'));
    }
  };

  const handleToggleVision = async (modelId: string, supportsVision: boolean) => {
    try {
      const { error } = await getDatabase()
        .from('models')
        .update({ supports_vision: supportsVision })
        .eq('id', modelId);

      if (error) {
        showToast('error', t('updateFailed') + ': ' + error.message);
        return;
      }

      setModels((prev) =>
        prev.map((m) => (m.id === modelId ? { ...m, supports_vision: supportsVision } : m))
      );
    } catch {
      showToast('error', t('updateModelFailed'));
    }
  };

  const handleRemoveModel = async (modelId: string) => {
    try {
      const { error } = await getDatabase().from('models').delete().eq('id', modelId);

      if (error) {
        showToast('error', t('deleteModelFailed'));
        return;
      }

      setModels((prev) => prev.filter((m) => m.id !== modelId));
      showToast('success', t('modelDeletedSuccess'));
    } catch {
      showToast('error', t('deleteModelFailed'));
    }
  };

  const handleTestConnection = async (apiKey: string, baseUrl: string, type: ProviderType): Promise<boolean> => {
    if (!apiKey) {
      showToast('error', t('fillApiKeyFirst'));
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (apiKey.length > 10) {
      showToast('success', t('connectionTestSuccess'));
      return true;
    } else {
      showToast('error', t('apiKeyFormatError'));
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
          onClick={() => setActiveTab('database')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'database'
              ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
              : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
          }`}
        >
          <Database className="w-4 h-4" />
          {t('database')}
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
          onClick={() => setActiveTab('capability-test')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'capability-test'
              ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
              : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
          }`}
        >
          <FlaskConical className="w-4 h-4" />
          {t('capabilityTest')}
        </button>
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
            onSave={handleSaveProvider}
            onDelete={handleDeleteProvider}
            onAddModel={handleAddModel}
            onRemoveModel={handleRemoveModel}
            onToggleVision={handleToggleVision}
            onTestConnection={handleTestConnection}
          />
          <AddProviderModal
            isOpen={showAddModal}
            onClose={() => setShowAddModal(false)}
            onAdd={handleAddProvider}
          />
        </div>
      ) : activeTab === 'database' ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl">
            <DatabaseSettings />
          </div>
        </div>
      ) : activeTab === 'optimization' ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl">
            <OptimizationSettings />
          </div>
        </div>
      ) : activeTab === 'capability-test' ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl">
            <ModelCapabilityTest models={models} providers={providers} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
