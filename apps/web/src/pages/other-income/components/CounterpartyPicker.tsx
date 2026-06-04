// P2b — free-text counterparty path removed.
// A counterparty must now be a real Contact (pick from party master or create
// via the modal that ContactCombobox provides). The Props interface is unchanged
// so OtherIncomeEntryPage is unaffected.
import { ContactCombobox } from '@/components/contacts/ContactCombobox';
import { contactsApi } from '@/lib/api/contacts';

interface Counterparty {
  customerId: string | null;
  name: string;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
}

interface Props {
  value: Counterparty;
  onChange: (cp: Counterparty) => void;
}

export function CounterpartyPicker({ value, onChange }: Props) {
  const handleSelect = async ({
    contactId,
    childId,
    name,
    taxId,
  }: {
    contactId: string;
    childId: string;
    name: string;
    taxId: string;
  }) => {
    let address: string | null = null;
    let phone: string | null = null;
    try {
      const d = await contactsApi.detail(contactId);
      address = d.address ?? null;
      phone = d.phone ?? null;
    } catch {
      // Non-fatal — proceed without extra details
    }
    onChange({ customerId: childId, name, taxId: taxId || null, address, phone });
  };

  return (
    <ContactCombobox
      roleNeeded="CUSTOMER"
      value={value.name ?? ''}
      placeholder="ค้นหา/สร้างลูกค้า-คู่ค้า"
      onSelect={handleSelect}
    />
  );
}
