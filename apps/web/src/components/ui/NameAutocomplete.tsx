import { useId, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface NameAutocompleteProps {
  value: string;
  onChange: (v: string) => void;
  /** Suggestion list (e.g. system user names). */
  options: string[];
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * A free-text input with a styled suggestion dropdown — "type a name OR pick
 * from the list". Used for custodian / responsible-person fields. Styled with the
 * app's shadcn tokens (bg-popover / border-border / hover:bg-muted) so it matches
 * the rest of the UI instead of the browser-native <datalist> look.
 */
export function NameAutocomplete({
  value,
  onChange,
  options,
  placeholder,
  id,
  className,
  disabled,
}: NameAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    return list.slice(0, 50);
  }, [value, options]);

  return (
    <div className={cn('relative min-w-0', className)} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }}>
      <Input
        id={id}
        data-inline-combobox="true"
        role="combobox"
        aria-expanded={open && filtered.length > 0}
        aria-controls={open && filtered.length > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        value={value}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setActiveIndex(-1); setOpen(true); }}
        onFocus={() => { setOpen(true); setActiveIndex(-1); }}
        onClick={() => setOpen(true)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            if (!filtered.length) return;
            const next = event.key === 'ArrowDown'
              ? (activeIndex + 1) % filtered.length
              : activeIndex <= 0 ? filtered.length - 1 : activeIndex - 1;
            setActiveIndex(next);
            document.getElementById(`${listId}-${next}`)?.scrollIntoView?.({ block: 'nearest' });
          } else if (event.key === 'Enter' && open && filtered[activeIndex]) {
            event.preventDefault();
            onChange(filtered[activeIndex]); setOpen(false); setActiveIndex(-1);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault(); event.stopPropagation();
            setOpen(false); setActiveIndex(-1);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="pr-10"
      />
      <ChevronDown
        className="pointer-events-none absolute right-[calc(0.75rem+1px)] top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
        aria-hidden
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
          <ul id={listId} role="listbox" aria-label="รายชื่อที่แนะนำ" className="max-h-56 overflow-y-auto py-1">
            {filtered.map((name, index) => (
              <li key={name} role="presentation">
                <button
                  type="button"
                  role="option"
                  id={`${listId}-${index}`}
                  aria-selected={name === value}
                  tabIndex={-1}
                  // Keep focus on the input; click also supports touch/assistive activation.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                    setActiveIndex(-1);
                  }}
                  className={cn(
                    'min-h-11 w-full break-words px-3 py-2 text-left text-sm leading-snug hover:bg-muted/60',
                    name === value && 'bg-muted/40 font-medium',
                    index === activeIndex && 'bg-muted',
                  )}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
