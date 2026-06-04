// Expense form V4 — vendor picker.
// Thin wrapper over the shared ContactCombobox (searches the contact book across
// ALL roles; picking a contact provisions the SUPPLIER role via ensure-role). A
// typed name that matches no contact is still committed as a one-off vendor,
// preserving the legacy free-text flow. The expense stores vendorName/vendorTaxId
// as before — no FK — so this slice only adds the party-master link side effect.
import { contactsApi } from '@/lib/api/contacts';
import { ContactCombobox, type ContactPickResult } from '@/components/contacts/ContactCombobox';

interface Props {
  value: string;
  onSelectSupplier: (s: { name: string; taxId: string; whtFormType?: 'PND3' | 'PND53' }) => void;
  onTypeName: (name: string) => void;
  invalid?: boolean;
}

export function VendorCombobox({ value, onSelectSupplier, onTypeName, invalid }: Props) {
  // On pick: ensure-role already ran inside ContactCombobox (a Supplier row now
  // exists). Read the supplier link's type to map JURISTIC→PND53 / INDIVIDUAL→PND3
  // so "ประเภทผู้ขาย" auto-fills; fall back to the list values if detail fails.
  const handleSelect = async ({ contactId, name, taxId }: ContactPickResult) => {
    let whtFormType: 'PND3' | 'PND53' | undefined;
    let resolvedTaxId = taxId;
    try {
      const detail = await contactsApi.detail(contactId);
      const link = detail.suppliers?.[0];
      if (link) {
        whtFormType = link.type === 'JURISTIC' ? 'PND53' : 'PND3';
        if (link.taxId) resolvedTaxId = link.taxId;
      }
    } catch {
      // keep the list values when the detail lookup fails
    }
    onSelectSupplier({ name, taxId: resolvedTaxId, whtFormType });
  };

  return (
    <ContactCombobox
      roleNeeded="SUPPLIER"
      value={value}
      invalid={invalid}
      placeholder="เลือกผู้ขาย หรือพิมพ์ชื่อ"
      onSelect={handleSelect}
      onTypeName={onTypeName}
    />
  );
}
