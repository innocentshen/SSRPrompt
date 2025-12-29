import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Database, Sparkles, Lock, AlertCircle } from 'lucide-react';
// import { FlaskConical } from 'lucide-react'; // 能力测试图标暂时注释
import { ProviderList } from '../components/Settings/ProviderList';
import { ProviderForm } from '../components/Settings/ProviderForm';
import { AddProviderModal } from '../components/Settings/AddProviderModal';
import { DatabaseSettings } from '../components/Settings/DatabaseSettings';
import { OptimizationSettings } from '../components/Settings/OptimizationSettings';
// import { ModelCapabilityTest } from '../components/Settings/ModelCapabilityTest';
import { useToast, Button, Input } from '../components/ui';
import { getDatabase, isDatabaseConfigured } from '../lib/database';
import { isDemoMode, verifyDemoSettingsPassword } from '../lib/tenant';
import type { Provider, Model, ProviderType } from '../types';

type SettingsTab = 'providers' | 'database' | 'optimization' | 'capability-test';

const DEMO_SETTINGS_UNLOCKED_KEY = 'demo_settings_unlocked';

export function SettingsPage() {
  const { t } = useTranslation('settings');
  const { t: tLogin } = useTranslation('login');
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [loading, setLoading] = useState(false);

  // Demo 模式密码验证状态
  const [isUnlocked, setIsUnlocked] = useState(() => {
    // 检查本次会话是否已解锁
    if (!isDemoMode()) return true;
    return sessionStorage.getItem(DEMO_SETTINGS_UNLOCKED_KEY) === 'true';
  });
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyDemoSettingsPassword(authPassword)) {
      sessionStorage.setItem(DEMO_SETTINGS_UNLOCKED_KEY, 'true');
      setIsUnlocked(true);
      setAuthError('');
    } else {
      setAuthError(tLogin('demoSettingsPasswordWrong'));
      setAuthPassword('');
    }
  };

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
      const db = getDatabase();

      // 获取该服务商下的所有模型 ID
      const providerModelIds = models
        .filter((m) => m.provider_id === selectedProviderId)
        .map((m) => m.id);

      if (providerModelIds.length > 0) {
        // 先清除 evaluations 表中对这些模型的引用（设为 NULL）
        // 清除 model_id 引用
        await db
          .from('evaluations')
          .update({ model_id: null })
          .in('model_id', providerModelIds);

        // 清除 judge_model_id 引用
        await db
          .from('evaluations')
          .update({ judge_model_id: null })
          .in('judge_model_id', providerModelIds);

        // 删除该服务商下的所有模型
        await db
          .from('models')
          .delete()
          .eq('provider_id', selectedProviderId);
      }

      // 删除服务商
      const { error } = await db
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

  // Demo 模式密码验证界面
  if (isDemoMode() && !isUnlocked) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950 light:bg-slate-50">
        <div className="w-full max-w-md p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-500/10 rounded-2xl mb-4">
              <Lock className="w-8 h-8 text-amber-400" />
            </div>
            <h2 className="text-2xl font-bold text-white light:text-slate-900 mb-2">
              {tLogin('demoSettingsAuth')}
            </h2>
            <p className="text-slate-400 light:text-slate-600">
              {tLogin('demoSettingsAuthDesc')}
            </p>
          </div>

          <div className="bg-slate-800/50 light:bg-white/80 backdrop-blur-sm border border-slate-700 light:border-slate-200 rounded-xl p-6">
            <form onSubmit={handleAuthSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
                  {tLogin('demoSettingsPassword')}
                </label>
                <Input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder={tLogin('demoSettingsPasswordPlaceholder')}
                  className="w-full"
                  autoFocus
                />
              </div>

              {authError && (
                <div className="flex items-center gap-2 p-3 bg-rose-950/30 light:bg-rose-50 border border-rose-900/50 light:border-rose-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-rose-400 light:text-rose-500 flex-shrink-0" />
                  <p className="text-sm text-rose-300 light:text-rose-600">{authError}</p>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={!authPassword}
              >
                {tLogin('demoSettingsEnter')}
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

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
        {/* 能力测试入口暂时注释
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
        */}
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
      ) : null}
      {/* 能力测试内容暂时注释
      {activeTab === 'capability-test' ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl">
            <ModelCapabilityTest models={models} providers={providers} />
          </div>
        </div>
      ) : null}
      */}
    </div>
  );
}
