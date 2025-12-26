import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// 导入语言包
import zhCN from './locales/zh-CN';
import en from './locales/en';
import ja from './locales/ja';
import zhTW from './locales/zh-TW';

export const supportedLanguages = [
  { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'zh-TW', name: '繁體中文', flag: '🇹🇼' },
] as const;

export type SupportedLanguage = typeof supportedLanguages[number]['code'];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': zhCN,
      en,
      ja,
      'zh-TW': zhTW,
    },
    fallbackLng: 'zh-CN',
    defaultNS: 'common',
    ns: ['common', 'nav', 'home', 'login', 'prompts', 'evaluation', 'settings', 'traces', 'setup'],

    interpolation: {
      escapeValue: false, // React 已经处理了 XSS
    },

    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage'],
    },
  });

export default i18n;
