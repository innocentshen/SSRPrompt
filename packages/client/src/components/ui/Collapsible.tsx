import { useState, ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface CollapsibleProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  icon?: ReactNode;
  action?: ReactNode;
}

export function Collapsible({
  title,
  children,
  defaultOpen = true,
  icon,
  action,
}: CollapsibleProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-slate-700 light:border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-800/50 light:bg-slate-50 hover:bg-slate-800 light:hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 light:text-slate-500" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 light:text-slate-500" />
          )}
          {icon}
          <span className="text-sm font-medium text-slate-200 light:text-slate-800">
            {title}
          </span>
        </div>
        {action && (
          <div onClick={(e) => e.stopPropagation()}>
            {action}
          </div>
        )}
      </button>
      {isOpen && (
        <div className="p-3 border-t border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white">
          {children}
        </div>
      )}
    </div>
  );
}
