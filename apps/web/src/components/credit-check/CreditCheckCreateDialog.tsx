import CreditCheckCreateModal from './CreditCheckCreateModal';
import { useCreditCheckCreate } from './useCreditCheckCreate';
import type { Customer } from './types';

interface CreditCheckCreateDialogProps {
  open: boolean;
  onClose: () => void;
  preselectedCustomer?: Customer | null;
  onCreated?: () => void;
}

export default function CreditCheckCreateDialog({
  open,
  onClose,
  preselectedCustomer,
  onCreated,
}: CreditCheckCreateDialogProps) {
  const create = useCreditCheckCreate({ open, preselectedCustomer, onSuccess: onCreated });

  if (!open) return null;

  return (
    <CreditCheckCreateModal
      {...create.modalProps}
      onClose={() => {
        create.reset();
        onClose();
      }}
    />
  );
}
