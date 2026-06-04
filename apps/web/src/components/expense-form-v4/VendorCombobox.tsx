// Expense form V4 — vendor picker.
// Replaces the free-text "ผู้ขาย" input with a searchable combobox sourced from
// the Contact book (SUPPLIER role) — the same canonical vendor master the Asset
// module uses. Selecting a supplier auto-fills name + tax id; a typed name that
// matches no supplier is committed as a one-off vendor (preserves the legacy
// free-text flow for vendors that aren't registered).
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
import { contactsApi } from '@/lib/api/contacts';

interface Props {
  value: string;
  /** A supplier was picked from the contact book — autofill name + taxId. */
  onSelectSupplier: (s: { name: string; taxId: string }) => void;
  /** A free-typed one-off name (no matching supplier in the contact book). */
  onTypeName: (name: string) => void;
  invalid?: boolean;
}

export function VendorCombobox({ value, onSelectSupplier, onTypeName, invalid }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Vendor master = สมุดผู้ติดต่อ (Contacts with the SUPPLIER role). Cached ~5 min.
  const suppliersQuery = useQuery({
    queryKey: ['vendor-contacts', 'supplier'],
    queryFn: () => contactsApi.list({ role: 'SUPPLIER', isActive: true, limit: 200 }),
    staleTime: 5 * 60 * 1000,
  });
  const suppliers = suppliersQuery.data?.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.taxId ?? '').toLowerCase().includes(q),
    );
  }, [search, suppliers]);

  const hasExactMatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    return !!q && suppliers.some((s) => s.name.toLowerCase() === q);
  }, [search, suppliers]);

  const isKnownVendor = useMemo(
    () => !!value && suppliers.some((s) => s.name === value),
    [value, suppliers],
  );

  const commitTyped = (name: string) => {
    const n = name.trim();
    if (!n) return;
    onTypeName(n);
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
          className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground')}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {isKnownVendor ? (
              <Check className="size-3.5 shrink-0 text-primary" />
            ) : value ? (
              <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
            ) : null}
            <span className="truncate leading-snug" title={value || undefined}>
              {value || 'เลือกผู้ขาย หรือพิมพ์ชื่อ'}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="ค้นหาผู้ขาย / เลขภาษี หรือพิมพ์ชื่อใหม่..."
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              // Enter on a typed name with no exact supplier match commits it as
              // a one-off vendor (and blocks cmdk from picking a partial match).
              if (e.key === 'Enter' && search.trim() && !hasExactMatch) {
                e.preventDefault();
                e.stopPropagation();
                commitTyped(search);
              }
            }}
          />
          <CommandList>
            {suppliersQuery.isLoading ? (
              <CommandEmpty>กำลังโหลด...</CommandEmpty>
            ) : suppliers.length === 0 && !search.trim() ? (
              <CommandEmpty className="px-3 py-6 text-center leading-snug">
                ยังไม่มีผู้ขายในสมุดผู้ติดต่อ — พิมพ์ชื่อเพื่อใช้ได้เลย
              </CommandEmpty>
            ) : (
              <>
                {filtered.length > 0 && (
                  <CommandGroup heading="ผู้ขายในสมุดผู้ติดต่อ">
                    {filtered.map((s) => (
                      <CommandItem
                        key={s.id}
                        value={s.id}
                        onSelect={() => {
                          onSelectSupplier({ name: s.name, taxId: s.taxId ?? '' });
                          setOpen(false);
                          setSearch('');
                        }}
                      >
                        <Check
                          className={cn(
                            'mr-2 size-4 shrink-0',
                            value === s.name ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <span className="flex-1 truncate leading-snug">{s.name}</span>
                        {s.taxId && (
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {s.taxId}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {search.trim() && !hasExactMatch && (
                  <CommandGroup heading="ผู้ขายครั้งเดียว (ไม่บันทึกในสมุด)">
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
