import { useState, useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
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
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
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
  }

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <input
        type="text"
        value={open ? query : value}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          if (!disabled) {
            setQuery('');
            setOpen(true);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'flex h-[34px] w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        )}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-md border border-input bg-popover shadow-lg">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => pick(opt)}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-muted',
                opt === value && 'bg-primary/10 font-medium',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-input bg-popover shadow-lg px-3 py-2 text-sm text-muted-foreground">
          ไม่พบผลลัพธ์
        </div>
      )}
    </div>
  );
}
