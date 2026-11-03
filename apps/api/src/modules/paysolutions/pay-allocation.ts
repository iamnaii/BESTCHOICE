import { Prisma } from '@prisma/client';
import type { DunningEventTrigger, PaymentLinkPurpose } from '@prisma/client';
import type { LiffPayAllocationLine, LiffPayAmountKind } from '@installment/shared';

/**
 * Task 42 — การกระจายเงินของ webhook PaySolutions (งวดเก่าก่อน) **ที่เดียว**: `PaySolutionsWebhookService.handlePaymentCallback`
 * ใช้ตอนรับเงินจริง (ในธุรกรรม Serializable) และหน้า `/pay/:token` (`PaymentLinkService.resolvePaymentLink`) ใช้แสดง
 * "นำไปชำระ (งวดเก่าก่อน)" ⇒ สิ่งที่ลูกค้าเห็นก่อนจ่าย = สิ่งที่ webhook ทำหลังจ่าย (ถ้ายอดค้างไม่เปลี่ยนระหว่างนั้น) · ห้ามเขียนชุดที่สอง
 */

/** งวดที่ webhook กระจายเงินเข้า: ของสัญญานี้ · ยังไม่ `PAID` · ไม่ถูกลบ · งวดเก่าก่อน */
export function fifoUnpaidPaymentsArgs(contractId: string): {
  where: Prisma.PaymentWhereInput;
  orderBy: Prisma.PaymentOrderByWithRelationInput;
} {
  return {
    where: { contractId, status: { not: 'PAID' }, deletedAt: null },
    orderBy: { installmentNo: 'asc' },
  };
}

/** ช่องของแถวงวดที่การกระจายเงินอ่าน */
export interface FifoInstallmentRow {
  amountDue: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  lateFee: Prisma.Decimal;
  lateFeeWaived: boolean;
}

export interface FifoAllocationLine<P extends FifoInstallmentRow> {
  payment: P;
  /** ค่าปรับที่นับ (ยกเว้นแล้ว = 0) */
  lateFee: Prisma.Decimal;
  /** ยอดค้างของงวดก่อนเงินก้อนนี้ = ค่างวด + ค่าปรับ − ที่จ่ายแล้ว */
  owed: Prisma.Decimal;
  /** เงินก้อนนี้ที่ลงงวดนี้ (= min(เงินที่เหลือ, ยอดค้าง)) */
  payThis: Prisma.Decimal;
  /** `amountPaid` ใหม่ของงวด (2 ตำแหน่ง) */
  newAmountPaid: Prisma.Decimal;
  /** งวดชำระครบหลังเงินก้อนนี้ */
  fullyPaid: boolean;
}

export interface FifoAllocation<P extends FifoInstallmentRow> {
  /** งวดที่เงินก้อนนี้ลง ตามลำดับ */
  lines: FifoAllocationLine<P>[];
  /** เงินที่เกินทุกงวดค้าง (webhook พักเป็นเงินรับล่วงหน้า 21-1103) */
  remaining: Prisma.Decimal;
}

/**
 * กระจาย `paidAmount` เข้างวดตามลำดับที่ได้ (ผู้เรียกส่งงวดจาก `fifoUnpaidPaymentsArgs` — งวดเก่าก่อน): ค่าปรับที่ยกเว้นแล้ว = 0 ·
 * งวดที่ไม่มียอดค้างข้าม · ลงงวดละไม่เกินยอดค้าง · เงินหมดแล้วหยุด
 */
