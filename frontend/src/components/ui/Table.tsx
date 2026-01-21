import type { PropsWithChildren, ThHTMLAttributes, TdHTMLAttributes, TableHTMLAttributes, HTMLAttributes } from 'react';
import { createContext, useContext } from 'react';
import { cn } from '../../utils/cn';

type TableVariant = 'default' | 'compact' | 'members' | 'party';

const TableContext = createContext<TableVariant>('default');

const tableTextSize: Record<TableVariant, string> = {
  default: 'text-[0.95rem]',
  compact: 'text-[0.85rem]',
  members: 'text-[0.95rem]',
  party: 'text-[0.95rem]',
};

const headClasses: Record<TableVariant, string> = {
  default: 'bg-[#f5f5f5] px-5 py-4 text-left font-bold text-ink border-b-2 border-line',
  compact: 'bg-[#f5f5f5] px-4 py-3 text-left text-[0.9rem] font-bold text-ink border-b border-line',
  members: 'bg-[#f6f6f6] px-5 py-[1.1rem] text-left text-[0.95rem] font-bold text-ink border-b-2 border-line',
  party: 'bg-[#f5f5f5] px-5 py-4 text-left text-[1.05rem] font-bold text-ink border-b-2 border-line',
};

const cellClasses: Record<TableVariant, string> = {
  default: 'px-5 py-[0.85rem] border-b border-line',
  compact: 'px-4 py-3 border-b border-line text-[0.85rem]',
  members: 'px-6 py-[0.95rem] border-b border-line',
  party: 'px-4 py-3',
};

type TableProps = PropsWithChildren<TableHTMLAttributes<HTMLTableElement>> & {
  variant?: TableVariant;
};

export function Table({ variant = 'default', className, children, ...props }: TableProps) {
  return (
    <TableContext.Provider value={variant}>
      <table
        className={cn('w-full border-collapse', tableTextSize[variant], className)}
        {...props}
      >
        {children}
      </table>
    </TableContext.Provider>
  );
}

export function TableHead({ className, children, ...props }: PropsWithChildren<HTMLAttributes<HTMLTableSectionElement>>) {
  return (
    <thead className={cn(className)} {...props}>
      {children}
    </thead>
  );
}

export function TableBody({ className, children, ...props }: PropsWithChildren<HTMLAttributes<HTMLTableSectionElement>>) {
  return (
    <tbody className={cn(className)} {...props}>
      {children}
    </tbody>
  );
}

export function TableRow({ className, children, ...props }: PropsWithChildren<HTMLAttributes<HTMLTableRowElement>>) {
  return (
    <tr className={cn(className)} {...props}>
      {children}
    </tr>
  );
}

export function TableHeaderCell({ className, children, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  const variant = useContext(TableContext);
  return (
    <th className={cn(headClasses[variant], className)} {...props}>
      {children}
    </th>
  );
}

export function TableCell({ className, children, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  const variant = useContext(TableContext);
  return (
    <td className={cn(cellClasses[variant], className)} {...props}>
      {children}
    </td>
  );
}
