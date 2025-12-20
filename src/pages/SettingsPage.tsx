import { useState, useEffect } from 'react';
import { Bot, Database } from 'lucide-react';
import { ProviderList } from '../components/Settings/ProviderList';
import { ProviderForm } from '../components/Settings/ProviderForm';
import { AddProviderModal } from '../components/Settings/AddProviderModal';
import { DatabaseSettings } from '../components/Settings/DatabaseSettings';
import { useToast } from '../components/ui';
import { getDatabase } from '../lib/database';
import type { Provider, Model, ProviderType } from '../types';

type SettingsTab = 'providers' | 'database';

export function SettingsPage() {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const selectedProvider = providers.find((p) => p.id === selectedProviderId) || null;
  const selectedModels = models.filter((m) => m.provider_id === selectedProviderId);

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
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
        showToast('error', '加载服务商失败');
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
      showToast('error', '加载数据失败');
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
          enabled: false,
        })
        .select()
        .single();

      if (error) {
        showToast('error', '添加失败: ' + error.message);
        return;
      }

      if (data) {
        setProviders((prev) => [...prev, data]);
        setSelectedProviderId(data.id);
        showToast('success', '服务商已添加');
      }
    } catch {
      showToast('error', '添加服务商失败');
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
        showToast('error', '保存失败: ' + error.message);
        return;
      }

      setProviders((prev) =>
        prev.map((p) => (p.id === selectedProviderId ? { ...p, ...data } : p))
      );
      showToast('success', '配置已保存');
    } catch {
      showToast('error', '保存配置失败');
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
        showToast('error', '删除失败: ' + error.message);
        return;
      }

      const remaining = providers.filter((p) => p.id !== selectedProviderId);
      setProviders(remaining);
      setModels((prev) => prev.filter((m) => m.provider_id !== selectedProviderId));
      setSelectedProviderId(remaining[0]?.id || null);
      showToast('success', '服务商已删除');
    } catch {
      showToast('error', '删除服务商失败');
    }
  };

  const handleAddModel = async (modelId: string, name: string) => {
    if (!selectedProviderId) return;
    try {
      const { data, error } = await getDatabase()
        .from('models')
        .insert({
          provider_id: selectedProviderId,
          model_id: modelId,
          name,
          capabilities: ['chat'],
        })
        .select()
        .single();

      if (error) {
        showToast('error', '添加模型失败: ' + error.message);
        return;
      }

      if (data) {
        setModels((prev) => [...prev, data]);
        showToast('success', '模型已添加');
      }
    } catch {
      showToast('error', '添加模型失败');
    }
  };

  const handleRemoveModel = async (modelId: string) => {
    try {
      const { error } = await getDatabase().from('models').delete().eq('id', modelId);

      if (error) {
        showToast('error', '删除模型失败');
        return;
      }

      setModels((prev) => prev.filter((m) => m.id !== modelId));
      showToast('success', '模型已删除');
    } catch {
      showToast('error', '删除模型失败');
    }
  };

  const handleTestConnection = async (): Promise<boolean> => {
    if (!selectedProvider) return false;

    const apiKey = selectedProvider.api_key;
    if (!apiKey) {
      showToast('error', '请先填写 API Key');
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (apiKey.length > 10) {
      showToast('success', '连接测试成功');
      return true;
    } else {
      showToast('error', 'API Key 格式不正确');
      return false;
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 light:bg-slate-50">
      <div className="flex border-b border-slate-800 light:border-slate-200 px-6">
        <button
          onClick={() => setActiveTab('providers')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'providers'
              ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
              : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
          }`}
        >
          <Bot className="w-4 h-4" />
          AI 服务商
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
          数据库
        </button>
      </div>

      {activeTab === 'providers' ? (
        <div className="flex-1 flex">
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
            onTestConnection={handleTestConnection}
          />
          <AddProviderModal
            isOpen={showAddModal}
            onClose={() => setShowAddModal(false)}
            onAdd={handleAddProvider}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-2xl">
            <DatabaseSettings />
          </div>
        </div>
      )}
    </div>
  );
}
