import { BadRequestException } from '@nestjs/common';
import { POPaymentKind, POPaymentStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { bangkokCalendarParts, bangkokMidnight, isFutureBkkDay } from '../../../utils/date.util';
import { formatDateShort } from '../../../utils/thai-date.util';
import { SUPPLIER_DEPOSIT_ACCOUNT } from '../../journal/cpa-templates/shop-supplier-payment.template';

/**
 * ก้อน 2 จ่ายเงินผู้จัดจำหน่าย — ฟังก์ชันบริสุทธิ์ที่ service ใช้ตัดสินใจ (ไม่แตะฐานข้อมูล จึงเทสต์ได้ตรง ๆ)
 *
 * ฐานะของใบสั่งซื้อ (มัดจำค้าง · เจ้าหนี้คงเหลือต่อบัญชี) อ่านจาก **บรรทัดรายการบัญชี** ของใบนั้น ไม่ใช่จากคอลัมน์สรุป —
 * บัญชีย่อยเจ้าหนี้ตามผู้จัดจำหน่าย (คำตอบฝ่ายบัญชี 2026-10-05 ข้อ 1) จึงตรงกับสมุดบัญชีเสมอ.
 * เงินที่จ่ายจริง (paidTotal) อ่านจากแถวการจ่ายที่ไม่ถูกยกเลิก: มัดจำ + ชำระ − มัดจำที่ได้คืน (ริบมัดจำ = เงินออกไปแล้ว ไม่ลด)
 */
export const SUPPLIER_PAYABLE_ACCOUNTS = ['S21-1101', 'S21-1102'];
/** วันที่โอนย้อนหลังได้ไม่เกินกี่วัน — กติกาเดียวกับวันที่ในเอกสารผู้จัดจำหน่าย (ข้อสมมติ ฉ) */
export const SUPPLIER_PAYMENT_MAX_AGE_DAYS = 365;

type DecimalLike = Decimal | string | number;
export interface LedgerLineLike {
  accountCode: string;
  debit: DecimalLike | null;
  credit: DecimalLike | null;
}
export interface PaymentRowLike {
  kind: POPaymentKind;
  amount: DecimalLike;
  voidedAt: Date | null;
}
export interface PayableLine {
  accountCode: string;
  amount: Decimal;
}
export interface SupplierPaymentPosition {
  /** S11-4201 Dr − Cr ของใบนี้ (มัดจำที่ยังไม่ถูกหัก/คืน/ริบ) */
  depositOutstanding: Decimal;
  /** เจ้าหนี้คงเหลือต่อบัญชี (Cr − Dr) เฉพาะที่ > 0 เรียงรหัส */
  payableByAccount: Record<string, Decimal>;
  payableOutstanding: Decimal;
  /** เงินที่จ่ายจริง (ไม่นับแถวที่ยกเลิก): มัดจำ + ชำระ − มัดจำที่ได้คืน */
  paidTotal: Decimal;
  /**
   * เพดานเงินที่จ่ายได้ทั้งใบ — ปกติ = ยอดสุทธิของใบ · ใบที่ "ปิดใบ รับไม่ครบ" (CLOSED_SHORT) = มูลค่าของที่รับจริงตามบัญชี
   * (Σ Cr ของ S21-110x ที่ใบรับของตั้งไว้ — คำตัดสินเจ้าของ 2026-10-11: ยอดสุทธิของใบคงเดิม แต่จ่ายได้ไม่เกินของที่ได้รับ)
   */
  paymentCap: Decimal;
  /** paymentCap − paidTotal (ไม่ติดลบ) = เพดานที่ยังจ่ายได้ */
  remainingOnPo: Decimal;
  /** เคยตั้งเจ้าหนี้ (รับของแล้วอย่างน้อยหนึ่งหน่วย) */
  hasBookedPayable: boolean;
  status: POPaymentStatus;
}

export interface SupplierPaymentPositionOptions {
  /** true = เพดานจ่าย = มูลค่าของที่รับจริง (ใบ CLOSED_SHORT) แทนยอดสุทธิของใบ */
  capToBooked?: boolean;
}

/** สถานะใบที่เพดานจ่ายเปลี่ยนจากยอดสุทธิเป็นมูลค่าของที่รับจริง */
export const PO_STATUS_CLOSED_SHORT = 'CLOSED_SHORT';
export const capsToBookedPayable = (status: string | null | undefined): boolean => status === PO_STATUS_CLOSED_SHORT;

const ZERO = new Decimal(0);
const dec = (value: DecimalLike | null | undefined) => new Decimal((value ?? 0).toString());

export function supplierPaymentPosition(
  netAmount: DecimalLike,
  rows: PaymentRowLike[],
  lines: LedgerLineLike[],
  options: SupplierPaymentPositionOptions = {},
): SupplierPaymentPosition {
  const net = dec(netAmount);
  let deposit = ZERO;
  const payable: Record<string, Decimal> = {};
  let bookedPayableGross = ZERO;
  let hasBookedPayable = false;
  for (const line of lines) {
    const dr = dec(line.debit);
    const cr = dec(line.credit);
    if (line.accountCode === SUPPLIER_DEPOSIT_ACCOUNT) {
      deposit = deposit.add(dr).sub(cr);
    } else if (SUPPLIER_PAYABLE_ACCOUNTS.includes(line.accountCode)) {
      payable[line.accountCode] = (payable[line.accountCode] ?? ZERO).add(cr).sub(dr);
      if (cr.gt(ZERO)) {
        hasBookedPayable = true;
        bookedPayableGross = bookedPayableGross.add(cr);
      }
    }
  }
  const payableByAccount: Record<string, Decimal> = {};
  let payableOutstanding = ZERO;
  for (const code of Object.keys(payable).sort()) {
    if (payable[code].gt(ZERO)) {
      payableByAccount[code] = payable[code];
      payableOutstanding = payableOutstanding.add(payable[code]);
    }
  }
  let paidTotal = ZERO;
  for (const row of rows) {
    if (row.voidedAt) continue;
    const amount = dec(row.amount);
    if (row.kind === 'DEPOSIT' || row.kind === 'SETTLEMENT') paidTotal = paidTotal.add(amount);
    else if (row.kind === 'DEPOSIT_REFUND') paidTotal = paidTotal.sub(amount);
  }
  if (paidTotal.lt(ZERO)) paidTotal = ZERO;
  // ใบปิดรับไม่ครบ: ของที่ไม่มาไม่มีวันตั้งเจ้าหนี้ — เพดานจึงเท่ามูลค่าที่ลงบัญชีรับเข้าแล้ว (หน่วยที่ยังรอถ่ายรูปจะเพิ่มเพดานเมื่อผ่านเข้าคลัง)
  const paymentCap = options.capToBooked ? bookedPayableGross : net;
  const remainingOnPo = Decimal.max(paymentCap.sub(paidTotal), ZERO);
  const status: POPaymentStatus = !paidTotal.gt(ZERO)
    ? 'UNPAID'
    : paymentCap.gt(ZERO) && paidTotal.gte(paymentCap)
      ? 'FULLY_PAID'
      : hasBookedPayable
        ? 'PARTIALLY_PAID'
        : 'DEPOSIT_PAID';
  return {
    depositOutstanding: Decimal.max(deposit, ZERO),
    payableByAccount,
    payableOutstanding,
    paidTotal,
    paymentCap,
    remainingOnPo,
    hasBookedPayable,
    status,
  };
}

/** ปันยอดชำระใส่เจ้าหนี้ทีละบัญชี (เรียงรหัส) จนเต็ม — ส่วนที่เหลือ = ยังไม่มีเจ้าหนี้ให้ล้าง → มัดจำ (ข้อสมมติ ข) */
export function splitSettlement(
  amount: Decimal,
  payableByAccount: Record<string, Decimal>,
): { lines: PayableLine[]; settled: Decimal; excess: Decimal } {
  const lines = allocatePayable(
    amount,
    Object.keys(payableByAccount)
      .sort()
      .map((accountCode) => ({ accountCode, amount: payableByAccount[accountCode] })),
  );
  const settled = lines.reduce((sum, line) => sum.add(line.amount), ZERO);
  return { lines, settled, excess: amount.sub(settled) };
}

/** หักยอดเข้าบรรทัดเจ้าหนี้ตามลำดับที่ให้มา จนครบ `amount` หรือหมดบรรทัด */
export function allocatePayable(amount: Decimal, payable: PayableLine[]): PayableLine[] {
  let remaining = amount;
  const out: PayableLine[] = [];
  for (const line of payable) {
    if (!remaining.gt(ZERO)) break;
    const take = Decimal.min(remaining, line.amount);
    if (take.gt(ZERO)) {
      out.push({ accountCode: line.accountCode, amount: take });
      remaining = remaining.sub(take);
    }
  }
  return out;
}

/** `YYYY-MM-DD` (ปฏิทินไทย) → เที่ยงคืนเวลาไทย · ห้ามอนาคต · ย้อนหลังไม่เกิน 365 วัน (กันพิมพ์ปีผิด) */
export function parsePaidAt(value: string, now: Date = new Date()): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? '').trim());
  if (!match) throw new BadRequestException('วันที่โอนไม่ถูกต้อง');
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const probe = new Date(Date.UTC(year, month, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month || probe.getUTCDate() !== day) {
    throw new BadRequestException('วันที่โอนไม่ถูกต้อง');
  }
  const date = bangkokMidnight(year, month, day);
  if (isFutureBkkDay(date, now)) {
    throw new BadRequestException(`วันที่โอนต้องไม่เกินวันนี้ (${formatDateShort(now)})`);
  }
  const today = bangkokCalendarParts(now);
  const earliest = bangkokMidnight(today.year, today.month, today.day - SUPPLIER_PAYMENT_MAX_AGE_DAYS);
  if (date < earliest) {
    throw new BadRequestException(
      `วันที่โอนเก่าเกิน ${SUPPLIER_PAYMENT_MAX_AGE_DAYS} วัน (ก่อน ${formatDateShort(earliest)}) — ตรวจปีที่กรอกอีกครั้ง`,
    );
  }
  return date;
}
