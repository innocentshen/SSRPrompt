import { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/ui';
import { ThemeProvider } from './contexts';
import { SettingsPage, PromptsPage, EvaluationPage, TracesPage } from './pages';
import { LoginPage } from './pages/LoginPage';

const pageTitles: Record<string, string> = {
  prompts: 'Prompt 开发',
  evaluation: '评测中心',
  traces: '观测',
  settings: '设置',
};

const AUTH_KEY = 'ai_compass_auth';

function App() {
  const [currentPage, setCurrentPage] = useState('prompts');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    const storedAuth = localStorage.getItem(AUTH_KEY);
    if (storedAuth === import.meta.env.VITE_APP_PASSWORD) {
      setIsAuthenticated(true);
    }
    setIsCheckingAuth(false);
  }, []);

  const handleLogin = (password: string) => {
    localStorage.setItem(AUTH_KEY, password);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem(AUTH_KEY);
    setIsAuthenticated(false);
    setCurrentPage('prompts');
  };

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400">加载中...</div>
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

  const renderPage = () => {
    switch (currentPage) {
      case 'prompts':
        return <PromptsPage />;
      case 'evaluation':
        return <EvaluationPage />;
      case 'traces':
        return <TracesPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <PromptsPage />;
    }
  };

  return (
    <ThemeProvider>
      <ToastProvider>
        <Layout
          currentPage={currentPage}
          onNavigate={setCurrentPage}
          title={pageTitles[currentPage]}
          onLogout={handleLogout}
        >
          {renderPage()}
        </Layout>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
