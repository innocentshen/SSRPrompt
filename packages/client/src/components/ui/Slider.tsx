import { Info } from 'lucide-react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  tooltip?: string;
  disabled?: boolean;
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  tooltip,
  disabled = false,
}: SliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    if (!isNaN(newValue)) {
      const clampedValue = Math.min(max, Math.max(min, newValue));
      onChange(clampedValue);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <label className="text-sm font-medium text-slate-300 light:text-slate-700">
            {label}
          </label>
          {tooltip && (
            <div className="group relative">
              <Info className="w-3.5 h-3.5 text-slate-500 light:text-slate-400 cursor-help" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-800 light:bg-slate-700 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                {tooltip}
              </div>
            </div>
          )}
        </div>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={handleInputChange}
          disabled={disabled}
          className="w-20 px-2 py-1 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-sm text-slate-200 light:text-slate-800 text-right focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
        />
      </div>
      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleSliderChange}
          disabled={disabled}
          className="w-full h-2 bg-slate-700 light:bg-slate-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:bg-cyan-500
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:shadow-lg
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:hover:scale-110
            [&::-moz-range-thumb]:w-4
            [&::-moz-range-thumb]:h-4
            [&::-moz-range-thumb]:bg-cyan-500
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:border-0
            [&::-moz-range-thumb]:cursor-pointer"
          style={{
            background: `linear-gradient(to right, rgb(6, 182, 212) 0%, rgb(6, 182, 212) ${percentage}%, rgb(51, 65, 85) ${percentage}%, rgb(51, 65, 85) 100%)`,
          }}
        />
      </div>
    </div>
  );
}
