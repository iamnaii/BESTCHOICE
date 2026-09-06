import { useEffect, useRef, useState } from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Plus, Search, X } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { formatNumberDecimal } from '@/utils/formatters';
import { accessoryTypes } from '../../../constants';
import {
  latestModels,
  searchCatalog,
  storageRange,
  type AccessorySku,
  type CatalogEntry,
  type CatalogKind,
} from '../../../po-catalog.util';
import { ChipGroup } from './ChipGroup';

/** How a model was picked — the search flow keeps typing, the chip flow jumps to the new row. */
export type PickVia = 'search' | 'chip';

type PickMode = 'PHONE' | 'TABLET' | 'ACCESSORY';

// ใหม่/มือสอง is a column on each row (owner 2026-09-06), so the picker only chooses the kind.
const MODES = [
  { value: 'PHONE', label: 'โทรศัพท์' },
  { value: 'TABLET', label: 'แท็บเล็ต' },
  { value: 'ACCESSORY', label: 'อุปกรณ์เสริม' },
];

const SEARCH_DEBOUNCE_MS = 200;

const quickChip =
  'inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border border-input bg-background pl-2 pr-2.5 text-xs font-medium ' +
  'text-foreground transition-colors duration-150 hover:border-primary/50 hover:text-primary ' +
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40';

interface CatalogPickerProps {
  onPick: (entry: CatalogEntry, via: PickVia) => void;
  /** Accessory chip → a NEW accessory row of that type. */
  onPickAccessory: (accessoryType: string) => void;
  /** Accessory search result → re-order an EXISTING product (name/code kept). */
  onPickExisting: (sku: AccessorySku) => void;
  /** Async lookup of existing accessory SKUs by name/code (GET /products/accessory-skus). */
  searchAccessorySkus: (search: string) => Promise<AccessorySku[]>;
}

/**
 * Search-first picker: type → Enter/click adds a row. โทรศัพท์/แท็บเล็ต search the static
 * catalog; อุปกรณ์เสริม searches the shop's EXISTING accessory products (Tooltify codes like
 * F1601 included) so a re-order keeps the same product name, with chips underneath for a
 * brand-new item. The list opens only on an explicit gesture — typing, clicking the box, or
 * ArrowDown — never on focus alone, so adding via a quick chip does not pop the list over
 * the table (owner feedback 2026-09-06). Results render inline (no portal) so the modal's
 * scroll container cannot clip them.
 */
