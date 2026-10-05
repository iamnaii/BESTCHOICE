import { Decimal } from '@prisma/client/runtime/library';
import { SupplierDocType } from '@prisma/client';
import { bangkokCalendarParts } from '../../../utils/date.util';

/**
 * ก้อน 5 — เครื่อง "เคลมภาษีซื้อได้" (ฝ่ายบัญชี 2.1 + เจ้าของ Q4/Q6, 2026-10-05):
 *   receivedVat > 0 **และ** ใบรับของมีใบกำกับภาษี (รับด้วย TAX_INVOICE หรือบันทึกภายหลัง)
 * ไม่เข้าเงื่อนไข = NOT_ELIGIBLE (ไม่มี JE ไม่มี Todo — การ์ดบอกเหตุผล) · มี VAT แต่ยังไม่มีใบกำกับ = PENDING_INVOICE
 * ฟังก์ชันบริสุทธิ์ — ผู้เรียก (claim) โหลดข้อมูลให้; template/preview/หน้าสัญญาใช้ตัวเดียวกัน
 */
export const INPUT_VAT_REASON = {
  NO_RECEIVING: 'ไม่มีใบรับของ (ยอดยกมา / เพิ่มด้วยมือ)',
  TRADE_IN: 'เครื่องมือสองรับซื้อ/รับเทิร์น — ไม่มีใบกำกับภาษีซื้อ',
  NO_VAT: 'ผู้จัดจำหน่ายไม่จด VAT / บิลเงินสด — ใบสั่งซื้อไม่มีภาษีซื้อ',
  BEFORE_FEATURE: 'รับของก่อนระบบเก็บภาษีซื้อต่อเครื่อง (ไม่ลงย้อนหลัง)',
} as const;

/** อายุใบกำกับที่ขึ้นป้ายเตือน (แสดงอย่างเดียว ไม่บล็อก — ฝ่ายบัญชียืนยัน 2 ครั้ง) */
export const INPUT_VAT_AGE_WARN_MONTHS = 6;

export interface ReceivingTaxInvoice {
  number: string;
  date: Date;
  source: 'RECEIVING' | 'LATER';
}

export interface ReceivingForInputVat {
  id: string;
  grNumber: string;
  supplierDocType: SupplierDocType | null;
  supplierDocNumber: string | null;
  supplierDocDate: Date | null;
  taxInvoiceNumber: string | null;
  taxInvoiceDate: Date | null;
}

/** ใบกำกับภาษีของใบรับของ: รับด้วย TAX_INVOICE = เอกสารเดิม · ไม่งั้นคอลัมน์ที่บันทึกภายหลัง · ไม่มี = null */
export function receivingTaxInvoice(gr: ReceivingForInputVat): ReceivingTaxInvoice | null {
  if (gr.supplierDocType === 'TAX_INVOICE' && gr.supplierDocNumber && gr.supplierDocDate) {
    return { number: gr.supplierDocNumber, date: gr.supplierDocDate, source: 'RECEIVING' };
  }
  if (gr.taxInvoiceNumber && gr.taxInvoiceDate) {
    return { number: gr.taxInvoiceNumber, date: gr.taxInvoiceDate, source: 'LATER' };
  }
  return null;
}

/** จำนวนเดือนเต็มตามปฏิทินไทยจากวันที่ใบกำกับถึง `asOf` (ยังไม่ครบวันไม่นับ · อนาคต = 0) */
export function invoiceAgeMonths(invoiceDate: Date, asOf: Date): number {
  const a = bangkokCalendarParts(invoiceDate);
  const b = bangkokCalendarParts(asOf);
  const months = (b.year - a.year) * 12 + (b.month - a.month) - (b.day < a.day ? 1 : 0);
  return Math.max(0, months);
}

export interface InputVatEligibilityInput {
  /** `Product.checklistResults` — มือสองรับซื้อ/รับเทิร์นมี `source: 'trade-in'` */
  checklistResults: unknown;
  /** `GoodsReceivingItem` ของเครื่อง (unique ต่อ productId) พร้อมใบรับของ · null = ไม่มีใบรับของ */
  receivingItem: { receivedVat: Decimal | null; receiving: ReceivingForInputVat } | null;
}

export type InputVatEligibility =
  | { kind: 'ELIGIBLE'; amount: Decimal; receivingId: string; grNumber: string; taxInvoice: ReceivingTaxInvoice }
  | { kind: 'PENDING_INVOICE'; amount: Decimal; receivingId: string; grNumber: string }
  | { kind: 'NOT_ELIGIBLE'; reason: string };

export function resolveInputVatEligibility(input: InputVatEligibilityInput): InputVatEligibility {
  const checklist = (input.checklistResults ?? null) as Record<string, unknown> | null;
  if (checklist && checklist.source === 'trade-in') return { kind: 'NOT_ELIGIBLE', reason: INPUT_VAT_REASON.TRADE_IN };
  if (!input.receivingItem) return { kind: 'NOT_ELIGIBLE', reason: INPUT_VAT_REASON.NO_RECEIVING };
  const { receivedVat, receiving } = input.receivingItem;
  if (receivedVat === null || receivedVat === undefined) return { kind: 'NOT_ELIGIBLE', reason: INPUT_VAT_REASON.BEFORE_FEATURE };
  const amount = new Decimal(receivedVat.toString());
  if (!amount.gt(0)) return { kind: 'NOT_ELIGIBLE', reason: INPUT_VAT_REASON.NO_VAT };
  const taxInvoice = receivingTaxInvoice(receiving);
  if (!taxInvoice) return { kind: 'PENDING_INVOICE', amount, receivingId: receiving.id, grNumber: receiving.grNumber };
  return { kind: 'ELIGIBLE', amount, receivingId: receiving.id, grNumber: receiving.grNumber, taxInvoice };
}
