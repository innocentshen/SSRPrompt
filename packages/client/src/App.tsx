import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/ui';
import { ThemeProvider } from './contexts';
import { SettingsPage, PromptsPage, EvaluationPage, TracesPage, HomePage, PromptWizardPage } from './pages';
import { LoginPage } from './pages/LoginPage';
import { SetupWizard } from './components/Setup';
import { getStoredConfig, initializeDatabase, saveConfig } from './lib/database';
import { getTenantType, clearTenantType, isDemoMode, getDemoDbConfig, type TenantType } from './lib/tenant';

const AUTH_KEY = 'ai_compass_auth';

function App() {
  const { t } = useTranslation('nav');
  const { t: tCommon } = useTranslation('common');
  const [currentPage, setCurrentPage] = useState('home');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [isCheckingDb, setIsCheckingDb] = useState(true);

  // 页面名称映射到 i18n key
  const getPageTitle = (page: string) => {
    const titleMap: Record<string, string> = {
      home: t('home'),
      wizard: t('wizard'),
      prompts: t('prompts'),
      evaluation: t('evaluation'),
      traces: t('traces'),
      settings: t('settings'),
    };
    return titleMap[page] || t('home');
  };

  useEffect(() => {
    const storedAuth = localStorage.getItem(AUTH_KEY);
    const tenantType = getTenantType();

    // 需要同时有认证和租户类型才算已登录
    if (storedAuth === import.meta.env.VITE_APP_PASSWORD && tenantType) {
      setIsAuthenticated(true);
    }
    setIsCheckingAuth(false);
  }, []);

  useEffect(() => {
    const checkDatabaseConfig = async () => {
      const tenantType = getTenantType();

      // Demo 模式：使用环境变量配置
      if (tenantType === 'demo') {
        try {
          const demoConfig = getDemoDbConfig();
          // 保存 demo 配置到 localStorage（让其他地方可以读取）
          saveConfig(demoConfig);
          const db = initializeDatabase(demoConfig);
          const result = await db.testConnection();
          if (!result.success) {
            // Demo 数据库连接失败，回退到个人空间流程
            console.error('Demo database connection failed:', result.error);
            setNeedsSetup(true);
          }
        } catch (error) {
          console.error('Demo database initialization failed:', error);
          setNeedsSetup(true);
        }
        setIsCheckingDb(false);
        return;
      }

      // 个人空间：检查用户配置的数据库
      const config = getStoredConfig();

      // Check if configuration is incomplete
      if (config.provider === 'supabase') {
        // Check if Supabase is configured via stored config or env vars
        const hasStoredConfig = config.supabase?.url && config.supabase?.anonKey;
        const hasEnvConfig = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY;

        if (!hasStoredConfig && !hasEnvConfig) {
          setNeedsSetup(true);
          setIsCheckingDb(false);
          return;
        }
      } else if (config.provider === 'mysql') {
        if (!config.mysql?.host || !config.mysql?.database) {
          setNeedsSetup(true);
          setIsCheckingDb(false);
          return;
        }
      }

      // Try to test the connection
      try {
        const db = initializeDatabase(config);
        const result = await db.testConnection();
        if (!result.success) {
          setNeedsSetup(true);
        }
      } catch {
        setNeedsSetup(true);
      }

      setIsCheckingDb(false);
    };

    if (isAuthenticated) {
      checkDatabaseConfig();
    } else {
      setIsCheckingDb(false);
    }
  }, [isAuthenticated]);

  const handleLogin = (password: string, _tenant: TenantType) => {
    localStorage.setItem(AUTH_KEY, password);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem(AUTH_KEY);
    clearTenantType(); // 清除租户类型
    setIsAuthenticated(false);
    setNeedsSetup(false);
    setCurrentPage('home');
  };

  const handleSetupComplete = () => {
    setNeedsSetup(false);
    // Reinitialize database with new config
    initializeDatabase();
  };

  if (isCheckingAuth || isCheckingDb) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400">{tCommon('loading')}</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <ThemeProvider>
        <ToastProvider>
          <LoginPage onLogin={handleLogin} />
        </ToastProvider>
      </ThemeProvider>
    );
  }

  // 只有个人空间才需要 SetupWizard
  if (needsSetup && !isDemoMode()) {
    return (
      <ThemeProvider>
        <ToastProvider>
          <SetupWizard onComplete={handleSetupComplete} />
        </ToastProvider>
      </ThemeProvider>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage onNavigate={setCurrentPage} />;
      case 'wizard':
        return <PromptWizardPage onNavigate={setCurrentPage} />;
      case 'prompts':
        return <PromptsPage />;
      case 'evaluation':
        return <EvaluationPage />;
      case 'traces':
        return <TracesPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <HomePage onNavigate={setCurrentPage} />;
    }
  };

  return (
    <ThemeProvider>
      <ToastProvider>
        <Layout
          currentPage={currentPage}
          onNavigate={setCurrentPage}
          title={getPageTitle(currentPage)}
          onLogout={handleLogout}
        >
          {renderPage()}
        </Layout>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
