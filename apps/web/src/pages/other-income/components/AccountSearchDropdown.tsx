import { useEffect, useId, useRef, useState } from 'react';
import { Search, CheckCircle2, ChevronUp, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCoaGroups } from '@/hooks/useCoa';
import { cn } from '@/lib/utils';
import { accountDisplayName } from '@/utils/accountName';

interface CoaItem {
  code: string;
  name: string;
}

interface Props {
  value: string;
  onChange: (code: string) => void;
  /** CSS classes filter for which CoA codes to show. */
  filter?: (a: CoaItem) => boolean;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Account codes that should be shown in the list (so users can see they exist)
   * but cannot be selected. Server-side validation (V4) still rejects these, but
   * surfacing them up-front avoids the surprise round-trip.
   */
  blockedCodes?: string[];
  /** Reason shown as secondary text (and tooltip) on blocked rows. */
  blockedReason?: string;
  /** Accessible name of the trigger. Defaults to 'บัญชี' unless aria-labelledby is given. */
  'aria-label'?: string;
  /** Id(s) of the element(s) that label the trigger; wins over the default aria-label. */
  'aria-labelledby'?: string;
}

const DEFAULT_BLOCKED_REASON = 'บัญชีนี้ยังไม่รองรับในระบบ';
const DEFAULT_TRIGGER_LABEL = 'บัญชี';

/**
 * Searchable account-code dropdown — used by ItemsTable (42-XXXX), AdjustmentTable,
 * EditableJournalTable (Override JV) and PettyCashLinesSection (53-XXXX).
 *
 * The menu is a portalled Radix Popover (spec 2026-11-14 §4.2 item 6, R1-2) so the
 * card (`overflow-hidden`) / table box (`overflow-x-auto`) around it no longer clips
 * it (S2-01, S2-02). Keyboard: ArrowDown on the button opens; in the search box
 * ArrowUp/ArrowDown move the highlighted row (aria-activedescendant), Enter picks it,
 * Escape closes (Radix), Tab closes without picking and keeps focus on the button.
 * The button is a combobox, so it takes its name from aria-label / aria-labelledby
 * (default 'บัญชี'), not from its content. Blocked codes stay listed with their reason as text and are
 * skipped by the keyboard. wheel/touchmove stop at the menu so it scrolls inside a
 * modal Dialog (same escape as WizardStackedOverlay). R2-3a replaces the internals
 * with the shared Combobox.
 */
export function AccountSearchDropdown({
  value,
  onChange,
  filter,
  placeholder = '— เลือกบัญชี —',
  disabled,
  blockedCodes,
  blockedReason,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const { data: groups, isLoading } = useCoaGroups({});

  const isBlocked = (code: string) => blockedCodes?.includes(code) ?? false;
  const optionId = (code: string) => `${listboxId}-${code}`;

  const allAccounts: CoaItem[] = (groups?.groups ?? []).flatMap((g) => g.accounts);
  const term = search.toLowerCase();
  const filtered = allAccounts
    .filter((a) => (filter ? filter(a) : true))
    .filter((a) =>
      term ? a.code.toLowerCase().includes(term) || a.name.toLowerCase().includes(term) : true,
    );
  const selectable = filtered.filter((a) => !isBlocked(a.code));
  const selected = allAccounts.find((a) => a.code === value);

  const isOpen = open && !disabled;
  // Highlight: the row the user moved to; otherwise the current value (when not
  // searching) or the first selectable result.
  const fallback = (search ? undefined : selectable.find((a) => a.code === value)) ?? selectable[0];
  const active = selectable.find((a) => a.code === activeCode) ?? fallback;
  const activeId = isOpen && active ? optionId(active.code) : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const changeOpen = (next: boolean) => {
    if (next && disabled) return;
    setOpen(next);
    if (!next) {
      setSearch('');
      setActiveCode(null);
    }
  };

  const choose = (a: CoaItem) => {
    if (isBlocked(a.code)) return;
    onChange(a.code);
    changeOpen(false);
  };

  const move = (step: 1 | -1) => {
    if (selectable.length === 0) return;
    const from = active ? selectable.indexOf(active) : -1;
    const next = Math.min(selectable.length - 1, Math.max(0, from + step));
    setActiveCode(selectable[next].code);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // Keep focus on the trigger: Radix treats Tab-out as focus-outside and would not
      // return it, dropping focus to the end of the document.
      e.preventDefault();
      changeOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active) choose(active);
    }
  };

  // A modal Dialog's scroll lock preventDefault()s wheel/touchmove that bubble out of
  // its content — the portalled menu is outside it, so stop them here.
  const stopScrollLock = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <Popover open={isOpen} onOpenChange={changeOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          ref={triggerRef}
          data-slot="select-trigger"
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={ariaLabelledby ? undefined : (ariaLabel ?? DEFAULT_TRIGGER_LABEL)}
          aria-labelledby={ariaLabelledby}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !isOpen) {
              e.preventDefault();
              changeOpen(true);
            }
          }}
          className="w-full text-left px-3 py-2 rounded-md border bg-background text-sm flex items-center justify-between gap-2 hover:bg-accent disabled:opacity-50"
        >
          {selected ? (
            <span className="flex items-baseline gap-2 truncate">
              <span className="truncate">{accountDisplayName(selected.name)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          {isOpen ? (
            <ChevronUp aria-hidden="true" className="size-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground flex-shrink-0" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-(--radix-popover-trigger-width) min-w-64 flex-col p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchRef.current?.focus();
        }}
        onWheel={stopScrollLock}
        onTouchMove={stopScrollLock}
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={searchRef}
              aria-label="ค้นหารหัส หรือ ชื่อบัญชี"
              aria-controls={listboxId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setActiveCode(null);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="ค้นหารหัส หรือ ชื่อบัญชี"
              className="w-full rounded border bg-background py-2 pl-7 pr-2 text-xs"
            />
          </div>
        </div>
        {isLoading ? (
          <p className="p-3 text-center text-xs leading-snug text-muted-foreground">กำลังโหลด...</p>
        ) : filtered.length === 0 ? (
          <p className="p-3 text-center text-xs leading-snug text-muted-foreground">ไม่พบบัญชี</p>
        ) : null}
        <div
          id={listboxId}
          role="listbox"
          aria-label="รายการบัญชี"
          className="max-h-64 overflow-y-auto overscroll-contain"
        >
          {!isLoading &&
            filtered.map((a) => {
              const isSel = a.code === value;
              const blocked = isBlocked(a.code);
              const reason = blocked ? (blockedReason ?? DEFAULT_BLOCKED_REASON) : undefined;
              const isActive = !blocked && active?.code === a.code;
              return (
                <div
                  key={a.code}
                  id={optionId(a.code)}
                  role="option"
                  aria-selected={isSel}
                  aria-disabled={blocked || undefined}
                  data-active={isActive || undefined}
                  title={reason}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => {
                    if (!blocked && !isActive) setActiveCode(a.code);
                  }}
                  onClick={() => choose(a)}
                  className={cn(
                    'flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs leading-snug',
                    blocked
                      ? 'cursor-not-allowed bg-muted/40 text-muted-foreground'
                      : 'cursor-pointer data-[active]:bg-accent data-[active]:text-accent-foreground',
                    isSel && !blocked && 'font-medium',
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{accountDisplayName(a.name)}</span>
                    {reason && <span className="text-muted-foreground">{reason}</span>}
                  </span>
                  {isSel && !blocked && (
                    <CheckCircle2 size={12} aria-hidden="true" className="shrink-0 text-primary" />
                  )}
                </div>
              );
            })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
