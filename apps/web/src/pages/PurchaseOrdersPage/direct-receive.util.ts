import type { ItemForm, PoFormState, ReceivingUnitForm } from './types';
import { defaultChecklist } from './constants';
import { itemLabel } from './po-catalog.util';
import type { DirectReceiveInput } from './hooks/usePurchaseOrdersData';
import { isPaidStatus } from './components/wizard/PaymentSection';

/** One table row → `quantity` units for the ตรวจรับ step (label = the same name the wizard shows). */
export function lineToUnits(item: ItemForm): ReceivingUnitForm[] {
  const qty = Math.max(1, Math.floor(Number(item.quantity)) || 1);
  const label = itemLabel(item) || 'สินค้า';
  return Array.from({ length: qty }, (_, i) => ({
    poItemId: '',
    label: `${label} #${i + 1}`,
    category: item.category,
    brand: item.brand,
    model: item.model,
    color: item.color,
    storage: item.storage,
    accessoryType: item.accessoryType,
    accessoryBrand: item.accessoryBrand,
    imeiSerial: '',
    serialNumber: '',
    status: 'PASS',
    rejectReason: '',
    defectReason: '',
    batteryHealth: '',
    warrantyExpired: false,
    warrantyExpireDate: '',
    hasBox: true,
    checklist: defaultChecklist.map((c) => ({ ...c, passed: true, note: '' })),
    sellingPrice: '',
    photos: [],
    costPrice: item.unitPrice,
  }));
}

/**
 * Body of POST /purchase-orders/direct-receive from the wizard's form (discount / payment / notes
 * keyed in on the สรุป + จ่ายเงิน step) plus the inspected units. Payment fields travel only when
 * something was paid — on credit the API keeps UNPAID.
 */
export function buildDirectReceivePayload({
  form,
  units,
  attachments,
  today,
}: {
  form: PoFormState;
  units: ReceivingUnitForm[];
  attachments: string[];
  today: string;
}): DirectReceiveInput {
  const paid = isPaidStatus(form.paymentStatus);
  return {
    supplierId: form.supplierId,
    orderDate: today,
    notes: form.notes,
    items: units,
    discount: form.discount ? Number(form.discount) : undefined,
    discountAfterVat: form.discountAfterVat ? Number(form.discountAfterVat) : undefined,
    ...(paid
      ? {
          paymentStatus: form.paymentStatus,
          paymentMethod: form.paymentMethod || undefined,
          paidAmount: Number(form.paidAmount),
          paymentNotes: form.paymentNotes || undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
        }
      : {}),
  };
}
