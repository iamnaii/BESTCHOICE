import { useRef, useState } from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Plus, Search, X } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { accessoryTypes } from '../../../constants';
import {
  latestModels,
  searchCatalog,
  storageRange,
  type CatalogEntry,
  type CatalogKind,
  type PhoneMode,
} from '../../../po-catalog.util';
import { ChipGroup } from './ChipGroup';

type PickMode = PhoneMode | 'TABLET' | 'ACCESSORY';

const MODES = [
  { value: 'PHONE_NEW', label: 'โทรศัพท์ใหม่' },
  { value: 'PHONE_USED', label: 'มือสอง' },
  { value: 'TABLET', label: 'แท็บเล็ต' },
  { value: 'ACCESSORY', label: 'อุปกรณ์เสริม' },
];

const quickChip =
  'inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-input bg-background pl-2 pr-2.5 text-xs font-medium ' +
  'text-foreground transition-colors duration-150 hover:border-primary/50 hover:text-primary ' +
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40';

interface CatalogPickerProps {
  onPick: (entry: CatalogEntry, phoneMode: PhoneMode) => void;
  onPickAccessory: (accessoryType: string) => void;
}

/**
 * Search-first picker: type a model → Enter/click adds a row. The mode chips set the
 * category of the next row (ใหม่/มือสอง/แท็บเล็ต) or switch to accessory types.
 * Results render inline (no portal) so the modal's scroll container can't clip them.
 */
export function CatalogPicker({ onPick, onPickAccessory }: CatalogPickerProps) {
  const [mode, setMode] = useState<PickMode>('PHONE_NEW');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const kind: CatalogKind = mode === 'TABLET' ? 'TABLET' : 'PHONE';
  const phoneMode: PhoneMode = mode === 'PHONE_USED' ? 'PHONE_USED' : 'PHONE_NEW';
  const results = searchCatalog(query, kind, 12);
  const latest = latestModels(kind, 6);

  function pick(entry: CatalogEntry) {
    onPick(entry, phoneMode);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div className="space-y-2.5">
      <ChipGroup
        label="ประเภทสินค้า"
        hideLabel
        size="md"
        options={MODES}
        value={mode}
        onChange={(v) => {
          setMode(v as PickMode);
          setQuery('');
        }}
      />

      {mode === 'ACCESSORY' ? (
        <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 dark:bg-primary/10">
          <p className="mb-2 text-xs leading-snug text-muted-foreground">
            เลือกประเภทอุปกรณ์เพื่อเพิ่มแถว แล้วระบุยี่ห้อและรุ่นที่รองรับในแถวนั้น
          </p>
          <div role="group" aria-label="ประเภทอุปกรณ์" className="flex flex-wrap gap-1.5">
            {accessoryTypes.map((t) => (
              <button key={t.value} type="button" onClick={() => onPickAccessory(t.value)} className={cn(quickChip, 'h-8')}>
                <Plus className="size-3.5" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* cmdk names the input via aria-labelledby → the Command `label`, so aria-label alone is ignored */}
          <Command label="ค้นหารุ่น" shouldFilter={false} loop className="overflow-visible bg-transparent">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <CommandPrimitive.Input
                ref={inputRef}
                value={query}
                onValueChange={(v) => {
                  setQuery(v);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setOpen(false);
                    e.currentTarget.blur();
                  }
                }}
                aria-label="ค้นหารุ่น"
                placeholder={kind === 'TABLET' ? 'พิมพ์ชื่อรุ่น เช่น ipad air, mini' : 'พิมพ์ชื่อรุ่น เช่น 16 pro, 17, air'}
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
                  <CommandList className="max-h-64">
                    <CommandEmpty>ไม่พบรุ่น "{query}"</CommandEmpty>
                    <CommandGroup heading={kind === 'TABLET' ? 'iPad' : 'iPhone'}>
                      {results.map((e) => (
                        <CommandItem key={e.name} value={e.name} aria-label={e.name} onSelect={() => pick(e)}>
                          <span className="flex-1 truncate">{e.name}</span>
                          <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">{storageRange(e.storage)}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                  <div className="border-t border-border px-3 py-1.5 text-2xs text-muted-foreground">
                    ↑↓ เลือก · Enter เพิ่ม · Esc ปิด
                  </div>
                </div>
              )}
            </div>
          </Command>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-xs text-muted-foreground">รุ่นล่าสุด</span>
            <div role="group" aria-label="รุ่นล่าสุด" className="flex flex-wrap gap-1.5">
              {latest.map((e) => (
                <button key={e.name} type="button" onClick={() => pick(e)} className={quickChip}>
                  <Plus className="size-3" />
                  {e.name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
