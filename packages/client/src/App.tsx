import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/ui';
import { ThemeProvider } from './contexts';
import { ProtectedRoute, PublicRoute } from './components/Auth/ProtectedRoute';
import { DemoExpiredModal } from './components/Auth/DemoExpiredModal';
import { useAuthStore } from './store/useAuthStore';
import { resetUserSessionState } from './lib/session-reset';

const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const PromptsPage = lazy(() => import('./pages/PromptsPage').then((module) => ({ default: module.PromptsPage })));
const EvaluationPage = lazy(() => import('./pages/EvaluationPage').then((module) => ({ default: module.EvaluationPage })));
const TracesPage = lazy(() => import('./pages/TracesPage').then((module) => ({ default: module.TracesPage })));
const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })));
const PromptWizardPage = lazy(() => import('./pages/PromptWizardPage').then((module) => ({ default: module.PromptWizardPage })));
const PromptPlazaPage = lazy(() => import('./pages/PromptPlazaPage').then((module) => ({ default: module.PromptPlazaPage })));
const SharePromptPage = lazy(() => import('./pages/SharePromptPage').then((module) => ({ default: module.SharePromptPage })));
const ShareEvaluationPage = lazy(() => import('./pages/ShareEvaluationPage').then((module) => ({ default: module.ShareEvaluationPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then((module) => ({ default: module.ForgotPasswordPage })));
const OAuthCallbackPage = lazy(() => import('./pages/OAuthCallbackPage').then((module) => ({ default: module.OAuthCallbackPage })));
const OAuthProviderCallbackProxyPage = lazy(() =>
  import('./pages/OAuthProviderCallbackProxyPage').then((module) => ({ default: module.OAuthProviderCallbackProxyPage }))
);

type AppLayoutRouteProps = {
  children: ReactNode;
  currentPage: string;
  title: string;
  onNavigate: (page: string) => void;
  onLogout: () => Promise<void>;
};

function AppLayoutRoute({ children, currentPage, title, onNavigate, onLogout }: AppLayoutRouteProps) {
  return (
    <Layout currentPage={currentPage} onNavigate={onNavigate} title={title} onLogout={onLogout}>
      {children}
    </Layout>
  );
}

function PageFallback() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
      </div>
    </div>
  );
}

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
  const handleNavigate = (page: string) => {
    navigate(`/${page === 'home' ? '' : page}`);
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
      <Suspense fallback={<PageFallback />}>
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
                <AppLayoutRoute currentPage="home" onNavigate={handleNavigate} title={t('home')} onLogout={handleLogout}>
                  <HomePage onNavigate={handleNavigate} />
                </AppLayoutRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/wizard"
            element={
              <ProtectedRoute>
                <AppLayoutRoute currentPage="wizard" onNavigate={handleNavigate} title={t('wizard')} onLogout={handleLogout}>
                  <PromptWizardPage onNavigate={handleNavigate} />
                </AppLayoutRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/plaza"
            element={
              <ProtectedRoute>
                <AppLayoutRoute currentPage="plaza" onNavigate={handleNavigate} title={t('plaza')} onLogout={handleLogout}>
                  <PromptPlazaPage />
                </AppLayoutRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/prompts"
            element={
              <ProtectedRoute>
                <AppLayoutRoute currentPage="prompts" onNavigate={handleNavigate} title={t('prompts')} onLogout={handleLogout}>
                  <PromptsPage />
                </AppLayoutRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/evaluation"
            element={
              <ProtectedRoute>
                <AppLayoutRoute currentPage="evaluation" onNavigate={handleNavigate} title={t('evaluation')} onLogout={handleLogout}>
                  <EvaluationPage />
                </AppLayoutRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/traces"
            element={
              <ProtectedRoute>
                <AppLayoutRoute currentPage="traces" onNavigate={handleNavigate} title={t('traces')} onLogout={handleLogout}>
                  <TracesPage />
                </AppLayoutRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <AppLayoutRoute currentPage="settings" onNavigate={handleNavigate} title={t('settings')} onLogout={handleLogout}>
                  <SettingsPage />
                </AppLayoutRoute>
              </ProtectedRoute>
            }
          />

          {/* Catch all - redirect to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
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
