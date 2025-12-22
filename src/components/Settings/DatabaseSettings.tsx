import { useState, useEffect } from 'react';
import { Database, Server, CheckCircle2, XCircle, Loader2, RefreshCw, Cloud, TableProperties } from 'lucide-react';
import { Button, Input, useToast } from '../ui';
import {
  getStoredConfig,
  saveConfig,
  initializeDatabase,
  type DatabaseConfig,
  type DatabaseProvider,
} from '../../lib/database';
import { SupabaseInitModal } from './SupabaseInitModal';

export function DatabaseSettings() {
  const { showToast } = useToast();
  const [config, setConfig] = useState<DatabaseConfig>(getStoredConfig());
  const [testing, setTesting] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [showInitModal, setShowInitModal] = useState(false);

  // MySQL 配置状态
  const [mysqlHost, setMysqlHost] = useState(config.mysql?.host || '');
  const [mysqlPort, setMysqlPort] = useState(config.mysql?.port?.toString() || '3306');
  const [mysqlDatabase, setMysqlDatabase] = useState(config.mysql?.database || '');
  const [mysqlUser, setMysqlUser] = useState(config.mysql?.user || '');
  const [mysqlPassword, setMysqlPassword] = useState(config.mysql?.password || '');

  // Supabase 配置状态
  const [supabaseUrl, setSupabaseUrl] = useState(config.supabase?.url || '');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(config.supabase?.anonKey || '');

  useEffect(() => {
    const stored = getStoredConfig();
    setConfig(stored);
    if (stored.mysql) {
      setMysqlHost(stored.mysql.host);
      setMysqlPort(stored.mysql.port.toString());
      setMysqlDatabase(stored.mysql.database);
      setMysqlUser(stored.mysql.user);
      setMysqlPassword(stored.mysql.password);
    }
    if (stored.supabase) {
      setSupabaseUrl(stored.supabase.url);
      setSupabaseAnonKey(stored.supabase.anonKey);
    }
  }, []);

  const handleProviderChange = (provider: DatabaseProvider) => {
    setConfig((prev) => ({ ...prev, provider }));
    setConnectionStatus('idle');
  };

  const buildMySQLConfig = (): DatabaseConfig => ({
    provider: 'mysql',
    mysql: {
      host: mysqlHost,
      port: parseInt(mysqlPort) || 3306,
      database: mysqlDatabase,
      user: mysqlUser,
      password: mysqlPassword,
    },
  });

  const buildSupabaseConfig = (): DatabaseConfig => ({
    provider: 'supabase',
    supabase: {
      url: supabaseUrl,
      anonKey: supabaseAnonKey,
    },
  });

  const handleTestConnection = async () => {
    setTesting(true);
    setConnectionStatus('idle');

    try {
      let testConfig: DatabaseConfig;
      if (config.provider === 'mysql') {
        testConfig = buildMySQLConfig();
      } else {
        testConfig = buildSupabaseConfig();
      }

      const db = initializeDatabase(testConfig);
      const result = await db.testConnection();

      if (result.success) {
        setConnectionStatus('success');
        showToast('success', '数据库连接测试成功');
      } else {
        setConnectionStatus('error');
        showToast('error', `连接失败: ${result.error}`);
      }
    } catch (e) {
      setConnectionStatus('error');
      showToast('error', `连接测试异常: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    setTesting(false);
  };

  const handleInitializeTables = async () => {
    if (config.provider !== 'mysql') {
      showToast('info', 'Supabase 表结构已通过迁移自动管理');
      return;
    }

    setInitializing(true);

    try {
      const mysqlConfig = buildMySQLConfig();
      const db = initializeDatabase(mysqlConfig);
      const result = await db.initialize();

      if (result.success) {
        showToast('success', '表结构初始化成功');
      } else {
        showToast('error', `初始化失败: ${result.error}`);
      }
    } catch (e) {
      showToast('error', `初始化异常: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    setInitializing(false);
  };

  const handleSave = () => {
    // 同时保存两种数据库的配置，这样切换时不会丢失
    const newConfig: DatabaseConfig = {
      provider: config.provider,
      mysql: {
        host: mysqlHost,
        port: parseInt(mysqlPort) || 3306,
        database: mysqlDatabase,
        user: mysqlUser,
        password: mysqlPassword,
      },
      supabase: {
        url: supabaseUrl,
        anonKey: supabaseAnonKey,
      },
    };

    const currentConfig = getStoredConfig();
    const hasChanged = JSON.stringify(currentConfig) !== JSON.stringify(newConfig);

    saveConfig(newConfig);
    initializeDatabase(newConfig);

    if (hasChanged) {
      showToast('success', '数据库配置已保存，页面即将刷新...');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } else {
      showToast('success', '数据库配置已保存');
    }
  };

  // 检查 Supabase 配置是否完整
  const isSupabaseConfigValid = supabaseUrl.trim() !== '' && supabaseAnonKey.trim() !== '';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-700 light:border-slate-200">
        <div className="p-2 bg-cyan-500/10 light:bg-cyan-100 rounded-lg">
          <Database className="w-5 h-5 text-cyan-500 light:text-cyan-600" />
        </div>
        <div>
          <h3 className="text-lg font-medium text-slate-200 light:text-slate-800">数据库配置</h3>
          <p className="text-sm text-slate-500 light:text-slate-600">选择并配置数据存储方式</p>
        </div>
      </div>

      <div className="space-y-4">
        <label className="block text-sm font-medium text-slate-300 light:text-slate-700">数据库类型</label>
        <div className="p-3 bg-amber-500/10 light:bg-amber-50 border border-amber-500/20 light:border-amber-200 rounded-lg">
          <p className="text-sm text-amber-400 light:text-amber-700">
            不同数据库的数据是完全隔离的。切换数据库后，您将看到该数据库中的数据。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => handleProviderChange('supabase')}
            className={`p-4 rounded-lg border-2 transition-all text-left ${
              config.provider === 'supabase'
                ? 'border-cyan-500 bg-cyan-500/10 light:bg-cyan-50'
                : 'border-slate-700 light:border-slate-200 hover:border-slate-600 light:hover:border-slate-300 bg-slate-800/30 light:bg-white'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${config.provider === 'supabase' ? 'bg-cyan-500/20 light:bg-cyan-100' : 'bg-slate-700 light:bg-slate-100'}`}>
                <Cloud className={`w-5 h-5 ${config.provider === 'supabase' ? 'text-cyan-400 light:text-cyan-600' : 'text-slate-400 light:text-slate-500'}`} />
              </div>
              <div>
                <p className={`font-medium ${config.provider === 'supabase' ? 'text-cyan-400 light:text-cyan-600' : 'text-slate-300 light:text-slate-700'}`}>
                  Supabase
                </p>
                <p className="text-xs text-slate-500 light:text-slate-600">云端数据库</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => handleProviderChange('mysql')}
            className={`p-4 rounded-lg border-2 transition-all text-left ${
              config.provider === 'mysql'
                ? 'border-cyan-500 bg-cyan-500/10 light:bg-cyan-50'
                : 'border-slate-700 light:border-slate-200 hover:border-slate-600 light:hover:border-slate-300 bg-slate-800/30 light:bg-white'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${config.provider === 'mysql' ? 'bg-cyan-500/20 light:bg-cyan-100' : 'bg-slate-700 light:bg-slate-100'}`}>
                <Server className={`w-5 h-5 ${config.provider === 'mysql' ? 'text-cyan-400 light:text-cyan-600' : 'text-slate-400 light:text-slate-500'}`} />
              </div>
              <div>
                <p className={`font-medium ${config.provider === 'mysql' ? 'text-cyan-400 light:text-cyan-600' : 'text-slate-300 light:text-slate-700'}`}>
                  MySQL
                </p>
                <p className="text-xs text-slate-500 light:text-slate-600">自建数据库</p>
              </div>
            </div>
          </button>
        </div>
      </div>

      {config.provider === 'supabase' && (
        <div className="space-y-4 p-4 bg-slate-800/30 light:bg-slate-50 rounded-lg border border-slate-700 light:border-slate-200">
          <div className="flex items-start gap-3 pb-4 border-b border-slate-700 light:border-slate-200">
            <Cloud className="w-5 h-5 text-cyan-500 light:text-cyan-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-200 light:text-slate-800">Supabase 连接配置</p>
              <p className="text-xs text-slate-500 light:text-slate-600 mt-1">
                在 <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="text-cyan-500 hover:underline">supabase.com</a> 创建项目后，从 Settings &gt; API 获取连接信息
              </p>
            </div>
          </div>

          <Input
            label="Project URL"
            value={supabaseUrl}
            onChange={(e) => setSupabaseUrl(e.target.value)}
            placeholder="https://xxxxx.supabase.co"
          />
          <Input
            label="Anon Key (公开密钥)"
            type="password"
            value={supabaseAnonKey}
            onChange={(e) => setSupabaseAnonKey(e.target.value)}
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          />

          <div className="pt-4 border-t border-slate-700 light:border-slate-200 space-y-3">
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={handleTestConnection}
                disabled={testing || !isSupabaseConfigValid}
              >
                {testing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span>测试连接</span>
              </Button>

              <Button
                variant="secondary"
                onClick={() => setShowInitModal(true)}
                disabled={!isSupabaseConfigValid}
              >
                <TableProperties className="w-4 h-4" />
                <span>初始化表结构</span>
              </Button>

              {connectionStatus === 'success' && (
                <span className="flex items-center gap-1 text-sm text-emerald-500 light:text-emerald-600">
                  <CheckCircle2 className="w-4 h-4" />
                  连接成功
                </span>
              )}
              {connectionStatus === 'error' && (
                <span className="flex items-center gap-1 text-sm text-rose-500 light:text-rose-600">
                  <XCircle className="w-4 h-4" />
                  连接失败
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500 light:text-slate-600">
              首次使用 Supabase 时，请点击"初始化表结构"按钮获取建表 SQL
            </p>
          </div>
        </div>
      )}

      {config.provider === 'mysql' && (
        <div className="space-y-4 p-4 bg-slate-800/30 light:bg-slate-50 rounded-lg border border-slate-700 light:border-slate-200">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="主机地址"
              value={mysqlHost}
              onChange={(e) => setMysqlHost(e.target.value)}
              placeholder="localhost 或 IP 地址"
            />
            <Input
              label="端口"
              value={mysqlPort}
              onChange={(e) => setMysqlPort(e.target.value)}
              placeholder="3306"
            />
          </div>
          <Input
            label="数据库名"
            value={mysqlDatabase}
            onChange={(e) => setMysqlDatabase(e.target.value)}
            placeholder="数据库名称"
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="用户名"
              value={mysqlUser}
              onChange={(e) => setMysqlUser(e.target.value)}
              placeholder="数据库用户名"
            />
            <Input
              label="密码"
              type="password"
              value={mysqlPassword}
              onChange={(e) => setMysqlPassword(e.target.value)}
              placeholder="数据库密码"
            />
          </div>

          <div className="pt-4 border-t border-slate-700 light:border-slate-200 space-y-3">
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={handleTestConnection}
                disabled={testing || !mysqlHost || !mysqlDatabase || !mysqlUser}
              >
                {testing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span>测试连接</span>
              </Button>

              {connectionStatus === 'success' && (
                <span className="flex items-center gap-1 text-sm text-emerald-500 light:text-emerald-600">
                  <CheckCircle2 className="w-4 h-4" />
                  连接成功
                </span>
              )}
              {connectionStatus === 'error' && (
                <span className="flex items-center gap-1 text-sm text-rose-500 light:text-rose-600">
                  <XCircle className="w-4 h-4" />
                  连接失败
                </span>
              )}
            </div>

            <Button
              variant="secondary"
              onClick={handleInitializeTables}
              disabled={initializing || connectionStatus !== 'success'}
            >
              {initializing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Database className="w-4 h-4" />
              )}
              <span>初始化表结构</span>
            </Button>
            <p className="text-xs text-slate-500 light:text-slate-600">
              首次使用 MySQL 时需要初始化表结构。如果表已存在,此操作不会影响现有数据。
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end pt-4 border-t border-slate-700 light:border-slate-200">
        <Button onClick={handleSave}>
          保存配置
        </Button>
      </div>

      {/* Supabase 初始化模态框 */}
      <SupabaseInitModal
        isOpen={showInitModal}
        onClose={() => setShowInitModal(false)}
        supabaseUrl={supabaseUrl}
      />
    </div>
  );
}
