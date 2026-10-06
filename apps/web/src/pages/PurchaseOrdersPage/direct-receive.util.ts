import type { ItemForm, PoFormState, ReceivingUnitForm } from './types';
import { defaultChecklist } from './constants';
import { itemLabel } from './po-catalog.util';
import type { DirectReceiveInput } from './hooks/usePurchaseOrdersData';
import { paidAmountError, isPaidStatus, type PaymentFields } from './components/wizard/PaymentSection';
import { emptyAnglePhotos } from '@/constants/photo-angles';
import { supplierDocPayload, type SupplierDocForm } from './supplier-doc.util';

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
    // phones wait for an explicit ผ่าน/ไม่ผ่าน; an accessory line is counted, so it starts received
    status: item.category === 'ACCESSORY' ? 'PASS' : '',
    rejectReason: '',
    defectReason: '',
    batteryHealth: '',
    warrantyExpired: false,
    warrantyExpireDate: '',
    hasBox: true,
    checklist: defaultChecklist.map((c) => ({ ...c, passed: true, note: '' })),
    sellingPrice: '',
    installmentPrice: '',
    photos: [],
    anglePhotos: emptyAnglePhotos(),
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
  supplierDoc,
}: {
  form: PoFormState;
  units: ReceivingUnitForm[];
  attachments: string[];
  today: string;
  supplierDoc: SupplierDocForm;
}): DirectReceiveInput {
  const paid = isPaidStatus(form.paymentStatus);
  return {
    supplierId: form.supplierId,
    orderDate: today,
    notes: form.notes,
    items: units,
    ...supplierDocPayload(supplierDoc),
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

/**
 * ก้อน 2 (2026-10-05): จ่ายทันทีตอนรับเข้าตรง = โอนธนาคารเท่านั้น + สลิปบังคับ (กติกาเดียวกับ API `directReceive`) —
 * คืนข้อความแรกที่ผิด หรือ null เมื่อผ่าน / ยังไม่จ่าย
 */
export function directReceivePaymentErrors(form: PaymentFields, attachments: string[], netAmount: number): string | null {
  if (!isPaidStatus(form.paymentStatus)) return null;
  const amountError = paidAmountError(form, netAmount);
  if (amountError) return amountError;
  if (form.paymentMethod && ['CASH', 'CHECK', 'CHEQUE'].includes(form.paymentMethod.toUpperCase())) {
    return 'จ่ายเงินผู้จัดจำหน่ายได้เฉพาะโอนธนาคาร (ไม่มีจ่ายเงินสด/เช็ค)';
  }
  if (!attachments.some((a) => a.trim())) return 'กรุณาแนบสลิปโอนเงิน';
  return null;
}
