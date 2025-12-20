interface ToggleProps {
  enabled?: boolean;
  checked?: boolean;
  onChange: (enabled: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function Toggle({ enabled, checked, onChange, label, disabled, size = 'md' }: ToggleProps) {
  const isChecked = checked ?? enabled ?? false;
  const sizeClasses = size === 'sm'
    ? 'w-9 h-5'
    : 'w-10 h-5';
  const knobSizeClasses = size === 'sm'
    ? 'w-3.5 h-3.5'
    : 'w-4 h-4';
  const translateClasses = size === 'sm'
    ? 'translate-x-4'
    : 'translate-x-5';

  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={isChecked}
        disabled={disabled}
        onClick={() => onChange(!isChecked)}
        className={`relative ${sizeClasses} rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-50 disabled:cursor-not-allowed ${
          isChecked ? 'bg-cyan-500' : 'bg-slate-700 light:bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 ${knobSizeClasses} bg-white rounded-full transition-transform duration-200 ${
            isChecked ? translateClasses : 'translate-x-0'
          }`}
        />
      </button>
      {label && (
        <span className="text-sm text-slate-300 light:text-slate-700">{label}</span>
      )}
    </label>
  );
}
