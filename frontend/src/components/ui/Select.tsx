import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  className?: string;
  containerClassName?: string;
};

const baseClass =
  'appearance-none rounded-md border border-line bg-surface-muted px-3 py-2 pr-8 text-[0.9rem] text-ink transition hover:border-ink-faint hover:bg-surface-accent focus:outline-none focus:ring-2 focus:ring-black/5';

export function Select({ className, containerClassName, children, ...props }: SelectProps) {
  return (
    <div className={cn('relative', containerClassName)}>
      <select className={cn(baseClass, className)} {...props}>
        {children}
      </select>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint"
      />
    </div>
  );
}
