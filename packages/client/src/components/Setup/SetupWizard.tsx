import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('setup');
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
      showToast('error', t('fillSupabaseConfig'));
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
        showToast('success', t('connectionSuccessToast'));
      } else {
        showToast('error', `${t('connectionFailed')}: ${result.error}`);
      }
    } catch (e) {
      showToast('error', `${t('connectionTestError')}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    setTesting(false);
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(SUPABASE_INIT_SQL);
      setSqlCopied(true);
      showToast('success', t('sqlCopiedToast'));
      setTimeout(() => setSqlCopied(false), 2000);
    } catch {
      showToast('error', t('copyFailedManual'));
    }
  };

  const handleTestMySQL = async () => {
    if (!mysqlHost.trim() || !mysqlDatabase.trim() || !mysqlUser.trim()) {
      showToast('error', t('fillMySQLConfig'));
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
        showToast('success', t('connectionSuccessToast'));
      } else {
        showToast('error', `${t('connectionFailed')}: ${result.error}`);
      }
    } catch (e) {
      showToast('error', `${t('connectionTestError')}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    setTesting(false);
  };

  const handleInitializeMySQLTables = async () => {
    if (!testSuccess) {
      showToast('error', t('testConnectionFirst'));
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
          showToast('success', `${t('schemaInitSuccess')}: v${result.currentVersion}`);
        } else {
          showToast('success', t('schemaAlreadyLatest'));
        }
      } else {
        showToast('error', `${t('initFailed')}: ${result.error}`);
      }
    } catch (e) {
      showToast('error', `${t('initError')}: ${e instanceof Error ? e.message : 'Unknown error'}`);
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
          <h1 className="text-2xl font-bold text-white light:text-slate-900 mb-2">{t('welcomeTitle')}</h1>
          <p className="text-slate-400 light:text-slate-600">
            {t('welcomeDescription')}
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
                    <p className="text-xs text-emerald-400 light:text-emerald-600">{t('recommended')}</p>
                  </div>
                </div>
                <p className="text-sm text-slate-400 light:text-slate-600">
                  {t('supabaseDescription')}
                </p>
                <div className="mt-4 flex items-center text-xs text-cyan-400 light:text-cyan-600">
                  <span>{t('startConfig')}</span>
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
                    <p className="text-xs text-amber-400 light:text-amber-600">{t('requiresBackend')}</p>
                  </div>
                </div>
                <p className="text-sm text-slate-400 light:text-slate-600">
                  {t('mysqlDescription')}
                </p>
                <div className="mt-4 flex items-center text-xs text-slate-500 light:text-slate-400">
                  <span>{t('startConfig')}</span>
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
                {t('skipSetup')}
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
                {t('back')}
              </button>
              <h2 className="text-lg font-semibold text-white light:text-slate-900">{t('configureSupabase')}</h2>
            </div>

            <div className="p-4 bg-cyan-500/10 light:bg-cyan-50 border border-cyan-500/20 light:border-cyan-200 rounded-lg">
              <p className="text-sm text-cyan-400 light:text-cyan-700 mb-2">
                {t('noSupabaseProject')}
              </p>
              <ol className="text-xs text-cyan-400/80 light:text-cyan-600 space-y-1 list-decimal list-inside">
                <li>{t('supabaseStep1')}</li>
                <li>{t('supabaseStep2')}</li>
                <li>{t('supabaseStep3')}</li>
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
                      {t('initDatabaseSchema')}
                    </p>
                    <p className="text-xs text-slate-400 light:text-slate-600">
                      {t('initSchemaDescription')}
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
                  <span>{sqlCopied ? t('copied') : t('copySql')}</span>
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
                label={t('anonKeyLabel')}
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
                <span>{testing ? t('testing') : testSuccess ? t('connectionSuccess') : t('testConnection')}</span>
              </Button>

              {testSuccess && (
                <Button variant="secondary" onClick={onComplete}>
                  <span>{t('enterApp')}</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              )}
            </div>

            {testSuccess && (
              <div className="p-3 bg-emerald-500/10 light:bg-emerald-50 border border-emerald-500/20 light:border-emerald-200 rounded-lg flex items-center gap-2 text-sm text-emerald-400 light:text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
                <span>{t('configSavedSuccess')}</span>
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
                {t('back')}
              </button>
              <h2 className="text-lg font-semibold text-white light:text-slate-900">{t('configureMySQL')}</h2>
            </div>

            <div className="p-4 bg-amber-500/10 light:bg-amber-50 border border-amber-500/20 light:border-amber-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 light:text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-400 light:text-amber-700 mb-1">
                    {t('mysqlRequiresBackend')}
                  </p>
                  <p className="text-xs text-amber-400/80 light:text-amber-600">
                    {t('mysqlBackendDescription')}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={t('hostAddress')}
                  value={mysqlHost}
                  onChange={(e) => setMysqlHost(e.target.value)}
                  placeholder="localhost"
                />
                <Input
                  label={t('port')}
                  value={mysqlPort}
                  onChange={(e) => setMysqlPort(e.target.value)}
                  placeholder="3306"
                />
              </div>
              <Input
                label={t('databaseName')}
                value={mysqlDatabase}
                onChange={(e) => setMysqlDatabase(e.target.value)}
                placeholder="ssrprompt"
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={t('username')}
                  value={mysqlUser}
                  onChange={(e) => setMysqlUser(e.target.value)}
                  placeholder="root"
                />
                <Input
                  label={t('password')}
                  type="password"
                  value={mysqlPassword}
                  onChange={(e) => setMysqlPassword(e.target.value)}
                  placeholder={t('passwordPlaceholder')}
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
                  <span>{testing ? t('testing') : testSuccess ? t('connectionSuccess') : t('testConnection')}</span>
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
                  <span>{initializing ? t('initializing') : t('initSchema')}</span>
                </Button>

                {testSuccess && (
                  <Button variant="secondary" onClick={onComplete}>
                    <span>{t('enterApp')}</span>
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
              </div>

              <p className="text-xs text-slate-500 light:text-slate-400">
                {t('mysqlInitNote')}
              </p>
            </div>

            {testSuccess && (
              <div className="p-3 bg-emerald-500/10 light:bg-emerald-50 border border-emerald-500/20 light:border-emerald-200 rounded-lg flex items-center gap-2 text-sm text-emerald-400 light:text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
                <span>{t('configSavedSuccess')}</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-slate-500 light:text-slate-400">
            {t('configSavedLocally')}
          </p>
        </div>
      </div>
    </div>
  );
}
