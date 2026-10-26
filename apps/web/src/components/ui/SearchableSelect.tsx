import { useState, useRef, useEffect, useMemo, useId } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  id?: string;
  'aria-label'?: string;
  /**
   * Which way the options menu opens. Defaults to 'down'.
   * Use 'up' when the field sits near the bottom of a height-constrained,
   * scrollable container (e.g. a modal body) where a downward menu would be
   * clipped by the container's overflow.
   */
  openDirection?: 'down' | 'up';
}

/**
 * Searchable dropdown — input with filtered popover.
 * Click outside or pick an option to close. Only allows values from options[].
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = '-- เลือก --',
  disabled,
  className,
  inputClassName,
  id,
  'aria-label': ariaLabel,
  openDirection = 'down',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Sync query with value when value changes externally
  useEffect(() => {
    if (!open) setQuery(value);
  }, [value, open]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(value);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, value]);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    // Prefix match first (ขึ้นต้นด้วย), then substring match
    const starts = options.filter((o) => o.toLowerCase().startsWith(q));
    const contains = options.filter((o) => !o.toLowerCase().startsWith(q) && o.toLowerCase().includes(q));
    return [...starts, ...contains];
  }, [options, query]);

  function pick(opt: string) {
    onChange(opt);
    setQuery(opt);
    setOpen(false);
    setActiveIndex(-1);
  }

  // Open above the input ('up') or below it ('down', default).
  const menuPos = openDirection === 'up' ? 'bottom-full mb-1' : 'mt-1';

  return (
    <div ref={wrapperRef} className={cn('relative min-w-0', className)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
          setQuery(value);
          setActiveIndex(-1);
        }
      }}>
      <input
        data-slot="searchable-select-input"
        data-inline-combobox="true"
        id={id}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 && filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        type="text"
        value={open ? query : value}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(-1);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          if (!disabled) {
            setQuery('');
            setActiveIndex(-1);
            setOpen(true);
          }
        }}
        onClick={() => {
          if (!open && !disabled) {
            setQuery('');
            setActiveIndex(-1);
            setOpen(true);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) { setQuery(''); setOpen(true); setActiveIndex(-1); return; }
            if (!filtered.length) return;
            const next = e.key === 'ArrowDown'
              ? (activeIndex + 1) % filtered.length
              : (activeIndex <= 0 ? filtered.length - 1 : activeIndex - 1);
            setActiveIndex(next);
            document.getElementById(`${listId}-${next}`)?.scrollIntoView?.({ block: 'nearest' });
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            if (activeIndex >= 0 && filtered[activeIndex]) pick(filtered[activeIndex]);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false); setQuery(value); setActiveIndex(-1);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'flex items-center h-[34px] w-full rounded-md border border-input bg-background px-3 py-1 text-sm leading-snug shadow-sm transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          inputClassName,
        )}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel || placeholder}
          className={cn(
            'absolute z-50 w-full max-h-60 overflow-y-auto rounded-md border border-input bg-popover shadow-lg',
            menuPos,
          )}
        >
          {filtered.map((opt, index) => (
            <button
              id={`${listId}-${index}`}
              role="option"
              aria-selected={opt === value}
              tabIndex={-1}
              key={opt}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(opt)}
              className={cn(
                'min-h-11 w-full text-left px-3 py-2 text-sm hover:bg-muted',
                opt === value && 'bg-primary/10 font-medium',
                index === activeIndex && 'bg-muted',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel || placeholder}
          className={cn(
            'absolute z-50 w-full rounded-md border border-input bg-popover shadow-lg px-3 py-2 text-sm text-muted-foreground',
            menuPos,
          )}
        >
          ไม่พบผลลัพธ์
        </div>
      )}
    </div>
  );
}
