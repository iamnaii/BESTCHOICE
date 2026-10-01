// ข3 — เอกสารจากผู้จัดจำหน่ายบนใบรับของ (แบบหน้าจอที่เจ้าของเคาะ 2026-10-01 — artifact TJnBm1PU3mx1BHD871RrvS)
//   1. เลขที่ + วันที่ในเอกสารบังคับ ยกเว้น "ไม่มีเอกสาร"
//   2. ไม่มีเอกสาร → ลงบัญชีวันที่รับของ + ต้องเขียนเหตุผลในหมายเหตุใบรับ
//   3. งวดของวันที่ในเอกสารปิดแล้ว → รับได้ ลงวันที่รับของแทน (เตือนบนจอ + ระบบแจ้งฝ่ายบัญชี)
//   4. ค่าเริ่มต้น: ผู้จัดจำหน่ายจด VAT = ใบกำกับภาษี · ไม่จด = ใบส่งของ / ใบแจ้งหนี้
//   5. เลขที่ซ้ำกับใบรับของเดิมของผู้จัดจำหน่ายรายเดียวกัน → เตือน แต่รับได้
// กติกาฝั่ง API อยู่ที่ apps/api/src/modules/purchase-orders/services/supplier-doc.util.ts — ข้อความต้องตรงกัน

import { formatDateShort, formatMonthName } from '@/utils/formatters';

export type SupplierDocType = 'TAX_INVOICE' | 'DELIVERY_NOTE' | 'CASH_BILL' | 'NONE';

export const SUPPLIER_DOC_LABEL: Record<SupplierDocType, string> = {
  TAX_INVOICE: 'ใบกำกับภาษี',
  DELIVERY_NOTE: 'ใบส่งของ / ใบแจ้งหนี้',
  CASH_BILL: 'บิลเงินสด',
  NONE: 'ไม่มีเอกสาร',
};

export const SUPPLIER_DOC_TYPES: SupplierDocType[] = ['TAX_INVOICE', 'DELIVERY_NOTE', 'CASH_BILL', 'NONE'];

export const SUPPLIER_DOC_NUMBER_MAX = 64;

export interface SupplierDocForm {
  type: SupplierDocType;
  number: string;
  /** YYYY-MM-DD จากช่องเลือกวันที่ · '' = ยังไม่เลือก */
  date: string;
}

export interface SupplierDocErrors {
  number?: string;
  date?: string;
  /** ไม่มีเอกสารแต่หมายเหตุว่าง — ผู้เรียกแสดงใต้ช่องหมายเหตุของตัวเอง */
  notes?: string;
}

/** วันนี้ตามปฏิทินไทย (YYYY-MM-DD) — เพดานของช่องวันที่ในเอกสาร */
export function bangkokTodayIso(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function defaultSupplierDoc(supplierHasVat: boolean): SupplierDocForm {
  return { type: supplierHasVat ? 'TAX_INVOICE' : 'DELIVERY_NOTE', number: '', date: '' };
}

/** วันที่ YYYY-MM-DD → 28/09/2569 (ไม่ผ่าน Date ของเครื่อง จึงไม่ขยับวันตามเขตเวลา) */
export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? formatDateShort(new Date(Number(y), Number(m) - 1, Number(d))) : iso;
}

/** วันที่ YYYY-MM-DD → "สิงหาคม 2569" */
export function formatIsoMonth(iso: string): string {
  const [y, m] = iso.split('-');
  if (!y || !m) return iso;
  const first = new Date(Number(y), Number(m) - 1, 1);
  return `${formatMonthName(first)} ${formatDateShort(first).slice(-4)}`;
}

/** ตรวจตอนกดยืนยัน — กติกาเดียวกับ API (`normalizeSupplierDoc`) */
export function supplierDocErrors(doc: SupplierDocForm, notes: string, today: string = bangkokTodayIso()): SupplierDocErrors {
  if (doc.type === 'NONE') {
    return notes.trim() ? {} : { notes: 'กรุณาเขียนเหตุผลที่ไม่มีเอกสาร เช่น ร้านไม่ออกบิล' };
  }
  const errors: SupplierDocErrors = {};
  const number = doc.number.trim();
  if (!number) errors.number = 'กรุณากรอกเลขที่เอกสาร';
  else if (number.length > SUPPLIER_DOC_NUMBER_MAX) errors.number = `เลขที่เอกสารยาวเกิน ${SUPPLIER_DOC_NUMBER_MAX} ตัวอักษร`;
  if (!doc.date) errors.date = 'กรุณาเลือกวันที่ในเอกสาร';
  else if (doc.date > today) errors.date = `วันที่ในเอกสารต้องไม่เกินวันนี้ (${formatIsoDate(today)})`;
  return errors;
}

export const hasSupplierDocErrors = (errors: SupplierDocErrors) => Object.values(errors).some(Boolean);

/** ช่องที่ส่งไป API — ไม่มีเอกสาร = ส่งแค่ประเภท */
export function supplierDocPayload(doc: SupplierDocForm): {
  supplierDocType: SupplierDocType;
  supplierDocNumber?: string;
  supplierDocDate?: string;
} {
  if (doc.type === 'NONE') return { supplierDocType: 'NONE' };
  return { supplierDocType: doc.type, supplierDocNumber: doc.number.trim(), supplierDocDate: doc.date };
}

/**
 * วันที่ลงบัญชีรับสินค้าที่จะเกิด — บรรทัดในกล่องสรุปก่อนยืนยัน.
 * งวดปิด / ไม่มีเอกสาร = วันที่รับของ (วันนี้) · ยังไม่เลือกวันที่ = null
 */
export function postingDateLine(doc: SupplierDocForm, periodClosed: boolean, today: string = bangkokTodayIso()): string | null {
  if (doc.type === 'NONE' || (doc.date && periodClosed)) return `${formatIsoDate(today)} (วันที่รับของ)`;
  if (!doc.date) return null;
  return `${formatIsoDate(doc.date)} (ตามเอกสาร)`;
}

/** "ใบกำกับภาษี IV2610-0123 · ลงวันที่ 28/09/2569" — ประวัติใบสั่งซื้อ / หน้าพิมพ์ใบรับของ */
export function supplierDocSummary(r: {
  supplierDocType?: SupplierDocType | null;
  supplierDocNumber?: string | null;
  supplierDocDate?: string | null;
}): string | null {
  if (!r.supplierDocType) return null;
  if (r.supplierDocType === 'NONE') return SUPPLIER_DOC_LABEL.NONE;
  const ref = [SUPPLIER_DOC_LABEL[r.supplierDocType], r.supplierDocNumber].filter(Boolean).join(' ');
  return r.supplierDocDate ? `${ref} · ลงวันที่ ${formatDateShort(r.supplierDocDate)}` : ref;
}
