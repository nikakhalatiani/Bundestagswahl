import { cn } from '../../utils/cn';

type ToggleSwitchProps = {
  leftLabel: string;
  rightLabel: string;
  value: 'left' | 'right';
  onChange: (value: 'left' | 'right') => void;
  className?: string;
  leftTitle?: string;
  rightTitle?: string;
  disabled?: boolean;
  disabledLeft?: boolean;
  disabledRight?: boolean;
};

export function ToggleSwitch({
  leftLabel,
  rightLabel,
  value,
  onChange,
  className,
  leftTitle,
  rightTitle,
  disabled = false,
  disabledLeft = false,
  disabledRight = false,
}: ToggleSwitchProps) {
  const isRight = value === 'right';
  const leftDisabled = disabled || disabledLeft;
  const rightDisabled = disabled || disabledRight;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full border border-line bg-surface-muted px-2 py-1.5 text-[0.75rem] font-semibold transition',
        !disabled && 'hover:border-ink-muted',
        disabled && 'cursor-not-allowed opacity-60',
        className
      )}
      role="group"
    >
      <button
        type="button"
        className={cn(
          'rounded-full transition',
          value === 'left' ? 'text-ink' : 'text-ink-faint',
          leftDisabled && 'cursor-not-allowed opacity-60'
        )}
        onClick={() => {
          if (!leftDisabled) onChange('left');
        }}
        title={leftTitle}
        disabled={leftDisabled}
      >
        {leftLabel}
      </button>
      <span className="relative h-[18px] w-8 rounded-full bg-surface-accent transition">
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-brand-black transition-[left]',
            isRight && 'left-4'
          )}
        />
      </span>
      <button
        type="button"
        className={cn(
          'rounded-full transition',
          value === 'right' ? 'text-ink' : 'text-ink-faint',
          rightDisabled && 'cursor-not-allowed opacity-60'
        )}
        onClick={() => {
          if (!rightDisabled) onChange('right');
        }}
        title={rightTitle}
        disabled={rightDisabled}
      >
        {rightLabel}
      </button>
    </div>
  );
}
