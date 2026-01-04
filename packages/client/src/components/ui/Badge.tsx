import { ReactNode } from 'react';

interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  children: ReactNode;
}

const variants = {
  default: 'bg-slate-700 light:bg-slate-200 text-slate-300 light:text-slate-700',
  success: 'bg-emerald-500/20 light:bg-emerald-100 text-emerald-400 light:text-emerald-700',
  warning: 'bg-amber-500/20 light:bg-amber-100 text-amber-400 light:text-amber-700',
  error: 'bg-rose-500/20 light:bg-rose-100 text-rose-400 light:text-rose-700',
  info: 'bg-cyan-500/20 light:bg-cyan-100 text-cyan-400 light:text-cyan-700',
};

export function Badge({ variant = 'default', children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant]}`}
    >
      {children}
    </span>
  );
}
