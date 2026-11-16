// Reusable PEAK-style contact picker. Searches the party master (สมุดผู้ติดต่อ)
// across ALL roles (server-side, debounced). On pick it calls ensure-role so the
// chosen contact is provisioned into the field's role (e.g. a customer-only
// contact becomes a Supplier) and returns the child id to the parent.
//
// v2 change: free-text one-off path removed. Typed searches with no exact match
// show an inline "+ สร้างผู้ติดต่อใหม่" action that opens CreateContactModal.
// The created contact flows out through the same onSelect callback as a picked one.
//
// R2-3b: a thin shell on the shared <Combobox>. Kept on purpose (pinned by
// ContactCombobox.test.tsx): `value` is the display NAME and a row is ticked when
// its name equals it · the list loads on mount, not on open · a pick keeps the menu
// open with "กำลังเพิ่ม…" until ensure-role succeeds (error = toast, menu stays) ·
// Enter with no exact name match opens create-contact.
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { contactsApi, contactKeys, type Contact, type ContactRole } from '@/lib/api/contacts';
import CreateContactModal from './CreateContactModal';

const ROLE_LABELS: Record<ContactRole, string> = {
  CUSTOMER: 'ลูกค้า',
  SUPPLIER: 'ผู้จัดจำหน่าย',
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
  id?: string;
  className?: string;
  // TRADE_IN_SELLER: backend adds the role directly to the Contact (no child entity created).
  // For create, ContactCombobox opens CreateContactModal in CUSTOMER mode (creates a person),
  // then calls ensureRole(contactId, 'TRADE_IN_SELLER') afterwards to add the role.
  roleNeeded: 'SUPPLIER' | 'CUSTOMER' | 'TRADE_IN_SELLER';
  value: string;
  onSelect: (result: ContactPickResult) => void;
  invalid?: boolean;
  placeholder?: string;
}

/** The server already matched name / phone / tax id / contact code — keep its rows and order. */
const keepServerRows = (options: ComboOption<Contact>[]) => options;

function ContactRow({ contact, selected }: { contact: Contact; selected: boolean }) {
  return (
    <>
      <Check
        aria-hidden="true"
        className={cn('mr-2 size-4 shrink-0 text-primary!', selected ? 'opacity-100' : 'opacity-0')}
      />
      <span className="flex-1 truncate leading-snug">{contact.name}</span>
      <span className="ml-2 flex shrink-0 gap-1">
        {contact.roles.map((r) => (
          <Badge key={r} variant="secondary" className="text-2xs">
            {ROLE_LABELS[r]}
          </Badge>
        ))}
        {!contact.phone && (
          <Badge variant="outline" className="text-2xs text-muted-foreground">
            ข้อมูลไม่ครบ
          </Badge>
        )}
      </span>
    </>
  );
}

export function ContactCombobox({
  id,
  className,
  roleNeeded,
  value,
  onSelect,
  invalid,
  placeholder = 'เลือก/ค้นหาผู้ติดต่อ',
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const debounced = useDebounce(search);

  // No `enabled`: the first page loads on mount so the menu opens onto rows.
  const query = useQuery({
    queryKey: contactKeys.list({ search: debounced || undefined, isActive: true, limit: 20 }),
    queryFn: () => contactsApi.list({ search: debounced || undefined, isActive: true, limit: 20 }),
    staleTime: 60 * 1000,
  });
  const contacts = query.data?.data ?? [];

  const ensureRoleMutation = useMutation({
    mutationFn: (c: Contact) => contactsApi.ensureRole(c.id, roleNeeded),
    onSuccess: (res, c) => {
      // TRADE_IN_SELLER has no child entity (no supplierId/customerId) — fall back to contactId
      const childId = res.supplierId ?? res.customerId ?? c.id;
      onSelect({ contactId: c.id, childId, name: c.name, taxId: c.taxId ?? '' });
      setOpen(false);
    },
    onError: () => toast.error('ไม่สามารถเพิ่มบทบาทให้ผู้ติดต่อได้ กรุณาลองใหม่อีกครั้ง'),
  });

  const handleCreated = async (r: {
    contactId: string;
    childId: string;
    name: string;
    taxId: string;
  }) => {
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
  };

  // value = display name: the option value is the contact name, so the tick compares names.
  const options: ComboOption<Contact>[] = contacts.map((c) => ({
    value: c.name,
    label: c.name,
    group: 'รายชื่อผู้ติดต่อ',
    meta: c,
  }));
  const term = search.trim();

  return (
    <>
      <Combobox<Contact>
        id={id}
        aria-label={id ? undefined : ROLE_LABELS[roleNeeded]}
        className={className}
        value={value || null}
        selectedOption={value ? { value, label: value } : null}
        options={options}
        filter={keepServerRows}
        onSearchChange={setSearch}
        placeholder={placeholder}
        searchPlaceholder="ค้นหาผู้ติดต่อ / เลขภาษี..."
        searchLabel="ค้นหาผู้ติดต่อ"
        listLabel="รายชื่อผู้ติดต่อ"
        emptyText={term ? `ไม่พบผู้ติดต่อที่ตรงกับ "${term}"` : 'พิมพ์เพื่อค้นหาผู้ติดต่อ'}
        loading={query.isLoading}
        error={query.isError ? 'โหลดข้อมูลไม่สำเร็จ' : false}
        onRetry={() => void query.refetch()}
        onCreate={(t) => {
          setCreateName(t.trim());
          setCreateOpen(true);
        }}
        createLabel={(t) => `+ สร้างผู้ติดต่อใหม่ "${t.trim()}"`}
        createOnEnter
        pending={ensureRoleMutation.isPending}
        closeOnSelect={false}
        invalid={invalid}
        open={open}
        onOpenChange={setOpen}
        onChange={(_name, option) => {
          if (option?.meta) ensureRoleMutation.mutate(option.meta);
        }}
        renderOption={(option, { selected }) =>
          option.meta ? <ContactRow contact={option.meta} selected={selected} /> : option.label
        }
      />

      {/* TRADE_IN_SELLER creates via CUSTOMER modal (an individual person);
          ensureRole adds the TRADE_IN_SELLER role afterwards in handleCreated. */}
      <CreateContactModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        role={roleNeeded === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER'}
        initialName={createName}
        onCreated={handleCreated}
      />
    </>
  );
}
