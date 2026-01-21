import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../utils/cn';

export type AutocompleteItem = {
    id: string | number;
};

type Props<T extends AutocompleteItem> = {
    id: string;
    label: string;
    items: T[];
    value: string;
    onChange: (next: string) => void;
    onSelect: (item: T) => void;
    getItemLabel: (item: T) => string;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    inputClassName?: string;
    labelClassName?: string;
};

export function Autocomplete<T extends AutocompleteItem>(props: Props<T>) {
    const { id, label, items, value, onChange, onSelect, getItemLabel, placeholder, disabled, className, inputClassName, labelClassName } = props;

    const containerRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);

    const filtered = useMemo(() => {
        const needle = value.trim().toLowerCase();

        const entries = items.map((item) => ({ item, label: getItemLabel(item) }));
        if (!needle) return entries.slice(0, 50);

        return entries
            .filter(({ label }) => label.toLowerCase().includes(needle))
            .slice(0, 50);
    }, [items, value, getItemLabel]);

    useEffect(() => {
        function onDocMouseDown(e: MouseEvent) {
            if (!containerRef.current) return;
            if (e.target instanceof Node && !containerRef.current.contains(e.target)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', onDocMouseDown);
        return () => document.removeEventListener('mousedown', onDocMouseDown);
    }, []);

    useEffect(() => {
        if (activeIndex >= filtered.length) setActiveIndex(0);
    }, [filtered.length, activeIndex]);

    function commitSelection(idx: number) {
        const entry = filtered[idx];
        if (!entry) return;
        onSelect(entry.item);
        setOpen(false);
        // Keep focus for quick subsequent actions
        inputRef.current?.focus();
    }

    return (
        <div className={cn('mb-6', className)} ref={containerRef}>
            <label className={cn('mb-2 block font-semibold text-ink', labelClassName)} htmlFor={id}>{label}</label>
            <div className="relative">
                <input
                    ref={inputRef}
                    id={id}
                    className={cn(
                        'w-full rounded-md border-2 border-line px-4 py-3 text-base transition focus:border-brand-black focus:outline-none focus:ring-2 focus:ring-black/10',
                        inputClassName
                    )}
                    value={value}
                    onFocus={() => setOpen(true)}
                    onChange={(e) => {
                        onChange(e.target.value);
                        setOpen(true);
                    }}
                    onKeyDown={(e) => {
                        if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                            setOpen(true);
                            return;
                        }
                        if (e.key === 'Escape') {
                            setOpen(false);
                            return;
                        }
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
                            return;
                        }
                        if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setActiveIndex((i) => Math.max(0, i - 1));
                            return;
                        }
                        if (e.key === 'Enter') {
                            if (open && filtered.length > 0) {
                                e.preventDefault();
                                commitSelection(activeIndex);
                            }
                        }
                    }}
                    placeholder={placeholder}
                    disabled={disabled}
                    autoComplete="off"
                    aria-autocomplete="list"
                    aria-controls={`${id}-listbox`}
                    aria-expanded={open}
                />

                {open && filtered.length > 0 && (
                    <div
                        id={`${id}-listbox`}
                        role="listbox"
                        className="absolute left-0 right-0 top-full z-10 mt-1.5 max-h-[260px] overflow-y-auto rounded-md border border-line bg-surface shadow-md"
                    >
                        {filtered.map(({ item, label: itemLabel }, idx) => (
                            <div
                                key={String(item.id)}
                                role="option"
                                aria-selected={idx === activeIndex}
                                onMouseEnter={() => setActiveIndex(idx)}
                                onMouseDown={(e) => {
                                    // Prevent blur before selection
                                    e.preventDefault();
                                    commitSelection(idx);
                                }}
                                className={cn(
                                    'cursor-pointer px-3 py-2',
                                    idx === activeIndex ? 'bg-surface-muted' : 'bg-transparent'
                                )}
                            >
                                {itemLabel}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
