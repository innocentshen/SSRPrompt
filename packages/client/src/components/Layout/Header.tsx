import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User, LogOut, Sun, Moon } from 'lucide-react';
import { useTheme } from '../../contexts';
import { LanguageSwitcher } from './LanguageSwitcher';
import { GitHubStar } from './GitHubStar';

interface HeaderProps {
  title: string;
  onLogout?: () => void;
}

export function Header({ title, onLogout }: HeaderProps) {
  const { t } = useTranslation('common');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="h-14 bg-slate-900 dark:bg-slate-900 light:bg-white border-b border-slate-700 dark:border-slate-700 light:border-slate-200 flex items-center justify-between px-6">
      <h1 className="text-lg font-medium text-white dark:text-white light:text-slate-900">{title}</h1>

      <div className="flex items-center gap-2">
        <GitHubStar />
        <LanguageSwitcher />

        <button
          onClick={toggleTheme}
          className="p-2 text-slate-400 dark:text-slate-400 light:text-slate-500 hover:text-white dark:hover:text-white light:hover:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-200 rounded-lg transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center hover:opacity-90 transition-opacity"
          >
            <User className="w-4 h-4 text-white" />
          </button>

          {showUserMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowUserMenu(false)}
              />
              <div className="absolute right-0 mt-2 w-48 bg-slate-800 dark:bg-slate-800 light:bg-white border border-slate-700 dark:border-slate-700 light:border-slate-200 rounded-lg shadow-xl z-20 overflow-hidden">
                {onLogout && (
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      onLogout();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-300 dark:text-slate-300 light:text-slate-700 hover:bg-slate-700 dark:hover:bg-slate-700 light:hover:bg-slate-100 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>{t('logout')}</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
