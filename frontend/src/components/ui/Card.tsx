import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

type CardProps = {
  children: ReactNode;
  className?: string;
};

export function Card({ children, className }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-line bg-surface p-6 shadow-sm transition-shadow hover:shadow-md',
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: CardProps) {
  return (
    <div className={cn('mb-6 border-b-2 border-surface-accent pb-4', className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: CardProps) {
  return (
    <h2 className={cn('text-2xl font-bold text-ink', className)}>
      {children}
    </h2>
  );
}

export function CardSubtitle({ children, className }: CardProps) {
  return (
    <div className={cn('mt-1 text-[0.9rem] text-ink-muted', className)}>
      {children}
    </div>
  );
}

export function CardContent({ children, className }: CardProps) {
  return (
    <div className={cn(className)}>{children}</div>
  );
}

export function CardSectionTitle({ children, className }: CardProps) {
  return (
    <h4 className={cn('mb-4 text-sm font-semibold uppercase tracking-[0.5px] text-ink-muted', className)}>
      {children}
    </h4>
  );
}
