// Reusable PEAK-style contact picker. Searches the party master (สมุดผู้ติดต่อ)
// across ALL roles (server-side, debounced). On pick it calls ensure-role so the
// chosen contact is provisioned into the field's role (e.g. a customer-only
// contact becomes a Supplier) and returns the child id to the parent.
//
// v2 change: free-text one-off path removed. Typed searches with no exact match
// show an inline "+ สร้างผู้ติดต่อใหม่" action that opens CreateContactModal.
// The created contact flows out through the same onSelect callback as a picked one.
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
import CreateContactModal from './CreateContactModal';

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
  // TRADE_IN_SELLER: backend adds the role directly to the Contact (no child entity created).
  // For create, ContactCombobox opens CreateContactModal in CUSTOMER mode (creates a person),
  // then calls ensureRole(contactId, 'TRADE_IN_SELLER') afterwards to add the role.
  roleNeeded: 'SUPPLIER' | 'CUSTOMER' | 'TRADE_IN_SELLER';
  value: string;
  onSelect: (result: ContactPickResult) => void;
  /**
   * @deprecated Since v2 the free-text one-off path has been replaced by an
   * inline "สร้างผู้ติดต่อใหม่" action that opens CreateContactModal.
   * This prop is kept for back-compat so existing callers (e.g. VendorCombobox)
   * continue to typecheck, but it is no longer called.
   */
  onTypeName?: (name: string) => void;
  invalid?: boolean;
  placeholder?: string;
}

export function ContactCombobox({
  roleNeeded,
  value,
  onSelect,
  // onTypeName kept for back-compat typecheck — intentionally unused (see @deprecated above)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onTypeName: _onTypeName,
  invalid,
  placeholder = 'เลือกผู้ติดต่อ หรือพิมพ์ชื่อ',
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const debounced = useDebounce(search);

  const query = useQuery({
    queryKey: contactKeys.list({ search: debounced || undefined, isActive: true, limit: 20 }),
    queryFn: () => contactsApi.list({ search: debounced || undefined, isActive: true, limit: 20 }),
    staleTime: 60 * 1000,
  });
  const contacts = query.data?.data ?? [];

  const hasExactMatch =
    !!search.trim() && contacts.some((c) => c.name.toLowerCase() === search.trim().toLowerCase());

  const showCreateAction = !!search.trim() && !hasExactMatch && !query.isLoading;

  const ensureRoleMutation = useMutation({
    mutationFn: (c: Contact) => contactsApi.ensureRole(c.id, roleNeeded),
    onSuccess: (res, c) => {
      // TRADE_IN_SELLER has no child entity (no supplierId/customerId) — fall back to contactId
      const childId = res.supplierId ?? res.customerId ?? c.id;
      onSelect({ contactId: c.id, childId, name: c.name, taxId: c.taxId ?? '' });
      setOpen(false);
      setSearch('');
    },
    onError: () => toast.error('ไม่สามารถเพิ่มบทบาทให้ผู้ติดต่อได้ กรุณาลองใหม่อีกครั้ง'),
  });

  const handleCreated = async (r: { contactId: string; childId: string; name: string; taxId: string }) => {
    // For TRADE_IN_SELLER, CreateContactModal creates a Customer (a person). We then
    // need to add the TRADE_IN_SELLER role via ensureRole so the trade-in record can
    // reference this contact. childId falls back to contactId (no child entity for this role).
    if (roleNeeded === 'TRADE_IN_SELLER') {
      try {
        await contactsApi.ensureRole(r.contactId, 'TRADE_IN_SELLER');
      } catch {
        toast.error('ไม่สามารถเพิ่มบทบาทผู้ขายมือสองได้ กรุณาลองใหม่อีกครั้ง');
        return;
      }
      onSelect({ contactId: r.contactId, childId: r.contactId, name: r.name, taxId: r.taxId });
    } else {
      onSelect({ contactId: r.contactId, childId: r.childId, name: r.name, taxId: r.taxId });
    }
    setCreateOpen(false);
    setOpen(false);
    setSearch('');
  };

  return (
    <>
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
                if (e.key === 'Enter' && search.trim() && !hasExactMatch && !query.isLoading) {
                  e.preventDefault();
                  e.stopPropagation();
                  setCreateOpen(true);
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
                  {!query.isError && contacts.length === 0 && !!search.trim() && !showCreateAction && (
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
                            {!c.phone && (
                              <Badge variant="outline" className="text-2xs text-muted-foreground">
                                ข้อมูลไม่ครบ
                              </Badge>
                            )}
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
                  {showCreateAction && (
                    <CommandGroup heading="สร้างใหม่">
                      <CommandItem
                        value={`__create__${search}`}
                        onSelect={() => setCreateOpen(true)}
                      >
                        <Plus className="mr-2 size-4 shrink-0" />
                        <span className="truncate leading-snug">
                          + สร้างผู้ติดต่อใหม่ "{search.trim()}"
                        </span>
                      </CommandItem>
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* TRADE_IN_SELLER creates via CUSTOMER modal (an individual person);
          ensureRole adds the TRADE_IN_SELLER role afterwards in handleCreated. */}
      <CreateContactModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        role={roleNeeded === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER'}
        initialName={search.trim()}
        onCreated={handleCreated}
      />
    </>
  );
}
