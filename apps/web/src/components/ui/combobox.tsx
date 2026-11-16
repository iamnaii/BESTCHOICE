import * as React from 'react';
import { useCommandState } from 'cmdk';
import { AlertCircle, Check, ChevronDown, Loader2, Plus, RotateCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { filterAndRank, normalizeThai } from '@/lib/thai-search';
import { Button } from './button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './command';
import { formControlClass } from './form-styles';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

type ComboOption<M = unknown> = {
  /** '' is allowed — cmdk only ever sees the internal key `opt:${index}`. */
  value: string;
  label: string;
  /** Extra search terms (codes, phone numbers, nicknames) — rank 4 in thai-search. */
  keywords?: string[];
  /** Second line of the row. */
  description?: string;
  /** Rows with the same group are listed under one heading, groups in first-seen order. */
  group?: string;
  disabled?: boolean;
  /** Shown as text under a disabled row (the keyboard never lands on it, so not a tooltip). */
  disabledReason?: string;
  meta?: M;
};

interface ComboboxProps<M = unknown> {
  value: string | null;
  /** `option` is null only when the clear button was used (`value` is then ''). */
  onChange: (value: string, option: ComboOption<M> | null) => void;
  options: ComboOption<M>[];
  /**
   * Display only (never a row): shown in the trigger when no option has `value` and
   * `selectedOption.value === value` (e.g. a former assignee, a contact name from another page).
   */
  selectedOption?: ComboOption<M> | null;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Accessible name of the search box (cmdk `<Command label>`). */
  searchLabel?: string;
  /** Accessible name of the listbox. */
  listLabel?: string;
  emptyText?: string;
  /**
   * Gets (options, raw query); its order is rendered as-is — also in server mode. Default:
   * `filterAndRank`, except in server mode, where the rows are not filtered again.
   */
  filter?: (options: ComboOption<M>[], query: string) => ComboOption<M>[];
  /** Server mode: the caller owns useDebounce/useQuery and passes the results as `options`. */
  onSearchChange?: (term: string) => void;
  loading?: boolean;
  error?: boolean | string;
  onRetry?: () => void;
  /** Gets the raw search text (callers trim). */
  onCreate?: (term: string) => void;
  createLabel?: (term: string) => string;
  /** Enter in the search box with no option whose label equals the term calls `onCreate`. */
  createOnEnter?: boolean;
  /** Rendered below the list, outside `<Command>` (cmdk turns Enter on a button inside it into a row pick). */
  footer?: React.ReactNode;
  clearable?: boolean;
  clearLabel?: string;
  /** Truthy: the menu stays open, the rows give way to one status row, nothing can be picked. */
  pending?: boolean | string;
  /**
   * Default true. False: a pick only calls `onChange`; the menu stays open until the caller sets
   * `open` to false, or the user presses Esc / clicks outside (ContactCombobox: close on success).
   */
  closeOnSelect?: boolean;
  /** Replaces the whole row content (no check mark is added); `selected` = `option.value === value`. */
  renderOption?: (option: ComboOption<M>, state: { selected: boolean }) => React.ReactNode;
  /** Replaces the value text inside the trigger (its `title` stays `option.label`). */
  renderValue?: (option: ComboOption<M>) => React.ReactNode;
  id?: string;
  /** aria-required only — never blocks a submit. */
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  /** From shadcn `FormControl` / `LabeledField`; `invalid` wins when true. */
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  /** From `LabeledField`; `required` wins when true. */
  'aria-required'?: React.AriaAttributes['aria-required'];
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
  /** Trigger. */
  className?: string;
  wrapperClassName?: string;
  contentClassName?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const DEFAULT_TEXT = {
  placeholder: 'เลือก…',
  searchPlaceholder: 'พิมพ์เพื่อค้นหา…',
  searchLabel: 'ค้นหา',
  listLabel: 'ตัวเลือก',
  empty: 'ไม่พบรายการ',
  loading: 'กำลังโหลด…',
  error: 'โหลดรายการไม่สำเร็จ',
  retry: 'ลองใหม่',
  pending: 'กำลังเพิ่ม…',
  clear: 'ล้างค่า',
  create: (term: string) => `สร้าง “${term}”`,
} as const;

/**
 * Rows (Task 2 mockup): 44px like `ui/select.tsx` items (touch target at 390). Disabled rows are
 * drawn in the secondary text colour without fading — cmdk's default `opacity-50` leaves the
 * label at 3.19:1 and the reason at 2.10:1 (light), below 4.5:1.
 */
const ROW_CLASS =
  'min-h-11 py-2 leading-snug data-[disabled=true]:cursor-not-allowed data-[disabled=true]:text-muted-foreground data-[disabled=true]:opacity-100';

const TABBABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]';

const optionKey = (index: number) => `opt:${index}`;

function isCoarsePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** A printable key typed on the closed trigger: opens the menu and becomes the first search letter. */
function isTypeaheadKey(e: React.KeyboardEvent): boolean {
  return (
    e.key.length === 1 &&
    e.key !== ' ' &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.nativeEvent.isComposing &&
    e.keyCode !== 229
  );
}

/**
 * cmdk updates `aria-activedescendant` only on its own highlight moves, so a highlight set through
 * the `value` prop (the current value on open, the first row when server results arrive) is not
 * announced. Mirror the highlighted row onto the search box and the list; when cmdk moves the
 * highlight itself, its attribute and ours name the same row.
 */
function ActiveDescendantSync({
  inputRef,
  listRef,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  listRef: React.RefObject<HTMLDivElement | null>;
}) {
  const value = useCommandState((state) => state.value);
  const cmdkActiveId = useCommandState((state) => state.selectedItemId);
  React.useLayoutEffect(() => {
    // Runs after the rows' own layout effects wrote data-value, before cmdk re-renders them selected.
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[cmdk-item]') ?? [];
    const active = value ? Array.from(rows).find((row) => row.dataset.value === value) : undefined;
    for (const el of [inputRef.current, listRef.current]) {
      if (!el) continue;
      if (active) el.setAttribute('aria-activedescendant', active.id);
      else el.removeAttribute('aria-activedescendant');
    }
  }, [value, cmdkActiveId, inputRef, listRef]);
  return null;
}

/**
 * Searchable single-select (spec 2026-11-14 §6.1–§6.3). A raw `<button role="combobox">` with the
 * shared field skin (`formControlClass`, 44px via admin-typography.css) opens a portalled
 * `PopoverContent` holding a cmdk search box and listbox. Rows are ranked by `thai-search`;
 * cmdk's own filter is off and it only ever sees the keys `opt:${index}`.
 *
 * Accessible name = the caller's label (`<label htmlFor={id}>`, `aria-labelledby` or
 * `aria-label`); the component never names itself, so `getByRole('combobox', { name })`
 * keeps working after a value is picked. `id`, `ref`, `onBlur`, `aria-describedby`,
 * `aria-invalid` and `aria-required` reach the trigger, so it works under shadcn `FormControl`
 * and `LabeledField`.
 *
 * Keyboard: ArrowDown / Enter / Space open; a printable key opens and seeds the search; the
 * search box gets focus with the caret at the end (the list on a coarse pointer); Esc closes
 * only the menu (Radix layering inside Dialog / Sheet / AlertDialog); Tab past either end of
 * the menu closes it and returns focus to the trigger. Wheel/touchmove stop at the menu so it
 * scrolls inside a modal Dialog (same escape as WizardStackedOverlay).
 */
function Combobox<M = unknown>({
  value,
  onChange,
  options,
  selectedOption,
  placeholder = DEFAULT_TEXT.placeholder,
  searchable = true,
  searchPlaceholder = DEFAULT_TEXT.searchPlaceholder,
  searchLabel = DEFAULT_TEXT.searchLabel,
  listLabel = DEFAULT_TEXT.listLabel,
  emptyText = DEFAULT_TEXT.empty,
  filter,
  onSearchChange,
  loading = false,
  error = false,
  onRetry,
  onCreate,
  createLabel,
  createOnEnter = false,
  footer,
  clearable = false,
  clearLabel = DEFAULT_TEXT.clear,
  pending = false,
  closeOnSelect = true,
  renderOption,
  renderValue,
  id,
  required = false,
  disabled = false,
  invalid = false,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
  onBlur,
  className,
  wrapperClassName,
  contentClassName,
  align = 'start',
  side = 'bottom',
  open: openProp,
  onOpenChange,
  ref,
}: ComboboxProps<M> & { ref?: React.Ref<HTMLButtonElement> }): React.ReactElement {
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const sentTermRef = React.useRef('');
  const [openState, setOpenState] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const isPending = Boolean(pending);
  const open = !disabled && ((openProp ?? openState) || isPending);
  const showSearch = searchable || Boolean(onSearchChange);

  const isSelected = (o: ComboOption<M>) => value !== null && o.value === value;
  const inOptions = options.find(isSelected);
  // Trigger: the first option with `value`, else `selectedOption` when it carries `value`.
  const current =
    inOptions ?? (value !== null && selectedOption?.value === value ? selectedOption : null);
  const keys = React.useMemo(
    () => new Map(options.map((o, i) => [o, optionKey(i)] as const)),
    [options],
  );
  const keyOf = (o: ComboOption<M>) =>
    keys.get(o) ?? optionKey(options.findIndex((x) => x.value === o.value && x.label === o.label));
  const currentKey = inOptions ? keyOf(inOptions) : '';
  // The cmdk highlight (a row key). Controlled so the current value is highlighted on open.
  const [highlight, setHighlight] = React.useState(() => (open ? currentKey : ''));

  const term = search.trim();
  // Server mode: the caller's rows are already the search result (matched on fields the labels
  // may not show), so they are not filtered again unless the caller passes `filter`.
  const visible = filter
    ? filter(options, search)
    : onSearchChange
      ? options
      : filterAndRank(options, search);
  const sections = new Map<string, ComboOption<M>[]>();
  for (const o of visible) {
    const rows = sections.get(o.group ?? '');
    if (rows) rows.push(o);
    else sections.set(o.group ?? '', [o]);
  }
  const rows = [...sections.values()].flat(); // DOM order
  const firstEnabled = rows.find((o) => !o.disabled);
  const hasExactMatch =
    term !== '' && options.some((o) => normalizeThai(o.label) === normalizeThai(term));
  const canCreate = Boolean(onCreate) && term !== '' && !hasExactMatch && !loading && !isPending;
  const showClear = clearable && !disabled && value !== null && value !== '';
  const status = isPending
    ? typeof pending === 'string'
      ? pending
      : DEFAULT_TEXT.pending
    : loading
      ? DEFAULT_TEXT.loading
      : null;

  // Reset per open: highlight the current value (or let cmdk pick the first match of a seeded
  // search); clear the search on close.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setHighlight(term ? '' : currentKey);
    } else {
      setSearch('');
      setHighlight('');
    }
  }

  // While searching, a new set of rows (typing, or server results arriving after the debounce)
  // highlights the first enabled row, so Enter picks it.
  const rowsSignature = rows
    .map((o) => `${keyOf(o)}\u0000${o.value}\u0000${o.label}`)
    .join('\u0001');
  const [seenRows, setSeenRows] = React.useState(rowsSignature);
  if (rowsSignature !== seenRows) {
    setSeenRows(rowsSignature);
    if (open && term) setHighlight(firstEnabled ? keyOf(firstEnabled) : '');
  }

  // Server mode: the caller's query follows the search box, so tell it the search was cleared.
  React.useEffect(() => {
    if (!open && sentTermRef.current !== '') {
      sentTermRef.current = '';
      onSearchChange?.('');
    }
  }, [open, onSearchChange]);

  const setTriggerRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const setOpen = (next: boolean) => {
    if (next && disabled) return;
    if (!next && isPending) return;
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  const changeSearch = (next: string) => {
    setSearch(next);
    sentTermRef.current = next;
    onSearchChange?.(next);
  };

  const pick = (option: ComboOption<M>) => {
    if (option.disabled) return;
    onChange(option.value, option); // also when it is already the value (callers reset on re-pick)
    if (closeOnSelect) setOpen(false);
  };

  const create = () => {
    if (!onCreate) return;
    onCreate(search);
    setOpen(false);
  };

  const clear = () => {
    onChange('', null);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (open || disabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    } else if (isTypeaheadKey(e)) {
      e.preventDefault();
      if (showSearch) changeSearch(e.key);
      setOpen(true);
    }
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && createOnEnter && canCreate) {
      // preventDefault also stops cmdk's root handler from picking the highlighted row.
      e.preventDefault();
      create();
    }
  };

  const onContentKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey || isPending) return;
    const tabbables = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)).filter(
      (el) => el.tabIndex >= 0,
    );
    const edge = e.shiftKey ? tabbables[0] : tabbables[tabbables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (active && tabbables.includes(active) && active !== edge) return;
    // Past the last (or before the first) stop: close without picking, focus back on the trigger.
    e.preventDefault();
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onOpenAutoFocus = (e: Event) => {
    // Radix would select the whole search text, so the next typed letter replaced a seeded one.
    e.preventDefault();
    const input = inputRef.current;
    if (input && !isCoarsePointer()) {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    } else {
      // Touch: no on-screen keyboard until the user taps the search box; arrows/Enter still work.
      listRef.current?.focus();
    }
  };

  // A modal Dialog's scroll lock preventDefault()s wheel/touchmove that bubble out of its content;
  // the portalled menu is outside it, so stop them here.
  const stopScrollLock = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <span
      data-slot="combobox"
      className={cn('relative block w-full min-w-0 max-w-full', wrapperClassName)}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            ref={setTriggerRef}
            id={id}
            type="button"
            role="combobox"
            data-slot="combobox-trigger"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            aria-describedby={ariaDescribedby}
            aria-invalid={invalid ? true : ariaInvalid}
            aria-required={required ? true : ariaRequired}
            disabled={disabled}
            onKeyDown={onTriggerKeyDown}
            onBlur={onBlur}
            className={cn(
              formControlClass,
              'flex items-center justify-between gap-2 text-left',
              className,
            )}
          >
            {/* title on the text, not the button: on the button it would become the accessible
                description and the value would be read twice. mr-8 = room for the clear button. */}
            <span
              data-slot="combobox-value"
              title={current?.label}
              className={cn(
                'min-w-0 truncate',
                !current && 'text-muted-foreground',
                showClear && 'mr-8',
              )}
            >
              {current ? (renderValue ? renderValue(current) : current.label) : placeholder}
            </span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        {showClear && (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={clear}
            className="absolute right-9 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/30"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
        <PopoverContent
          data-slot="combobox-content"
          align={align}
          side={side}
          className={cn(
            'flex max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) min-w-64 flex-col overflow-hidden p-0',
            contentClassName,
          )}
          onOpenAutoFocus={onOpenAutoFocus}
          onKeyDown={onContentKeyDown}
          onWheel={stopScrollLock}
          onTouchMove={stopScrollLock}
        >
          <Command
            label={searchLabel}
            shouldFilter={false}
            vimBindings={false}
            value={highlight}
            onValueChange={setHighlight}
            className="min-h-0"
          >
            {showSearch && (
              <CommandInput
                ref={inputRef}
                // cmdk names the box through aria-labelledby (its hidden label = searchLabel); the
                // same text as an attribute keeps `input[aria-label=…]` selectors working
                // (tools/field-scale/menu-clip.mjs readMenuGeometry).
                aria-label={searchLabel}
                // The admin global focus outline would be clipped by the menu's overflow; the open
                // menu is the focus indicator (R2-0 mockup). Opt-out lives in admin-colors.css.
                data-combobox-search=""
                placeholder={searchPlaceholder}
                value={search}
                onValueChange={changeSearch}
                onKeyDown={onSearchKeyDown}
              />
            )}
            {status && (
              <div
                role="status"
                data-slot="combobox-status"
                className="flex items-center justify-center gap-2 px-3 py-6 text-sm leading-snug text-muted-foreground"
              >
                <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />
                {status}
              </div>
            )}
            <CommandList ref={listRef} label={listLabel} className="overscroll-contain">
              {!isPending &&
                [...sections].map(([group, groupRows]) => (
                  <CommandGroup key={`group:${group}`} heading={group || undefined}>
                    {groupRows.map((option) => {
                      const key = keyOf(option);
                      const selected = isSelected(option);
                      return (
                        <CommandItem
                          key={key}
                          value={key}
                          disabled={option.disabled}
                          onSelect={() => pick(option)}
                          className={ROW_CLASS}
                        >
                          {renderOption ? (
                            renderOption(option, { selected })
                          ) : (
                            <>
                              <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate">{option.label}</span>
                                {option.description && (
                                  <span className="text-xs text-muted-foreground">
                                    {option.description}
                                  </span>
                                )}
                                {option.disabled && option.disabledReason && (
                                  <span className="text-xs text-muted-foreground">
                                    {option.disabledReason}
                                  </span>
                                )}
                              </span>
                              {selected && (
                                // `!`: CommandItem's `[&_svg]:text-muted-foreground` (.x svg)
                                // outranks .text-primary
                                <Check
                                  aria-hidden="true"
                                  className="ml-auto size-4 text-primary!"
                                />
                              )}
                            </>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              {!loading && !error && !isPending && <CommandEmpty>{emptyText}</CommandEmpty>}
            </CommandList>
            <ActiveDescendantSync inputRef={inputRef} listRef={listRef} />
          </Command>
          {error && !isPending && (
            <div
              role="alert"
              data-slot="combobox-error"
              className="flex flex-col items-center gap-3 px-3 py-4 text-center text-sm leading-snug text-destructive"
            >
              <span className="flex items-center gap-2">
                <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
                {typeof error === 'string' ? error : DEFAULT_TEXT.error}
              </span>
              {onRetry && (
                <Button type="button" variant="outline" size="md" onClick={onRetry}>
                  <RotateCw aria-hidden="true" />
                  {DEFAULT_TEXT.retry}
                </Button>
              )}
            </div>
          )}
          {canCreate && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                data-slot="combobox-create"
                onClick={create}
                className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm leading-snug hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-hidden"
              >
                <Plus aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {createLabel ? createLabel(search) : DEFAULT_TEXT.create(term)}
                </span>
              </button>
            </div>
          )}
          {footer && (
            <div data-slot="combobox-footer" className="border-t border-border p-1">
              {footer}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </span>
  );
}

export { Combobox, type ComboboxProps, type ComboOption };
