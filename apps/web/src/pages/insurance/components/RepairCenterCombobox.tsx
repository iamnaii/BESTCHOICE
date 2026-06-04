// Repair-center picker for the insurance/repair-ticket flow.
// Adapts the UX of expense-form-v4/VendorCombobox but sources suppliers from the
// same /suppliers endpoint SendDialog already uses (debounced search), then
// filters isRepairCenter===true CLIENT-SIDE (the backend has no such param yet).
// Selecting a repair center returns its supplier id + name; the field stores the
// id in repairSupplierId. A typed name with no match is committed as a one-off
// (id stays empty) to preserve the existing free-text fallback.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';

interface SupplierHit {
  id: string;
  name: string;
  isRepairCenter?: boolean;
}

interface Props {
  /** Current repairSupplierId (empty string when none/one-off). */
  value: string;
  /** Display name for the current selection (or typed one-off name). */
  displayName: string;
  /** A repair center was picked (id) or a one-off name was typed (id=''). */
  onSelect: (s: { id: string; name: string }) => void;
  invalid?: boolean;
}

export function RepairCenterCombobox({ value, displayName, onSelect, invalid }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 350);

  const { data: suppliers, isLoading } = useQuery<SupplierHit[]>({
    queryKey: ['suppliers-repair-center', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch || debouncedSearch.length < 1) return [];
      // NOTE: The suppliers API does not yet filter on isRepairCenter server-side —
      // filter client-side until backend exposes the param (TODO: add isRepairCenter
      // query param to suppliers controller GET /suppliers).
      const res = await api.get(`/suppliers?search=${encodeURIComponent(debouncedSearch)}&limit=20`);
      const all: SupplierHit[] = res.data?.data ?? [];
      return all.filter((s) => s.isRepairCenter === true);
    },
    enabled: debouncedSearch.length >= 1,
  });

  const results = suppliers ?? [];

  const hasExactMatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    return !!q && results.some((s) => s.name.toLowerCase() === q);
  }, [search, results]);

  const isKnownCenter = !!value;

  const commitTyped = (name: string) => {
    const n = name.trim();
    if (!n) return;
    onSelect({ id: '', name: n });
    setOpen(false);
    setSearch('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className={cn(
            'w-full justify-between font-normal',
            !displayName && 'text-muted-foreground',
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {isKnownCenter ? (
              <Check className="size-3.5 shrink-0 text-primary" />
            ) : displayName ? (
              <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
            ) : null}
            <span className="truncate leading-snug" title={displayName || undefined}>
              {displayName || 'เลือกศูนย์ซ่อม หรือพิมพ์ชื่อ'}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="ค้นหาศูนย์ซ่อม หรือพิมพ์ชื่อใหม่..."
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              // Enter on a typed name with no exact match commits it as a one-off
              // repair center (and blocks cmdk from picking a partial match).
              if (e.key === 'Enter' && search.trim() && !hasExactMatch) {
                e.preventDefault();
                e.stopPropagation();
                commitTyped(search);
              }
            }}
          />
          <CommandList>
            {!search.trim() ? (
              <CommandEmpty className="px-3 py-6 text-center leading-snug">
                พิมพ์เพื่อค้นหาศูนย์ซ่อม
              </CommandEmpty>
            ) : isLoading ? (
              <CommandEmpty>กำลังโหลด...</CommandEmpty>
            ) : (
              <>
                {results.length > 0 && (
                  <CommandGroup heading="ศูนย์ซ่อม">
                    {results.map((s) => (
                      <CommandItem
                        key={s.id}
                        value={s.id}
                        onSelect={() => {
                          onSelect({ id: s.id, name: s.name });
                          setOpen(false);
                          setSearch('');
                        }}
                      >
                        <Check
                          className={cn(
                            'mr-2 size-4 shrink-0',
                            value === s.id ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <span className="flex-1 truncate leading-snug">{s.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {!hasExactMatch && (
                  <CommandGroup heading="ใช้ชื่อที่พิมพ์">
                    <CommandItem value={`__typed__${search}`} onSelect={() => commitTyped(search)}>
                      <Plus className="mr-2 size-4 shrink-0" />
                      <span className="truncate leading-snug">ใช้ชื่อ “{search.trim()}”</span>
                    </CommandItem>
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
