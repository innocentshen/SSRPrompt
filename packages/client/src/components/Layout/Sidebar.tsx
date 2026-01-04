import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Compass,
  FileText,
  BarChart3,
  Eye,
  Settings,
  ChevronLeft,
  ChevronRight,
  Home,
} from 'lucide-react';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

const navItemsConfig = [
  { id: 'home', nameKey: 'home', icon: Home },
  { id: 'prompts', nameKey: 'prompts', icon: FileText },
  { id: 'evaluation', nameKey: 'evaluation', icon: BarChart3 },
  { id: 'traces', nameKey: 'traces', icon: Eye },
  { id: 'settings', nameKey: 'settings', icon: Settings },
];

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const { t } = useTranslation('nav');
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`${
        collapsed ? 'w-16' : 'w-60'
      } bg-slate-900 light:bg-white border-r border-slate-700 light:border-slate-200 flex flex-col transition-all duration-300 overflow-hidden flex-shrink-0`}
    >
      <div className="h-14 flex items-center px-4 border-b border-slate-700 light:border-slate-200">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center flex-shrink-0">
            <Compass className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <span className="font-semibold text-white light:text-slate-900 whitespace-nowrap">SSRPrompt</span>
          )}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-slate-800 light:hover:bg-slate-100 text-slate-400 light:text-slate-500 hover:text-white light:hover:text-slate-900 transition-colors flex-shrink-0"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      <nav className="flex-1 py-4">
        {navItemsConfig.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-slate-800 light:bg-cyan-50 text-cyan-400 light:text-cyan-600 border-r-2 border-cyan-400 light:border-cyan-500'
                  : 'text-slate-400 light:text-slate-600 hover:text-white light:hover:text-slate-900 hover:bg-slate-800/50 light:hover:bg-slate-100'
              }`}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="whitespace-nowrap">{t(item.nameKey)}</span>}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
