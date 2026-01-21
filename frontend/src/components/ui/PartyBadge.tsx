import type { ReactNode } from 'react';
import { partyBadgeStyle } from '../../utils/party';
import { cn } from '../../utils/cn';

type PartyBadgeSize = 'sm' | 'md' | 'fixed';

type PartyBadgeProps = {
  party: string;
  children?: ReactNode;
  size?: PartyBadgeSize;
  className?: string;
  combineCduCsu?: boolean;
};

const sizeClasses: Record<PartyBadgeSize, string> = {
  sm: 'px-[0.4rem] py-[0.15rem] text-[0.7rem]',
  md: 'min-w-[110px] max-w-[140px] px-3 py-1 text-[0.85rem]',
  fixed: 'w-[120px] px-3 py-1 text-[0.85rem]',
};

export function PartyBadge({
  party,
  children,
  size = 'md',
  className,
  combineCduCsu,
}: PartyBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded text-center font-semibold text-white',
        sizeClasses[size],
        className
      )}
      style={partyBadgeStyle(party, { combineCduCsu })}
    >
      {children ?? party}
    </span>
  );
}
