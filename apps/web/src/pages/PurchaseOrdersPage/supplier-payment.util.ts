import type { SupplierPaymentKind, SupplierPaymentSummary } from './types';
import { formatNumberDecimal } from '@/utils/formatters';

export type { SupplierPayment, SupplierPaymentKind, SupplierPaymentSummary, PoPaymentsResponse } from './types';

/**
 * ก้อน 2 (คำตัดสินเจ้าของ 2026-10-05) — ฝั่งเว็บของเมนูจ่ายเงินผู้จัดจำหน่าย: ชนิดรายการ/พรีวิวรายการบัญชีคิดด้วย
 * กติกาเดียวกับ API (`supplier-payment.util.ts` ฝั่ง api) เพื่อให้หน้าจอบอกล่วงหน้าได้ว่าจะลงบัญชีอย่างไร —
 * ของจริงตัดสินที่ API อีกครั้งตอนบันทึก
 */
export const PAYMENT_KIND_LABEL: Record<SupplierPaymentKind, string> = {
  DEPOSIT: 'มัดจำ',
  SETTLEMENT: 'ชำระค่าสินค้า',
  DEPOSIT_APPLIED: 'หักมัดจำเข้าเจ้าหนี้',
  DEPOSIT_REFUND: 'รับเงินมัดจำคืน',
  DEPOSIT_FORFEIT: 'มัดจำไม่ได้คืน',
};

export const SHOP_PAYING_BANK = { code: 'S11-1202', label: 'ธนาคารหน้าร้าน (จ่ายออก)' };
export const SHOP_RECEIVING_BANK = { code: 'S11-1201', label: 'ธนาคารหน้าร้าน (รับเข้า)' };
export const SUPPLIER_DEPOSIT_ACCOUNT = { code: 'S11-4201', label: 'เงินมัดจำจ่ายล่วงหน้า - ผู้จัดจำหน่าย' };
export const SUPPLIER_DEPOSIT_FORFEIT_ACCOUNT = { code: 'S53-1105', label: 'ค่าใช้จ่าย - มัดจำที่ไม่ได้คืน' };
export const PAYABLE_ACCOUNT_LABEL: Record<string, string> = {
  'S21-1101': 'เจ้าหนี้ - ซัพพลายเออร์มือถือ',
  'S21-1102': 'เจ้าหนี้ - อุปกรณ์เสริม',
};

export interface SupplierPaymentForm {
  /** YYYY-MM-DD */
  paidAt: string;
  amount: string;
  slipUrl: string;
  reference: string;
  note: string;
}

export interface PreviewLine {
  accountCode: string;
  label: string;
  debit: number;
  credit: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: string | number | undefined | null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** วันนี้ตามเวลาเครื่อง (ผู้ใช้อยู่ไทย) → YYYY-MM-DD */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** ปันยอดใส่เจ้าหนี้เรียงรหัสบัญชีจนเต็ม — ส่วนเกิน = มัดจำ (ข้อสมมติ ข) · ไม่มีเจ้าหนี้ = มัดจำทั้งก้อน */
export function planPayment(summary: SupplierPaymentSummary, amount: number) {
  let remaining = round2(Math.max(amount, 0));
  const settlement: { accountCode: string; amount: number }[] = [];
  for (const accountCode of Object.keys(summary.payableByAccount).sort()) {
    if (remaining <= 0) break;
    const outstanding = num(summary.payableByAccount[accountCode]);
    const take = round2(Math.min(remaining, outstanding));
    if (take > 0) {
      settlement.push({ accountCode, amount: take });
      remaining = round2(remaining - take);
    }
  }
  const settled = round2(settlement.reduce((sum, line) => sum + line.amount, 0));
  return { settlement, settled, deposit: remaining };
}

export function paymentChip(summary: SupplierPaymentSummary): { label: string; tone: 'settlement' | 'deposit' } {
  return num(summary.payableOutstanding) > 0
    ? { label: 'ชำระค่าสินค้า · รับของแล้ว', tone: 'settlement' }
    : { label: 'มัดจำ · ยังไม่รับของ', tone: 'deposit' };
}

/** ตรวจฟอร์มก่อนส่ง — ข้อความเดียวกับที่ API จะตอบ เพื่อไม่ให้กดแล้วเด้ง */
export function paymentFormErrors(
  form: SupplierPaymentForm,
  summary: SupplierPaymentSummary,
  today: string = todayIso(),
): Partial<Record<keyof SupplierPaymentForm, string>> {
  const errors: Partial<Record<keyof SupplierPaymentForm, string>> = {};
  if (!form.paidAt) errors.paidAt = 'กรุณาเลือกวันที่โอน';
  else if (form.paidAt > today) errors.paidAt = 'วันที่โอนต้องไม่เกินวันนี้';
  if (form.amount.trim() === '') errors.amount = 'กรุณากรอกจำนวนเงิน';
  else {
    const amount = Number(form.amount);
    const ceiling = num(summary.remainingOnPo);
    if (!Number.isFinite(amount) || amount <= 0) errors.amount = 'จำนวนเงินต้องมากกว่า 0';
    else if (amount > ceiling + 0.004) errors.amount = `จ่ายได้อีกไม่เกิน ${formatNumberDecimal(ceiling, 2)} บาท (ยอดสุทธิ − จ่ายแล้ว)`;
  }
  if (!form.slipUrl.trim()) errors.slipUrl = 'กรุณาแนบสลิปโอนเงิน';
  return errors;
}

/** รายการบัญชีที่ API จะลง (สมุดหน้าร้าน) — ชำระ: Dr เจ้าหนี้ / Cr ธนาคาร · มัดจำ: Dr S11-4201 / Cr ธนาคาร */
export function previewLines(summary: SupplierPaymentSummary, amount: number): PreviewLine[] {
  if (!(amount > 0)) return [];
  const plan = planPayment(summary, amount);
  const lines: PreviewLine[] = plan.settlement.map((line) => ({
    accountCode: line.accountCode,
    label: PAYABLE_ACCOUNT_LABEL[line.accountCode] ?? line.accountCode,
    debit: line.amount,
    credit: 0,
  }));
  if (plan.deposit > 0) {
    lines.push({ accountCode: SUPPLIER_DEPOSIT_ACCOUNT.code, label: SUPPLIER_DEPOSIT_ACCOUNT.label, debit: plan.deposit, credit: 0 });
  }
  lines.push({ accountCode: SHOP_PAYING_BANK.code, label: SHOP_PAYING_BANK.label, debit: 0, credit: round2(amount) });
  return lines;
}
