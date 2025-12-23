import { useState } from 'react';
import { Database, Cloud, Server, ArrowRight, CheckCircle2, AlertCircle, Loader2, Copy, Check, FileText, TableProperties } from 'lucide-react';
import { Button, Input, useToast } from '../ui';
import { saveConfig, initializeDatabase, type DatabaseConfig } from '../../lib/database';
import { SUPABASE_INIT_SQL } from '../../lib/database/supabase-init-sql';
import { runPendingMigrations, getLatestVersion } from '../../lib/database/migrations';

interface SetupWizardProps {
  onComplete: () => void;
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const { showToast } = useToast();
  const [step, setStep] = useState<'choose' | 'supabase' | 'mysql'>('choose');
  const [testing, setTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [sqlCopied, setSqlCopied] = useState(false);
  const [initializing, setInitializing] = useState(false);

  // Supabase config
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');

  // MySQL config
  const [mysqlHost, setMysqlHost] = useState('');
  const [mysqlPort, setMysqlPort] = useState('3306');
  const [mysqlDatabase, setMysqlDatabase] = useState('');
  const [mysqlUser, setMysqlUser] = useState('');
  const [mysqlPassword, setMysqlPassword] = useState('');

  const handleTestSupabase = async () => {
    if (!supabaseUrl.trim() || !supabaseAnonKey.trim()) {
      showToast('error', '请填写完整的 Supabase 配置');
      return;
    }

    setTesting(true);
    setTestSuccess(false);

    try {
      const config: DatabaseConfig = {
        provider: 'supabase',
        supabase: {
          url: supabaseUrl,
          anonKey: supabaseAnonKey,
        },
      };

      const db = initializeDatabase(config);
      const result = await db.testConnection();

      if (result.success) {
        setTestSuccess(true);
        saveConfig(config);
        showToast('success', '连接成功！');
      } else {
        showToast('error', `连接失败: ${result.error}`);
      }
    } catch (e) {
      showToast('error', `连接测试异常: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    setTesting(false);
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(SUPABASE_INIT_SQL);
      setSqlCopied(true);
      showToast('success', 'SQL 已复制到剪贴板');
      setTimeout(() => setSqlCopied(false), 2000);
    } catch {
      showToast('error', '复制失败，请手动复制');
    }
  };

  const handleTestMySQL = async () => {
    if (!mysqlHost.trim() || !mysqlDatabase.trim() || !mysqlUser.trim()) {
      showToast('error', '请填写完整的 MySQL 配置');
      return;
    }

    setTesting(true);
    setTestSuccess(false);

    try {
      const config: DatabaseConfig = {
        provider: 'mysql',
        mysql: {
          host: mysqlHost,
          port: parseInt(mysqlPort) || 3306,
          database: mysqlDatabase,
          user: mysqlUser,
          password: mysqlPassword,
        },
      };

      const db = initializeDatabase(config);
      const result = await db.testConnection();

      if (result.success) {
        setTestSuccess(true);
        saveConfig(config);
        showToast('success', '连接成功！');
      } else {
        showToast('error', `连接失败: ${result.error}`);
      }
    } catch (e) {
      showToast('error', `连接测试异常: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    setTesting(false);
  };

  const handleInitializeMySQLTables = async () => {
    if (!testSuccess) {
      showToast('error', '请先测试连接成功后再初始化表结构');
      return;
    }

    setInitializing(true);

    try {
      const config: DatabaseConfig = {
        provider: 'mysql',
        mysql: {
          host: mysqlHost,
          port: parseInt(mysqlPort) || 3306,
          database: mysqlDatabase,
          user: mysqlUser,
          password: mysqlPassword,
        },
      };

      const db = initializeDatabase(config);
      // 使用迁移系统初始化表结构
      const result = await runPendingMigrations(db);

      if (result.success) {
        if (result.executedMigrations.length > 0) {
          showToast('success', `表结构初始化成功，当前版本: v${result.currentVersion}`);
        } else {
          showToast('success', '表结构已是最新版本');
        }
      } else {
        showToast('error', `初始化失败: ${result.error}`);
      }
    } catch (e) {
      showToast('error', `初始化异常: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    setInitializing(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 light:bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center mb-4">
            <Database className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white light:text-slate-900 mb-2">欢迎使用 SSRPrompt</h1>
          <p className="text-slate-400 light:text-slate-600">
            在开始之前，请先配置数据库连接
          </p>
        </div>

        {/* Choose Step */}
        {step === 'choose' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={() => setStep('supabase')}
                className="p-6 rounded-xl border-2 border-slate-700 light:border-slate-200 hover:border-cyan-500 light:hover:border-cyan-400 bg-slate-900/50 light:bg-white transition-all text-left group"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-cyan-500/10 light:bg-cyan-100 text-cyan-400 light:text-cyan-600 group-hover:bg-cyan-500/20 light:group-hover:bg-cyan-200 transition-colors">
                    <Cloud className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-semibold text-white light:text-slate-900">Supabase</p>
                    <p className="text-xs text-emerald-400 light:text-emerald-600">推荐</p>
                  </div>
                </div>
                <p className="text-sm text-slate-400 light:text-slate-600">
                  云端数据库，无需后端服务，免费额度充足，适合个人和小团队使用。
                </p>
                <div className="mt-4 flex items-center text-xs text-cyan-400 light:text-cyan-600">
                  <span>开始配置</span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </div>
              </button>

              <button
                onClick={() => setStep('mysql')}
                className="p-6 rounded-xl border-2 border-slate-700 light:border-slate-200 hover:border-cyan-500 light:hover:border-cyan-400 bg-slate-900/50 light:bg-white transition-all text-left group"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-slate-700 light:bg-slate-100 text-slate-400 light:text-slate-500 group-hover:bg-slate-600 light:group-hover:bg-slate-200 transition-colors">
                    <Server className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-semibold text-white light:text-slate-900">MySQL</p>
                    <p className="text-xs text-amber-400 light:text-amber-600">需要后端</p>
                  </div>
                </div>
                <p className="text-sm text-slate-400 light:text-slate-600">
                  自建数据库，需要部署后端代理服务，适合有开发经验的用户。
                </p>
                <div className="mt-4 flex items-center text-xs text-slate-500 light:text-slate-400">
                  <span>开始配置</span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </div>
              </button>
            </div>

            {/* 跳过按钮 */}
            <div className="text-center pt-4">
              <button
                onClick={onComplete}
                className="text-sm text-slate-500 light:text-slate-400 hover:text-slate-300 light:hover:text-slate-600 transition-colors"
              >
                跳过，稍后在设置中配置 →
              </button>
            </div>
          </div>
        )}

        {/* Supabase Step */}
        {step === 'supabase' && (
          <div className="bg-slate-900/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-xl p-6 space-y-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setStep('choose'); setTestSuccess(false); }}
                className="text-slate-400 hover:text-white light:hover:text-slate-900 transition-colors"
              >
                ← 返回
              </button>
              <h2 className="text-lg font-semibold text-white light:text-slate-900">配置 Supabase</h2>
            </div>

            <div className="p-4 bg-cyan-500/10 light:bg-cyan-50 border border-cyan-500/20 light:border-cyan-200 rounded-lg">
              <p className="text-sm text-cyan-400 light:text-cyan-700 mb-2">
                还没有 Supabase 项目？
              </p>
              <ol className="text-xs text-cyan-400/80 light:text-cyan-600 space-y-1 list-decimal list-inside">
                <li>访问 <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-cyan-300 light:hover:text-cyan-800">supabase.com</a> 注册账号</li>
                <li>创建新项目后，进入 Settings → API</li>
                <li>复制 Project URL 和 anon key</li>
              </ol>
            </div>

            {/* 初始化 SQL 复制区域 */}
            <div className="p-4 bg-slate-800/50 light:bg-slate-50 border border-slate-700 light:border-slate-200 rounded-lg">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-amber-500/10 light:bg-amber-100 text-amber-400 light:text-amber-600 mt-0.5">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white light:text-slate-900 mb-1">
                      初始化数据库表结构
                    </p>
                    <p className="text-xs text-slate-400 light:text-slate-600">
                      首次使用时，请在 Supabase Dashboard → SQL Editor 中执行初始化脚本
                    </p>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCopySql}
                  className="flex-shrink-0"
                >
                  {sqlCopied ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  <span>{sqlCopied ? '已复制' : '复制 SQL'}</span>
                </Button>
              </div>
            </div>

            <div className="space-y-4">
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
            </div>

            <div className="flex items-center gap-4">
              <Button
                onClick={handleTestSupabase}
                disabled={testing || !supabaseUrl || !supabaseAnonKey}
              >
                {testing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : testSuccess ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <Database className="w-4 h-4" />
                )}
                <span>{testing ? '测试中...' : testSuccess ? '连接成功' : '测试连接'}</span>
              </Button>

              {testSuccess && (
                <Button variant="secondary" onClick={onComplete}>
                  <span>进入应用</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              )}
            </div>

            {testSuccess && (
              <div className="p-3 bg-emerald-500/10 light:bg-emerald-50 border border-emerald-500/20 light:border-emerald-200 rounded-lg flex items-center gap-2 text-sm text-emerald-400 light:text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
                <span>配置已保存，您可以开始使用了！</span>
              </div>
            )}
          </div>
        )}

        {/* MySQL Step */}
        {step === 'mysql' && (
          <div className="bg-slate-900/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-xl p-6 space-y-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setStep('choose'); setTestSuccess(false); }}
                className="text-slate-400 hover:text-white light:hover:text-slate-900 transition-colors"
              >
                ← 返回
              </button>
              <h2 className="text-lg font-semibold text-white light:text-slate-900">配置 MySQL</h2>
            </div>

            <div className="p-4 bg-amber-500/10 light:bg-amber-50 border border-amber-500/20 light:border-amber-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 light:text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-400 light:text-amber-700 mb-1">
                    使用 MySQL 需要后端服务
                  </p>
                  <p className="text-xs text-amber-400/80 light:text-amber-600">
                    请参考项目 <code className="bg-amber-500/20 light:bg-amber-100 px-1 rounded">server/</code> 目录中的代码部署后端代理服务。
                    如果您没有后端开发经验，建议使用 Supabase。
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="主机地址"
                  value={mysqlHost}
                  onChange={(e) => setMysqlHost(e.target.value)}
                  placeholder="localhost"
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
                placeholder="ssrprompt"
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="用户名"
                  value={mysqlUser}
                  onChange={(e) => setMysqlUser(e.target.value)}
                  placeholder="root"
                />
                <Input
                  label="密码"
                  type="password"
                  value={mysqlPassword}
                  onChange={(e) => setMysqlPassword(e.target.value)}
                  placeholder="数据库密码"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Button
                  onClick={handleTestMySQL}
                  disabled={testing || !mysqlHost || !mysqlDatabase || !mysqlUser}
                >
                  {testing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : testSuccess ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Database className="w-4 h-4" />
                  )}
                  <span>{testing ? '测试中...' : testSuccess ? '连接成功' : '测试连接'}</span>
                </Button>

                <Button
                  variant="secondary"
                  onClick={handleInitializeMySQLTables}
                  disabled={initializing || !testSuccess}
                >
                  {initializing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <TableProperties className="w-4 h-4" />
                  )}
                  <span>{initializing ? '初始化中...' : '初始化表结构'}</span>
                </Button>

                {testSuccess && (
                  <Button variant="secondary" onClick={onComplete}>
                    <span>进入应用</span>
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
              </div>

              <p className="text-xs text-slate-500 light:text-slate-400">
                首次使用 MySQL 时需要初始化表结构。如果表已存在，此操作不会影响现有数据。
              </p>
            </div>

            {testSuccess && (
              <div className="p-3 bg-emerald-500/10 light:bg-emerald-50 border border-emerald-500/20 light:border-emerald-200 rounded-lg flex items-center gap-2 text-sm text-emerald-400 light:text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
                <span>配置已保存，您可以开始使用了！</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-slate-500 light:text-slate-400">
            配置将保存在浏览器本地存储中
          </p>
        </div>
      </div>
    </div>
  );
}
