import { ReactNode } from 'react';

interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: string | number;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  variant?: 'default' | 'pills';
}

export function Tabs({ tabs, activeTab, onChange, variant = 'default' }: TabsProps) {
  if (variant === 'pills') {
    return (
      <div className="flex gap-1 p-1 bg-slate-800 light:bg-slate-100 rounded-lg">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab.id
                ? 'bg-cyan-500 text-white'
                : 'text-slate-400 light:text-slate-600 hover:text-white light:hover:text-slate-900 hover:bg-slate-700 light:hover:bg-slate-200'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                activeTab === tab.id
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-700 light:bg-slate-200 text-slate-400 light:text-slate-600'
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="border-b border-slate-700 light:border-slate-200">
      <nav className="flex gap-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === tab.id
                ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
                : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                activeTab === tab.id
                  ? 'bg-cyan-500/20 text-cyan-400 light:text-cyan-600'
                  : 'bg-slate-700 light:bg-slate-200 text-slate-400 light:text-slate-600'
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
