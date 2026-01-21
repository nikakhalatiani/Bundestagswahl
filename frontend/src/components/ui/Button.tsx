import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

type ButtonVariant = 'ghost' | 'secondary' | 'primary';
type ButtonSize = 'sm' | 'md';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClasses: Record<ButtonVariant, string> = {
  ghost: 'text-ink',
  secondary: 'bg-surface-muted text-ink border border-line hover:bg-surface-accent hover:border-ink-muted',
  primary: 'bg-brand-black text-white hover:bg-[#333333] shadow-sm hover:shadow-md',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-4 py-2 text-[0.875rem]',
  md: 'px-6 py-3 text-base font-semibold',
};

export function Button({
  variant = 'ghost',
  size = 'sm',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-2 rounded-md font-medium transition-all',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
}
