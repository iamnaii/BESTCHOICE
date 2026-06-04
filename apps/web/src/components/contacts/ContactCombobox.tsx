// Reusable PEAK-style contact picker. Searches the party master (สมุดผู้ติดต่อ)
// across ALL roles (server-side, debounced). On pick it calls ensure-role so the
// chosen contact is provisioned into the field's role (e.g. a customer-only
// contact becomes a Supplier) and returns the child id to the parent.
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { contactsApi, contactKeys, type Contact, type ContactRole } from '@/lib/api/contacts';

const ROLE_LABELS: Record<ContactRole, string> = {
  CUSTOMER: 'ลูกค้า',
  SUPPLIER: 'ผู้ขาย',
  TRADE_IN_SELLER: 'คนขายมือสอง',
  FINANCE_COMPANY: 'ไฟแนนซ์',
};

export interface ContactPickResult {
  contactId: string;
  childId: string;
  name: string;
  taxId: string;
}

interface Props {
  // 'CUSTOMER' is forward-compat; backend provisions SUPPLIER now and 400s for CUSTOMER (surfaced via the onError toast).
  roleNeeded: 'SUPPLIER' | 'CUSTOMER';
  value: string;
  onSelect: (result: ContactPickResult) => void;
  /** When provided, a typed name with no exact match can be committed as a one-off. */
  onTypeName?: (name: string) => void;
  invalid?: boolean;
  placeholder?: string;
}

export function ContactCombobox({
  roleNeeded,
  value,
  onSelect,
  onTypeName,
  invalid,
  placeholder = 'เลือกผู้ติดต่อ หรือพิมพ์ชื่อ',
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);

  const query = useQuery({
    queryKey: contactKeys.list({ search: debounced || undefined, isActive: true, limit: 20 }),
    queryFn: () => contactsApi.list({ search: debounced || undefined, isActive: true, limit: 20 }),
    staleTime: 60 * 1000,
  });
  const contacts = query.data?.data ?? [];

  const hasExactMatch =
    !!search.trim() && contacts.some((c) => c.name.toLowerCase() === search.trim().toLowerCase());

  const commitTyped = (name: string) => {
    const n = name.trim();
    if (!n || !onTypeName) return;
    onTypeName(n);
    setOpen(false);
    setSearch('');
  };

  const ensureRoleMutation = useMutation({
    mutationFn: (c: Contact) => contactsApi.ensureRole(c.id, roleNeeded),
    onSuccess: (res, c) => {
      const childId = res.supplierId ?? res.customerId ?? '';
      onSelect({ contactId: c.id, childId, name: c.name, taxId: c.taxId ?? '' });
      setOpen(false);
      setSearch('');
    },
    onError: () => toast.error('ไม่สามารถเพิ่มบทบาทให้ผู้ติดต่อได้ กรุณาลองใหม่อีกครั้ง'),
  });

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
          <span className="truncate leading-snug" title={value || undefined}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="ค้นหาผู้ติดต่อ / เลขภาษี..."
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              if (onTypeName && e.key === 'Enter' && search.trim() && !hasExactMatch) {
                e.preventDefault();
                e.stopPropagation();
                commitTyped(search);
              }
            }}
          />
          <CommandList>
            {query.isLoading || ensureRoleMutation.isPending ? (
              <CommandEmpty>{ensureRoleMutation.isPending ? 'กำลังเพิ่ม...' : 'กำลังโหลด...'}</CommandEmpty>
            ) : (
              <>
                {query.isError && (
                  <CommandEmpty className="px-3 py-6 text-center leading-snug text-destructive">
                    โหลดข้อมูลไม่สำเร็จ
                  </CommandEmpty>
                )}
                {!query.isError && contacts.length === 0 && !!search.trim() && !onTypeName && (
                  <CommandEmpty className="px-3 py-6 text-center leading-snug">
                    ไม่พบผู้ติดต่อที่ตรงกับ "{search.trim()}"
                  </CommandEmpty>
                )}
                {contacts.length > 0 && (
                  <CommandGroup heading="สมุดผู้ติดต่อ">
                    {contacts.map((c) => (
                      <CommandItem key={c.id} value={c.id} onSelect={() => ensureRoleMutation.mutate(c)}>
                        <Check
                          className={cn(
                            'mr-2 size-4 shrink-0',
                            value === c.name ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <span className="flex-1 truncate leading-snug">{c.name}</span>
                        <span className="ml-2 flex shrink-0 gap-1">
                          {c.roles.map((r) => (
                            <Badge key={r} variant="secondary" className="text-2xs">
                              {ROLE_LABELS[r]}
                            </Badge>
                          ))}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {contacts.length === 0 && !search.trim() && (
                  <CommandEmpty className="px-3 py-6 text-center leading-snug">
                    พิมพ์เพื่อค้นหาผู้ติดต่อ
                  </CommandEmpty>
                )}
                {onTypeName && search.trim() && !hasExactMatch && (
                  <CommandGroup heading="ใช้ครั้งเดียว (ไม่บันทึกในสมุด)">
                    <CommandItem value={`__typed__${search}`} onSelect={() => commitTyped(search)}>
                      <Plus className="mr-2 size-4 shrink-0" />
                      <span className="truncate leading-snug">ใช้ชื่อ "{search.trim()}"</span>
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
