import type { ReactNode } from 'react';
import { Square } from 'lucide-react';

interface StopIndicatorProps {
  label?: ReactNode;
  iconSizeClassName?: string;
  className?: string;
  labelClassName?: string;
}

export function StopIndicator({
  label,
  iconSizeClassName = 'w-4 h-4',
  className = '',
  labelClassName = '',
}: StopIndicatorProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className={`relative inline-flex items-center justify-center ${iconSizeClassName}`}>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[4px] bg-current/25 blur-[0.5px] animate-stop-soft-glow"
        />
        <Square className={`relative ${iconSizeClassName} animate-stop-soft-breathe`} />
      </span>
      {label ? <span className={labelClassName}>{label}</span> : null}
    </span>
  );
}
