import { forwardRef, InputHTMLAttributes } from 'react';
import { Check, Minus } from 'lucide-react';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className = '', disabled, ...props }, ref) => {
    return (
      <span
        className={`relative inline-flex h-4 w-4 shrink-0 items-center justify-center ${
          disabled ? 'opacity-60' : ''
        } ${className}`}
      >
        <input
          ref={ref}
          type="checkbox"
          disabled={disabled}
          className="peer h-4 w-4 appearance-none rounded border border-slate-500/80 light:border-slate-300 bg-slate-800/80 light:bg-white transition-all duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:ring-offset-1 focus:ring-offset-slate-900 light:focus:ring-offset-white checked:border-cyan-500 checked:bg-cyan-500 light:checked:border-cyan-600 light:checked:bg-cyan-600 indeterminate:border-cyan-500 indeterminate:bg-cyan-500 light:indeterminate:border-cyan-600 light:indeterminate:bg-cyan-600 disabled:cursor-not-allowed"
          {...props}
        />
        <Check className="pointer-events-none absolute h-3.5 w-3.5 stroke-[3] text-white opacity-0 transition-opacity peer-checked:opacity-100 peer-indeterminate:opacity-0" />
        <Minus className="pointer-events-none absolute h-3.5 w-3.5 stroke-[3] text-white opacity-0 transition-opacity peer-indeterminate:opacity-100" />
      </span>
    );
  }
);

Checkbox.displayName = 'Checkbox';
