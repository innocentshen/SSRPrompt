import { useState } from 'react';
import {
  Compass,
  FileText,
  BarChart3,
  Eye,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

const navItems = [
  { id: 'prompts', name: 'Prompt 开发', icon: FileText },
  { id: 'evaluation', name: '评测中心', icon: BarChart3 },
  { id: 'traces', name: '观测', icon: Eye },
  { id: 'settings', name: '设置', icon: Settings },
];

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`${
        collapsed ? 'w-16' : 'w-60'
      } bg-slate-900 light:bg-white border-r border-slate-700 light:border-slate-200 flex flex-col transition-all duration-300`}
    >
      <div className="h-14 flex items-center justify-between px-4 border-b border-slate-700 light:border-slate-200">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center">
              <Compass className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-white light:text-slate-900">AI 罗盘</span>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center mx-auto">
            <Compass className="w-5 h-5 text-white" />
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`p-1 rounded hover:bg-slate-800 light:hover:bg-slate-100 text-slate-400 light:text-slate-500 hover:text-white light:hover:text-slate-900 transition-colors ${
            collapsed ? 'hidden' : ''
          }`}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 py-4">
        {navItems.map((item) => {
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
              {!collapsed && <span>{item.name}</span>}
            </button>
          );
        })}
      </nav>

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="p-3 border-t border-slate-700 light:border-slate-200 text-slate-400 light:text-slate-500 hover:text-white light:hover:text-slate-900 hover:bg-slate-800 light:hover:bg-slate-100 transition-colors"
        >
          <ChevronRight className="w-4 h-4 mx-auto" />
        </button>
      )}
    </aside>
  );
}
