import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, Plus, X } from 'lucide-react';
import CustomerCreateDialog, {
  splitDisplayName,
  type CreatedCustomer,
} from '@/components/customer/CustomerCreateDialog';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebounce } from '@/hooks/useDebounce';
import api from '@/lib/api';
import type { CustomerOption } from '../types';

/**
 * ค้นหา + เลือกลูกค้าในช่องเดียว (เดิมเป็น Input ค้นหา + Select แยกกัน) · ไม่ส่ง `view` ให้ /customers
 * เพราะใบจองต้องเลือกได้ทั้งลูกค้าและผู้สนใจ (ด่านเบอร์อยู่ฝั่ง API) · ลูกค้าที่เลือกไว้คงอยู่แม้การค้นหาครั้งถัดไปล้ม
 */
export default function CustomerCombobox({
  value,
  onChange,
  disabled,
  canCreate,
}: {
  value: CustomerOption | null;
  onChange: (customer: CustomerOption | null) => void;
  disabled?: boolean;
  canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const term = useDebounce(search.trim());
  const {
    data: options = [],
    isFetching,
    isError,
    refetch,
  } = useQuery<CustomerOption[]>({
    queryKey: ['booking-customer-search', term],
    enabled: open,
    queryFn: async () => {
      const { data } = await api.get(
        `/customers?${new URLSearchParams({ limit: '20', search: term })}`,
      );
      return (data.data ?? data ?? []) as CustomerOption[];
    },
  });

  const describe = (c: CustomerOption) =>
    c.chatPlaceholder ? 'จากแชท · ยังไม่มีเบอร์' : c.phone ? c.phone : '';

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="ลูกค้า"
            disabled={disabled}
            className="h-10 w-full justify-between font-normal"
          >
            {value ? (
              <span className="truncate">
                <span className="font-medium">{value.name}</span>
                {describe(value) && (
                  <span className="text-muted-foreground"> · {describe(value)}</span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">ค้นหาชื่อหรือเบอร์โทรลูกค้า…</span>
            )}
            <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="พิมพ์ชื่อหรือเบอร์โทร"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {isError && (
                <div className="p-3 text-sm">
                  <button
                    type="button"
                    className="text-destructive underline"
                    onClick={() => refetch()}
                  >
                    โหลดลูกค้าไม่สำเร็จ ลองอีกครั้ง
                  </button>
                </div>
              )}
              {isFetching && (
                <p className="p-3 text-xs text-muted-foreground">กำลังค้นหาลูกค้า...</p>
              )}
              {!isFetching && !isError && (
                <CommandEmpty>ไม่พบลูกค้า — พิมพ์ชื่อหรือเบอร์ให้ครบขึ้น</CommandEmpty>
              )}
              <CommandGroup>
                {options.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => {
                      onChange(c);
                      setOpen(false);
                    }}
                  >
                    <span className="flex min-w-0 flex-col leading-snug">
                      <span className="truncate font-medium">{c.name}</span>
                      {describe(c) && (
                        <span className="text-xs text-muted-foreground">{describe(c)}</span>
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {canCreate && (
                <div className="border-t border-border p-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => {
                      setOpen(false);
                      setCreateOpen(true);
                    }}
                  >
                    <Plus className="size-3.5" /> สร้างลูกค้าใหม่
                    {search.trim() ? ` “${search.trim()}”` : ''}
                  </Button>
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="ล้างลูกค้า"
          onClick={() => onChange(null)}
        >
          <X className="size-4" />
        </Button>
      )}
      <CustomerCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialValues={search.trim() ? splitDisplayName(search.trim()) : undefined}
        onCreated={(created: CreatedCustomer) => {
          onChange({ id: created.id, name: created.name, phone: created.phone ?? null });
          setCreateOpen(false);
        }}
      />
    </div>
  );
}
