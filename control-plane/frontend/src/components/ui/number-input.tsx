import * as React from 'react';
import { cn } from '@/lib/utils';
import { Minus, Plus } from 'lucide-react';

interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

function NumberInput({ value, onChange, min, max, step = 1, className, disabled, ...props }: NumberInputProps) {
  const handleIncrement = () => {
    const newVal = value + step;
    if (max !== undefined && newVal > max) return;
    onChange(newVal);
  };

  const handleDecrement = () => {
    const newVal = value - step;
    if (min !== undefined && newVal < min) return;
    onChange(newVal);
  };

  return (
    <div className={cn('flex items-center', className)}>
      <button
        type="button"
        onClick={handleDecrement}
        disabled={disabled || (min !== undefined && value <= min)}
        className="flex items-center justify-center h-8 w-8 rounded-l-md border border-r-0 border-input bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:pointer-events-none transition-colors"
      >
        <Minus className="h-3 w-3" />
      </button>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (isNaN(v)) return;
          if (min !== undefined && v < min) return onChange(min);
          if (max !== undefined && v > max) return onChange(max);
          onChange(v);
        }}
        disabled={disabled}
        className="h-8 w-full border border-input bg-background px-2 text-center text-sm font-mono [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:outline-none focus:ring-1 focus:ring-ring"
        min={min}
        max={max}
        step={step}
        {...props}
      />
      <button
        type="button"
        onClick={handleIncrement}
        disabled={disabled || (max !== undefined && value >= max)}
        className="flex items-center justify-center h-8 w-8 rounded-r-md border border-l-0 border-input bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:pointer-events-none transition-colors"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

export { NumberInput };
