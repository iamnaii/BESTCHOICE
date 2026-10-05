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

/** C1 (Q5) — คอลัมน์ดิบบนแถวสัญญา (`inputVatAmount` · `inputVatJournalEntryId`) ต้องไม่หลุดไปถึง role ที่ไม่มีสิทธิ์ · สถานะ/เหตุผลคงอยู่ */
export function redactContractInputVat<T extends { inputVatAmount?: unknown; inputVatJournalEntryId?: unknown }>(
  contract: T,
  role: string | null | undefined,
): T {
  if (canSeeInputVat(role)) return contract;
  return { ...contract, inputVatAmount: null, inputVatJournalEntryId: null };
}

type ReceivingLike = ReceivingForInputVat & { items: Array<{ receivedVat?: unknown }> };
type PoLike = {
  items?: Array<{ receivingItems?: Array<{ receivedVat?: unknown }> }>;
  goodsReceivings: ReceivingLike[];
};

/** C1 (Q5) — `GET /purchase-orders/:id`: ตัด `receivedVat` ทั้งใน `goodsReceivings[].items[]` และ `items[].receivingItems[]` + เติม `taxInvoice` */
export function redactPoInputVat<T extends PoLike>(
  po: T,
  role: string | null | undefined,
): Omit<T, 'goodsReceivings'> & { goodsReceivings: Array<T['goodsReceivings'][number] & { taxInvoice: ReceivingTaxInvoiceView | null }> } {
  const canSee = canSeeInputVat(role);
  return {
    ...po,
    items: po.items?.map((it) => ({
      ...it,
      receivingItems: it.receivingItems?.map((ri) => (canSee ? ri : { ...ri, receivedVat: null })),
    })),
    goodsReceivings: po.goodsReceivings.map((gr) => decorateReceivingForRole(gr, role)),
  };
}
