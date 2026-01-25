import { useState, ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface CollapsibleProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  icon?: ReactNode;
  action?: ReactNode;
  /** 禁用展开/折叠功能 */
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
}

export function Collapsible({
  title,
  children,
  defaultOpen = true,
  icon,
  action,
  disabled = false,
  className,
  contentClassName,
}: CollapsibleProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  return (
    <div className={`border border-slate-700 light:border-slate-200 rounded-lg overflow-hidden ${className ?? ''}`}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-expanded={isOpen}
        aria-disabled={disabled}
        onClick={handleToggle}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
        className={`w-full flex items-center justify-between px-3 py-2.5 bg-slate-800/50 light:bg-slate-50 transition-colors ${
          disabled
            ? 'cursor-default'
            : 'hover:bg-slate-800 light:hover:bg-slate-100 cursor-pointer'
        }`}
      >
        <div className="flex items-center gap-2">
          {disabled ? (
            <ChevronRight className="w-3.5 h-3.5 text-slate-600 light:text-slate-400" />
          ) : isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 light:text-slate-500" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 light:text-slate-500" />
          )}
          {icon}
          <span className={`text-sm font-medium ${disabled ? 'text-slate-500 light:text-slate-500' : 'text-slate-200 light:text-slate-800'}`}>
            {title}
          </span>
        </div>
        {action && (
          <div onClick={(e) => e.stopPropagation()}>
            {action}
          </div>
        )}
      </div>
      {isOpen && !disabled && (
        <div className={`p-3 border-t border-slate-700 light:border-slate-200 bg-slate-900/30 light:bg-white ${contentClassName ?? ''}`}>
          {children}
        </div>
      )}
    </div>
  );
}
