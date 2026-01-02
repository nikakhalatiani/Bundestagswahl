import { useEffect, useMemo, useRef, useState } from 'react';

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
};

export function Autocomplete<T extends AutocompleteItem>(props: Props<T>) {
    const { id, label, items, value, onChange, onSelect, getItemLabel, placeholder, disabled } = props;

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
        <div className="form-group" ref={containerRef}>
            <label className="form-label" htmlFor={id}>{label}</label>
            <div style={{ position: 'relative' }}>
                <input
                    ref={inputRef}
                    id={id}
                    className="form-input"
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
                        style={{
                            position: 'absolute',
                            zIndex: 10,
                            top: 'calc(100% + 6px)',
                            left: 0,
                            right: 0,
                            maxHeight: 260,
                            overflowY: 'auto',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 6,
                            boxShadow: 'var(--shadow-md)',
                        }}
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
                                style={{
                                    padding: '0.5rem 0.75rem',
                                    cursor: 'pointer',
                                    background: idx === activeIndex ? 'var(--bg-secondary)' : 'transparent',
                                }}
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
