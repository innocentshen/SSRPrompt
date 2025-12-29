import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, AlertCircle, Github, Star, Sun, Moon, Rocket, User, ArrowLeft } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { LanguageSwitcher } from '../components/Layout/LanguageSwitcher';
import { GitHubStar } from '../components/Layout/GitHubStar';
import { useTheme } from '../contexts';
import { setTenantType, isDemoDbConfigured, type TenantType } from '../lib/tenant';

interface LoginPageProps {
  onLogin: (password: string, tenant: TenantType) => void;
}

type Step = 'password' | 'tenant';

export function LoginPage({ onLogin }: LoginPageProps) {
  const { t } = useTranslation('login');
  const { theme, toggleTheme } = useTheme();
  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    setTimeout(() => {
      if (password === import.meta.env.VITE_APP_PASSWORD) {
        // 密码验证通过，进入空间选择
        setStep('tenant');
      } else {
        setError(t('wrongPassword'));
        setPassword('');
      }
      setIsLoading(false);
    }, 300);
  };

  const handleTenantSelect = (tenant: TenantType) => {
    if (tenant === 'demo' && !isDemoDbConfigured()) {
      setError(t('demoNotConfigured'));
      return;
    }

    setTenantType(tenant);
    onLogin(password, tenant);
  };

  const handleBack = () => {
    setStep('password');
    setError('');
  };

  const demoConfigured = isDemoDbConfigured();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 light:from-slate-100 light:via-white light:to-slate-100 flex items-center justify-center p-4">
      {/* Top Right Controls */}
      <div className="fixed top-6 right-6 flex items-center gap-2">
        <GitHubStar />
        <LanguageSwitcher />

        <button
          onClick={toggleTheme}
          className="p-2 text-slate-400 dark:text-slate-400 light:text-slate-500 hover:text-white dark:hover:text-white light:hover:text-slate-900 hover:bg-slate-700/80 dark:hover:bg-slate-700/80 light:hover:bg-slate-200/80 rounded-lg transition-colors backdrop-blur-sm"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </div>

      <div className="w-full max-w-md">
        {step === 'password' ? (
          <>
            {/* Password Step */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-cyan-500/10 rounded-2xl mb-4">
                <Lock className="w-8 h-8 text-cyan-400" />
              </div>
              <h1 className="text-3xl font-bold text-white dark:text-white light:text-slate-900 mb-2">{t('title')}</h1>
              <p className="text-slate-400 dark:text-slate-400 light:text-slate-600">{t('enterPassword')}</p>
            </div>

            <div className="bg-slate-800/50 dark:bg-slate-800/50 light:bg-white/80 backdrop-blur-sm border border-slate-700 dark:border-slate-700 light:border-slate-200 rounded-xl p-8 shadow-2xl">
              <form onSubmit={handlePasswordSubmit} className="space-y-6">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-slate-300 dark:text-slate-300 light:text-slate-700 mb-2">
                    {t('accessPassword')}
                  </label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('passwordPlaceholder')}
                    className="w-full"
                    autoFocus
                    disabled={isLoading}
                  />
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-500 light:text-slate-500">
                    {t('passwordHint')}
                  </p>
                </div>

                {error && (
                  <div className="flex items-center gap-2 p-3 bg-rose-950/30 dark:bg-rose-950/30 light:bg-rose-50 border border-rose-900/50 dark:border-rose-900/50 light:border-rose-200 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-rose-400 dark:text-rose-400 light:text-rose-500 flex-shrink-0" />
                    <p className="text-sm text-rose-300 dark:text-rose-300 light:text-rose-600">{error}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={!password || isLoading}
                >
                  {isLoading ? t('verifying') : t('enterSystem')}
                </Button>
              </form>
            </div>
          </>
        ) : (
          <>
            {/* Tenant Selection Step */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-cyan-500/10 rounded-2xl mb-4">
                <Rocket className="w-8 h-8 text-cyan-400" />
              </div>
              <h1 className="text-3xl font-bold text-white dark:text-white light:text-slate-900 mb-2">{t('selectTenant')}</h1>
            </div>

            <div className="space-y-4">
              {/* Demo Space */}
              <button
                onClick={() => handleTenantSelect('demo')}
                disabled={!demoConfigured}
                className={`w-full p-6 rounded-xl border transition-all text-left ${
                  demoConfigured
                    ? 'bg-slate-800/50 dark:bg-slate-800/50 light:bg-white/80 border-slate-700 dark:border-slate-700 light:border-slate-200 hover:border-cyan-500 hover:bg-slate-700/50 dark:hover:bg-slate-700/50 light:hover:bg-slate-50'
                    : 'bg-slate-800/30 dark:bg-slate-800/30 light:bg-slate-100/50 border-slate-800 dark:border-slate-800 light:border-slate-300 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-lg ${demoConfigured ? 'bg-cyan-500/10' : 'bg-slate-700/50'}`}>
                    <Rocket className={`w-6 h-6 ${demoConfigured ? 'text-cyan-400' : 'text-slate-500'}`} />
                  </div>
                  <div className="flex-1">
                    <h3 className={`text-lg font-semibold mb-1 ${demoConfigured ? 'text-white dark:text-white light:text-slate-900' : 'text-slate-500'}`}>
                      {t('demoTenant')}
                    </h3>
                    <p className={`text-sm ${demoConfigured ? 'text-slate-400 dark:text-slate-400 light:text-slate-600' : 'text-slate-600'}`}>
                      {demoConfigured ? t('demoTenantDesc') : t('demoNotConfigured')}
                    </p>
                  </div>
                </div>
              </button>

              {/* Personal Space */}
              <button
                onClick={() => handleTenantSelect('personal')}
                className="w-full p-6 rounded-xl border bg-slate-800/50 dark:bg-slate-800/50 light:bg-white/80 border-slate-700 dark:border-slate-700 light:border-slate-200 hover:border-emerald-500 hover:bg-slate-700/50 dark:hover:bg-slate-700/50 light:hover:bg-slate-50 transition-all text-left"
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-emerald-500/10">
                    <User className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-white dark:text-white light:text-slate-900 mb-1">
                      {t('personalTenant')}
                    </h3>
                    <p className="text-sm text-slate-400 dark:text-slate-400 light:text-slate-600">
                      {t('personalTenantDesc')}
                    </p>
                  </div>
                </div>
              </button>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-rose-950/30 dark:bg-rose-950/30 light:bg-rose-50 border border-rose-900/50 dark:border-rose-900/50 light:border-rose-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-rose-400 dark:text-rose-400 light:text-rose-500 flex-shrink-0" />
                  <p className="text-sm text-rose-300 dark:text-rose-300 light:text-rose-600">{error}</p>
                </div>
              )}

              {/* Back Button */}
              <button
                onClick={handleBack}
                className="w-full flex items-center justify-center gap-2 py-3 text-slate-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{t('keepPasswordSafe')}</span>
              </button>
            </div>
          </>
        )}

        <p className="text-center text-xs text-slate-500 mt-6">
          {step === 'password' && t('keepPasswordSafe')}
        </p>

        {/* GitHub Link - Bottom */}
        <div className="mt-6 text-center">
          <a
            href="https://github.com/innocentshen/ssrprompt"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-slate-400 dark:text-slate-400 light:text-slate-500 hover:text-cyan-400 transition-colors duration-200"
          >
            <Github className="w-4 h-4" />
            <span>{t('likeItStarIt')}</span>
            <Star className="w-4 h-4 text-yellow-500" />
          </a>
        </div>
      </div>
    </div>
  );
}
