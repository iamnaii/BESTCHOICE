import { bangkokDateString } from '../../../utils/date.util';
import { ReceivingForInputVat, receivingTaxInvoice } from './input-vat-eligibility';

/**
 * ใครเห็น "ตัวเลขภาษีซื้อ" ของเครื่อง/สัญญา — คำตัดสินเจ้าของ 2026-10-05 (Q5): OWNER / FINANCE_MANAGER / ACCOUNTANT
 * บังคับฝั่ง server เหมือน `canSeeCost` (products/cost-visibility.util.ts) — BM/SALES เห็นแค่สถานะใบกำกับ (มี/รอ/ไม่มี) ไม่เห็นยอด.
 * ตั้งใจเป็น allow-list (ต่างจาก canSeeCost ที่เป็น deny-list) — role ใหม่ในอนาคตไม่เห็นยอดภาษีจนกว่าจะถูกเพิ่มที่นี่
 */
export const INPUT_VAT_ROLES = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'] as const;

export function canSeeInputVat(role: string | null | undefined): boolean {
  return !!role && (INPUT_VAT_ROLES as readonly string[]).includes(role);
}

/** ตัด `receivedVat` ของทุกหน่วยในใบรับของเป็น null เมื่อ role ไม่มีสิทธิ์ (ไม่แตะฟิลด์อื่น) */
export function redactReceivingInputVat<T extends { items: Array<{ receivedVat?: unknown }> }>(
  receiving: T,
  role: string | null | undefined,
): T {
  if (canSeeInputVat(role)) return receiving;
  return { ...receiving, items: receiving.items.map((it) => ({ ...it, receivedVat: null })) };
}

export interface ReceivingTaxInvoiceView { number: string; date: string; source: 'RECEIVING' | 'LATER' }

/** ใบกำกับของใบรับของในรูปที่หน้าจอใช้ (วันที่ YYYY-MM-DD ไทย) */
export function receivingTaxInvoiceView(gr: ReceivingForInputVat): ReceivingTaxInvoiceView | null {
  const inv = receivingTaxInvoice(gr);
  return inv ? { number: inv.number, date: bangkokDateString(inv.date), source: inv.source } : null;
}

/** เติม `taxInvoice` + ตัด `receivedVat` ตาม role — ใช้กับทุก response ที่คืนใบรับของ (findOne PO · รายการใบรับของ · ใบรับของเดี่ยว) */
export function decorateReceivingForRole<T extends ReceivingForInputVat & { items: Array<{ receivedVat?: unknown }> }>(
  gr: T,
  role: string | null | undefined,
): T & { taxInvoice: ReceivingTaxInvoiceView | null } {
  return { ...redactReceivingInputVat(gr, role), taxInvoice: receivingTaxInvoiceView(gr) };
}
