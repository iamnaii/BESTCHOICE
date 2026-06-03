import { useMemo, useState } from 'react';
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

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    return list.slice(0, 50);
  }, [value, options]);

  return (
    <div className={cn('relative', className)}>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        // Delay close so a click on a suggestion registers first.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        autoComplete="off"
        className="pr-8"
      />
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
        aria-hidden
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  // onMouseDown (not onClick) so it fires before the input blur.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(name);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full px-3 py-1.5 text-left text-sm leading-snug hover:bg-muted/60',
                    name === value && 'bg-muted/40 font-medium',
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
