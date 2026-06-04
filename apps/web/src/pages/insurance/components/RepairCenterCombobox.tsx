// Repair-center picker — thin wrapper over ContactCombobox. A repair center must
// be a real Supplier/Contact; picking/creating one marks it isRepairCenter=true
// (PEAK-style tag-on-use via PATCH /suppliers/:id).
//
// UX CHANGE (P1b): the picker now shows ALL contacts (not only existing repair
// centers). Any contact selected here is tagged isRepairCenter=true on pick.
// This is deliberate per the party-master-mandatory epic.
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import { ContactCombobox, type ContactPickResult } from '@/components/contacts/ContactCombobox';

interface Props {
  /** Current repairSupplierId (empty string when none). */
  value: string;
  /** Display name for the current selection. */
  displayName?: string;
  /** A repair center was picked — always a real supplier (id never ''). */
  onSelect: (s: { id: string; name: string }) => void;
  invalid?: boolean;
}

export function RepairCenterCombobox({ value, displayName, onSelect, invalid }: Props) {
  const mark = useMutation({
    mutationFn: (supplierId: string) =>
      api.patch(`/suppliers/${supplierId}/repair-center`),
  });

  const handleSelect = async ({ childId, name }: ContactPickResult) => {
    // Best-effort: tag the chosen supplier as a repair center, then report up.
    // Non-fatal: if PATCH fails the selection still proceeds.
    try {
      await mark.mutateAsync(childId);
    } catch {
      toast.error('บันทึกเป็นศูนย์ซ่อมไม่สำเร็จ แต่เลือกผู้ขายแล้ว');
    }
    onSelect({ id: childId, name });
  };

  return (
    <ContactCombobox
      roleNeeded="SUPPLIER"
      value={displayName ?? ''}
      invalid={invalid}
      placeholder="เลือก/ค้นหาศูนย์ซ่อม"
      onSelect={handleSelect}
    />
  );
}
