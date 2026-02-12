import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/ui';
import { ThemeProvider } from './contexts';
import { ProtectedRoute, PublicRoute } from './components/Auth/ProtectedRoute';
import { DemoExpiredModal } from './components/Auth/DemoExpiredModal';
import { useAuthStore } from './store/useAuthStore';
import { resetUserSessionState } from './lib/session-reset';
import {
  SettingsPage,
  PromptsPage,
  EvaluationPage,
  TracesPage,
  HomePage,
  PromptWizardPage,
  PromptPlazaPage,
  SharePromptPage,
  ShareEvaluationPage,
  LoginPage,
  ForgotPasswordPage,
  OAuthCallbackPage,
  OAuthProviderCallbackProxyPage,
} from './pages';

/**
 * Main App Content - wrapped inside router
 */
function AppContent() {
  const { t } = useTranslation('nav');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const { isLoading, logout, initialize, isDemo, checkDemoExpiry, user } = useAuthStore();
  const [showDemoExpired, setShowDemoExpired] = useState(false);
  const userId = user?.id ?? null;
  const previousUserIdRef = useRef<string | null | undefined>(undefined);

  // Initialize auth on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  useLayoutEffect(() => {
    if (previousUserIdRef.current === undefined) {
      previousUserIdRef.current = userId;
      return;
    }

    if (previousUserIdRef.current !== userId) {
      resetUserSessionState();
    }

    previousUserIdRef.current = userId;
  }, [userId]);

  // Check demo expiry
  useEffect(() => {
    if (!isDemo) return;

    const check = () => {
      const { expired } = checkDemoExpiry();
      if (expired) setShowDemoExpired(true);
    };

    check();
    const interval = setInterval(check, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [isDemo, checkDemoExpiry]);

  // Handle logout
  const handleLogout = async () => {
    await logout();
    resetUserSessionState();
    navigate('/login');
  };

  // Loading screen
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <div className="text-slate-400">{tCommon('loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      {showDemoExpired && <DemoExpiredModal onClose={() => setShowDemoExpired(false)} />}
      <Routes>
      {/* Public routes */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicRoute>
            <ForgotPasswordPage />
          </PublicRoute>
        }
      />
      <Route
        path="/oauth/callback"
        element={
          <PublicRoute>
            <OAuthCallbackPage />
          </PublicRoute>
        }
      />
      <Route path="/api/v1/auth/oauth/:provider/callback" element={<OAuthProviderCallbackProxyPage />} />

      <Route
        path="/share/p/:token"
        element={
          <ProtectedRoute>
            <SharePromptPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/share/e/:token"
        element={
          <ProtectedRoute>
            <ShareEvaluationPage />
          </ProtectedRoute>
        }
      />

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout
              currentPage="home"
              onNavigate={(page) => navigate(`/${page === 'home' ? '' : page}`)}
              title={t('home')}
              onLogout={handleLogout}
            >
              <HomePage onNavigate={(page) => navigate(`/${page === 'home' ? '' : page}`)} />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/wizard"
        element={
          <ProtectedRoute>
            <Layout
              currentPage="wizard"
              onNavigate={(page) => navigate(`/${page === 'home' ? '' : page}`)}
              title={t('wizard')}
              onLogout={handleLogout}
            >
              <PromptWizardPage onNavigate={(page) => navigate(`/${page === 'home' ? '' : page}`)} />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/plaza"
        element={
          <ProtectedRoute>
            <Layout
              currentPage="plaza"
              onNavigate={(page) => navigate(`/${page === 'home' ? '' : page}`)}
              title={t('plaza')}
              onLogout={handleLogout}
            >
              <PromptPlazaPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/prompts"
        element={
          <ProtectedRoute>
            <Layout
              currentPage="prompts"
              onNavigate={(page) => navigate(`/${page === 'home' ? '' : page}`)}
              title={t('prompts')}
              onLogout={handleLogout}
            >
              <PromptsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/evaluation"
        element={
          <ProtectedRoute>
            <Layout
              currentPage="evaluation"
              onNavigate={(page) => navigate(`/${page === 'home' ? '' : page}`)}
              title={t('evaluation')}
              onLogout={handleLogout}
            >
              <EvaluationPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/traces"
        element={
          <ProtectedRoute>
            <Layout
              currentPage="traces"
              onNavigate={(page) => navigate(`/${page === 'home' ? '' : page}`)}
              title={t('traces')}
              onLogout={handleLogout}
            >
              <TracesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Layout
              currentPage="settings"
              onNavigate={(page) => navigate(`/${page === 'home' ? '' : page}`)}
              title={t('settings')}
              onLogout={handleLogout}
            >
              <SettingsPage />
            </Layout>
          </ProtectedRoute>
        }
      />

      {/* Catch all - redirect to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}

/**
 * App Component - entry point
 */
function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
