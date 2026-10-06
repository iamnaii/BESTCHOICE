import type { AdjustmentReason, CurrentActor, StockAdjustmentRow } from './types';

/** ฟังก์ชันบริสุทธิ์ของหน้าตัดสินค้า — เทสได้โดยไม่ render (ก้อน 3 · 2026-10-05) */

export interface ReasonOption {
  value: AdjustmentReason;
  label: string;
  hint: string;
  /** ส่งคำขอแล้วเครื่องถูกพักขายจนเจ้าของพิจารณา */
  holdsProduct: boolean;
  /** ต้องแนบรูปหลักฐานอย่างน้อย 1 รูป */
  requiresPhoto: boolean;
  /** ลงบัญชีเมื่ออนุมัติ (ถ้าเครื่องเคยลงบัญชีรับเข้า) */
  books: boolean;
}

export const REASON_OPTIONS: ReasonOption[] = [
  {
    value: 'LOST',
    label: 'สูญหาย',
    hint: 'หาไม่พบ — เมื่ออนุมัติ เครื่องออกจากสต๊อกและลงบัญชีขาดทุน (ถ้าเครื่องเคยลงบัญชีรับเข้า)',
    holdsProduct: true,
    requiresPhoto: false,
    books: true,
  },
  {
    value: 'DAMAGED',
    label: 'เสียหาย',
    hint: 'เครื่องยังอยู่แต่ขายไม่ได้ — คงในสต๊อกสถานะ "เสียหาย" ไม่ลงบัญชี จนกว่าจะขายหรือตัดจำหน่าย (ต้องแนบรูป)',
    holdsProduct: true,
    requiresPhoto: true,
    books: false,
  },
  {
    value: 'WRITE_OFF',
    label: 'ตัดจำหน่าย',
    hint: 'ทิ้ง / ส่งคืน / ขายซาก — เมื่ออนุมัติ เครื่องออกจากสต๊อกและลงบัญชีขาดทุน',
    holdsProduct: true,
    requiresPhoto: false,
    books: true,
  },
  {
    value: 'FOUND',
    label: 'พบของคืน',
    hint: 'เครื่องที่เคยหาย/เสียหาย/ตัดจำหน่ายกลับมา — กลับรายการบัญชีเดิมและคืนเข้าสต๊อก',
    holdsProduct: false,
    requiresPhoto: false,
    books: true,
  },
  {
    value: 'CORRECTION',
    label: 'แก้ไขข้อมูล',
    hint: 'บันทึกอย่างเดียว — ไม่เปลี่ยนสถานะ ไม่ลงบัญชี',
    holdsProduct: false,
    requiresPhoto: false,
    books: false,
  },
  {
    value: 'OTHER',
    label: 'อื่น ๆ',
    hint: 'บันทึกอย่างเดียว — ไม่เปลี่ยนสถานะ ไม่ลงบัญชี',
    holdsProduct: false,
    requiresPhoto: false,
    books: false,
  },
];

export const reasonOption = (reason: AdjustmentReason | ''): ReasonOption | undefined =>
  REASON_OPTIONS.find((o) => o.value === reason);

export const REASON_LABEL: Record<AdjustmentReason, string> = Object.fromEntries(
  REASON_OPTIONS.map((o) => [o.value, o.label]),
) as Record<AdjustmentReason, string>;

export const PRODUCT_STATUS_LABEL: Record<string, string> = {
  IN_STOCK: 'พร้อมขาย',
  PHOTO_PENDING: 'รอถ่ายรูป',
  QC_PENDING: 'รอตรวจ QC',
  INSPECTION: 'รอตรวจสภาพ',
  REFURBISHED: 'รับคืน/รอตีราคา',
  PO_RECEIVED: 'รับจากใบสั่งซื้อ',
  RESERVED: 'ติดจอง',
  SOLD_CASH: 'ขายสดแล้ว',
  SOLD_INSTALLMENT: 'ขายผ่อนแล้ว',
  SOLD_RESELL: 'ขายต่อแล้ว',
  REPOSSESSED: 'ยึดเครื่องแล้ว',
  DEFECT_RETURN: 'เคลม/ส่งซ่อม',
  DAMAGED: 'เสียหาย (คงในสต๊อก)',
  LOST: 'สูญหาย',
  WRITTEN_OFF: 'ตัดจำหน่ายแล้ว',
  ADJUSTMENT_PENDING: 'รออนุมัติตัดสินค้า',
};