export function allocatePaidAmountFifo<P extends FifoInstallmentRow>(
  payments: readonly P[],
  paidAmount: Prisma.Decimal,
): FifoAllocation<P> {
  const lines: FifoAllocationLine<P>[] = [];
  let remaining = paidAmount;
  for (const payment of payments) {
    if (remaining.lte(0)) break;
    // lateFeeWaived=true sets lateFee=0 elsewhere, so reading lateFee directly is equivalent — keep the guard explicit.
    const lateFee = payment.lateFeeWaived ? new Prisma.Decimal(0) : payment.lateFee;
    const owed = payment.amountDue.add(lateFee).sub(payment.amountPaid);
    if (owed.lte(0)) continue;

    const payThis = Prisma.Decimal.min(remaining, owed);
    remaining = remaining.sub(payThis);
    const newAmountPaid = payment.amountPaid.add(payThis).toDecimalPlaces(2);
    const fullyPaid = newAmountPaid.gte(payment.amountDue.add(lateFee));
    lines.push({ payment, lateFee, owed, payThis, newAmountPaid, fullyPaid });
  }
  return { lines, remaining };
}

const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toNumber();

/**
 * แถว "นำไปชำระ (งวดเก่าก่อน)" จากผลการกระจาย: งวดที่เงินปิดครบ = ค่างวดที่ยังค้าง (`INSTALLMENT` ถ้ายังไม่เคยจ่าย ·
 * `INSTALLMENT_REMAINING` ถ้าเคยจ่ายบางส่วน) แล้วค่าปรับ (`LATE_FEE` เมื่อ > 0) — ที่จ่ายมาแล้วนับเข้าค่างวดก่อน (แถวงวดไม่แยกว่า
 * จ่ายค่าปรับไปแล้วเท่าไร) · งวดที่เงินไม่พอ = `PARTIAL` (ยอดที่ลง) + `LEFT_AFTER` (ยอดที่ยังค้าง) · เงินเกินทุกงวด = `SURPLUS`
 */
export function payAllocationPreviewLines<P extends FifoInstallmentRow & { installmentNo: number }>(
  allocation: FifoAllocation<P>,
): LiffPayAllocationLine[] {
  const rows: LiffPayAllocationLine[] = [];
  for (const line of allocation.lines) {
    const { installmentNo, amountDue, amountPaid } = line.payment;
    if (!line.fullyPaid) {
      rows.push({ kind: 'PARTIAL', installmentNo, amount: money(line.payThis) });
      rows.push({ kind: 'LEFT_AFTER', installmentNo, amount: money(line.owed.sub(line.payThis)) });
      continue;
    }
    const principal = Prisma.Decimal.min(
      Prisma.Decimal.max(amountDue.sub(amountPaid), new Prisma.Decimal(0)),
      line.payThis,
    );
    const fee = line.payThis.sub(principal);
    if (principal.gt(0)) {
      rows.push({
        kind: amountPaid.gt(0) ? 'INSTALLMENT_REMAINING' : 'INSTALLMENT',
        installmentNo,
        amount: money(principal),
      });
    }
    if (fee.gt(0)) rows.push({ kind: 'LATE_FEE', installmentNo, amount: money(fee) });
  }
  if (allocation.remaining.gt(0)) {
    rows.push({ kind: 'SURPLUS', amount: money(allocation.remaining) });
  }
  return rows;
}

/**
 * หัวยอดของหน้า `/pay/:token` — `PAYOFF` เฉพาะลิงก์ purpose PAYOFF · ลิงก์ `AMOUNT` ที่กฎแจ้งล็อกสร้าง = ยอดค้างชำระ ·
 * กฎนัดชำระสร้าง = ยอดนัดชำระ · นอกนั้น (ลิงก์งวด · ลิงก์ยอดอื่น · แถวเก่าที่ไม่มี purpose) = ยอดที่ต้องชำระ
 */
export function payLinkAmountKind(
  purpose: PaymentLinkPurpose | null,
  sourceEvent: DunningEventTrigger | null,
): LiffPayAmountKind {
  if (purpose === 'PAYOFF') return 'PAYOFF';
  if (purpose === 'AMOUNT' && sourceEvent === 'DEVICE_LOCKED') return 'OUTSTANDING';
  if (purpose === 'AMOUNT' && sourceEvent === 'CALL_ANSWERED_PROMISE') return 'PROMISE';
  return 'DUE';
}
