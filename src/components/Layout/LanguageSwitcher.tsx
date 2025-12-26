import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Check } from 'lucide-react';
import { supportedLanguages, type SupportedLanguage } from '../../i18n';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const handleLanguageChange = (langCode: SupportedLanguage) => {
    i18n.changeLanguage(langCode);
    setIsOpen(false);
  };

  const currentLang = supportedLanguages.find(
    (lang) => lang.code === i18n.language ||
    (i18n.language.startsWith('zh') && lang.code === 'zh-CN' && !i18n.language.includes('TW'))
  ) || supportedLanguages[0];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1.5 text-slate-400 dark:text-slate-400 light:text-slate-500 hover:text-white dark:hover:text-white light:hover:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-200 rounded-lg transition-colors text-sm"
        title="Language"
      >
        <Globe className="w-4 h-4" />
        <span className="hidden sm:inline">{currentLang.flag}</span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-40 bg-slate-800 dark:bg-slate-800 light:bg-white border border-slate-700 dark:border-slate-700 light:border-slate-200 rounded-lg shadow-xl z-20 overflow-hidden py-1">
            {supportedLanguages.map((lang) => {
              const isActive = i18n.language === lang.code ||
                (i18n.language.startsWith('zh') && lang.code === 'zh-CN' && !i18n.language.includes('TW'));
              return (
                <button
                  key={lang.code}
                  onClick={() => handleLanguageChange(lang.code)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'text-cyan-400 bg-slate-700/50 dark:bg-slate-700/50 light:bg-cyan-50 light:text-cyan-600'
                      : 'text-slate-300 dark:text-slate-300 light:text-slate-700 hover:bg-slate-700 dark:hover:bg-slate-700 light:hover:bg-slate-100'
                  }`}
                >
                  <span>{lang.flag}</span>
                  <span className="flex-1 text-left">{lang.name}</span>
                  {isActive && <Check className="w-4 h-4" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