export const productStatusLabel = (status: string | null | undefined): string =>
  status ? (PRODUCT_STATUS_LABEL[status] ?? status) : '-';

export interface RequestForm {
  productId: string;
  reason: AdjustmentReason | '';
  photoCount: number;
  notes: string;
}

export const NOTES_MAX = 1000;

export function requestFormErrors(form: RequestForm): string[] {
  const errors: string[] = [];
  if (!form.productId) errors.push('กรุณาเลือกเครื่อง');
  if (!form.reason) errors.push('กรุณาเลือกเหตุผล');
  const option = reasonOption(form.reason);
  if (option?.requiresPhoto && form.photoCount === 0) errors.push('เหตุผล "เสียหาย" ต้องแนบรูปหลักฐานอย่างน้อย 1 รูป');
  if (form.notes.length > NOTES_MAX) errors.push(`หมายเหตุยาวได้ไม่เกิน ${NOTES_MAX.toLocaleString()} ตัวอักษร`);
  return errors;
}

export const REJECT_REASON_MIN = 10;
export const REJECT_REASON_MAX = 500;

export function rejectFormErrors(reason: string): string[] {
  const len = reason.trim().length;
  if (len < REJECT_REASON_MIN || len > REJECT_REASON_MAX) {
    return [`กรุณาระบุเหตุผลที่ไม่อนุมัติ ${REJECT_REASON_MIN}–${REJECT_REASON_MAX} ตัวอักษร`];
  }
  return [];
}

export const isPending = (row: Pick<StockAdjustmentRow, 'status'>) => row.status === 'PENDING_APPROVAL';

/** ยกเลิกคำขอได้: ยังรออนุมัติ และเป็นผู้ขอเอง หรือเจ้าของ */
export function canCancel(row: Pick<StockAdjustmentRow, 'status' | 'adjustedBy'>, user: Pick<CurrentActor, 'id' | 'role'>): boolean {
  return isPending(row) && (row.adjustedBy.id === user.id || user.role === 'OWNER');
}

/** อนุมัติ/ไม่อนุมัติได้: ยังรออนุมัติ และเป็นเจ้าของ */
export function canDecide(row: Pick<StockAdjustmentRow, 'status'>, user: Pick<CurrentActor, 'id' | 'role'>): boolean {
  return isPending(row) && user.role === 'OWNER';
}

export const REQUESTER_ROLES = ['OWNER', 'BRANCH_MANAGER', 'SALES'];
export const canRequest = (user: Pick<CurrentActor, 'role'>): boolean => REQUESTER_ROLES.includes(user.role);

/** multipart — `photos` ซ้ำได้หลายไฟล์ · ไม่มี approverId (เจ้าของอนุมัติทุกใบ) */
export function buildRequestFormData(form: RequestForm, files: File[]): FormData {
  const fd = new FormData();
  fd.append('productId', form.productId);
  fd.append('reason', form.reason);
  const notes = form.notes.trim();
  if (notes) fd.append('notes', notes);
  for (const f of files) fd.append('photos', f, f.name);
  return fd;
}

export const deviceLabel = (p: { brand: string; model: string; imeiSerial?: string | null; serialNumber?: string | null }) =>
  `${p.brand} ${p.model}${p.imeiSerial ? ` · ${p.imeiSerial}` : p.serialNumber ? ` · ${p.serialNumber}` : ''}`;

export const formatBaht = (v: string | number | null | undefined): string =>
  v === null || v === undefined || v === '' ? '-' : `${Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;

/** ชื่อที่มาของรายการรับเข้า (resolveBookedInventory.source) */
export const BOOKED_SOURCE_LABEL: Record<string, string> = {
  GOODS_RECEIVING: 'ใบรับของ',
  TRADE_IN: 'รับซื้อมือสอง',
  REPOSSESSION: 'รับเครื่องคืน/ยึด',
  EXCHANGE_RETURN: 'เปลี่ยนเครื่อง',
};