export function CatalogPicker({ onPick, onPickAccessory, onPickExisting, searchAccessorySkus }: CatalogPickerProps) {
  const [mode, setMode] = useState<PickMode>('PHONE');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [skus, setSkus] = useState<AccessorySku[]>([]);
  const [skuLoading, setSkuLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

  const isAccessory = mode === 'ACCESSORY';
  const kind: CatalogKind = mode === 'TABLET' ? 'TABLET' : 'PHONE';
  const results = isAccessory ? [] : searchCatalog(query, kind, 12);
  const latest = latestModels(kind, 6);

  // Existing-SKU lookup: debounced, latest request wins. An empty query lists what is in stock.
  useEffect(() => {
    if (!isAccessory || !open) return;
    const seq = ++requestSeq.current;
    setSkuLoading(true);
    const timer = setTimeout(() => {
      searchAccessorySkus(query.trim())
        .then((rows) => {
          if (requestSeq.current !== seq) return;
          setSkus(rows);
          setSkuLoading(false);
        })
        .catch(() => {
          if (requestSeq.current !== seq) return;
          setSkus([]);
          setSkuLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isAccessory, open, query, searchAccessorySkus]);

  function pick(entry: CatalogEntry, via: PickVia) {
    onPick(entry, via);
    setQuery('');
    setOpen(false);
    // Search flow: stay in the box (closed) so the next model can be typed straight away.
    // Chip flow: leave focus alone — StepItems moves it to the new row.
    if (via === 'search') inputRef.current?.focus();
  }

  function pickExisting(sku: AccessorySku) {
    onPickExisting(sku);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  const searchLabel = isAccessory ? 'ค้นหาสินค้าเดิม' : 'ค้นหารุ่น';
  const placeholder = isAccessory
    ? 'พิมพ์ชื่อหรือรหัสสินค้าเดิม เช่น F1601, ฟิล์ม 16'
    : kind === 'TABLET'
      ? 'พิมพ์ชื่อรุ่น เช่น ipad air, mini'
      : 'พิมพ์ชื่อรุ่น เช่น 16 pro, 17, air';

  return (
    <div className="space-y-3">
      <ChipGroup
        label="ประเภทสินค้า"
        hideLabel
        size="md"
        options={MODES}
        value={mode}
        onChange={(v) => {
          setMode(v as PickMode);
          setQuery('');
          setOpen(false);
          setSkus([]);
        }}
      />

      {/* cmdk names the input via aria-labelledby → the Command `label`, so aria-label alone is ignored */}
      <Command label={searchLabel} shouldFilter={false} loop className="overflow-visible bg-transparent">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <CommandPrimitive.Input
            ref={inputRef}
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setOpen(false);
                e.currentTarget.blur();
              } else if (e.key === 'ArrowDown' && !open) {
                setOpen(true);
              }
            }}
            aria-label={searchLabel}
            placeholder={placeholder}
            className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-9 text-sm outline-hidden placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          {query && (
            <button
              type="button"
              aria-label="ล้างคำค้นหา"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
          {open && (
            <div
              // keep focus in the input while clicking a result (blur would unmount the list first)
              onMouseDown={(e) => e.preventDefault()}
              className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
            >
              <CommandList className="max-h-72">
                {isAccessory ? (
                  skuLoading && skus.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-muted-foreground">กำลังค้นหา…</div>
                  ) : (
                    <>
                      <CommandEmpty>{query ? `ไม่พบสินค้า "${query}" — สร้างรายการใหม่ด้านล่างได้` : 'ยังไม่มีอุปกรณ์เสริมในคลัง'}</CommandEmpty>
                      <CommandGroup heading={query ? 'สินค้าเดิม' : 'สินค้าเดิมที่มีในคลัง'}>
                        {skus.map((s) => (
                          <CommandItem
                            key={`${s.code ?? ''}|${s.name}`}
                            value={`${s.code ?? ''}|${s.name}`}
                            aria-label={s.name}
                            onSelect={() => pickExisting(s)}
                          >
                            <span className="w-24 shrink-0 truncate font-mono text-xs text-muted-foreground">{s.code ?? '—'}</span>
                            <span className="min-w-0 flex-1 truncate">{s.name}</span>
                            <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                              คงเหลือ {s.inStock}
                              {s.lastCost != null ? ` · ทุน ฿${formatNumberDecimal(s.lastCost, 2)}` : ''}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </>
                  )
                ) : (
                  <>
                    <CommandEmpty>ไม่พบรุ่น "{query}"</CommandEmpty>
                    <CommandGroup heading={kind === 'TABLET' ? 'iPad' : 'iPhone'}>
                      {results.map((e) => (
                        <CommandItem key={e.name} value={e.name} aria-label={e.name} onSelect={() => pick(e, 'search')}>
                          <span className="flex-1 truncate">{e.name}</span>
                          <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">{storageRange(e.storage)}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}
              </CommandList>
              <div className="border-t border-border px-3 py-1.5 text-2xs text-muted-foreground">
                ↑↓ เลือก · Enter เพิ่ม · Esc ปิด
              </div>
            </div>
          )}
        </div>
      </Command>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-0.5 text-xs text-muted-foreground">{isAccessory ? 'หรือสร้างรายการใหม่' : 'รุ่นล่าสุด'}</span>
        <div role="group" aria-label={isAccessory ? 'ประเภทอุปกรณ์' : 'รุ่นล่าสุด'} className="flex flex-wrap gap-2">
          {isAccessory
            ? accessoryTypes.map((t) => (
                <button key={t.value} type="button" onClick={() => onPickAccessory(t.value)} className={quickChip}>
                  <Plus className="size-3.5" />
                  {t.label}
                </button>
              ))
            : latest.map((e) => (
                <button key={e.name} type="button" onClick={() => pick(e, 'chip')} className={quickChip}>
                  <Plus className="size-3.5" />
                  {e.name}
                </button>
              ))}
        </div>
      </div>
    </div>
  );
}
