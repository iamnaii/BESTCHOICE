import { Decimal } from '@prisma/client/runtime/library';
import { SplitReceiptResult } from './split-receipt';

export interface ReceiptLine {
  accountCode: string;
  dr: Decimal;
  cr: Decimal;
  description?: string;
}

export interface BuildReceiptLinesInput {
  /** Result of splitReceipt (fed the NET late fee = gross − waived). */
  split: SplitReceiptResult;
  /** Cash/credit account debited for the received delta. */
  debitAccountCode: string;
  /** Cash (or customer-credit) received this receipt. */
  delta: Decimal;
  /** Existing 21-1103 advance consumed (Dr 21-1103). */
  advanceConsume: Decimal;
  /** Surplus parked as new 21-1103 advance (Cr 21-1103). */
  advanceCredit: Decimal;
  /** Waived late fee (Dr 52-1105). Cr 42-1103 is grossed up by this amount. */
  lateFeeWaived: Decimal;
  /** Resolved adj_overpay code (default 53-1503). */
  overpayCode: string;
  /** Resolved adj_underpay code (default 52-1104). */
  underpayCode: string;
}

/**
 * Pure JE-line builder shared by PaymentReceiptTemplate (posting) and the
 * RecordPaymentWizard preview (read-only) so the two can't drift. Builds the 2B
 * receipt lines from a splitReceipt result + the raw debit inputs.
 *
 * Gross-waiver model (CPA-approved, D1): splitReceipt is fed the NET late fee, so
 * `split.lateFeePortion` is the cash-covered portion. The waived portion is added
 * as Dr 52-1105 (ส่วนลดให้ลูกค้า) and folded into the SINGLE Cr 42-1103 line so the
 * late-fee income is recognised GROSS:
 *
 *   Cr 42-1103 = split.lateFeePortion (net, cash-covered) + lateFeeWaived
 *   Dr 52-1105 = lateFeeWaived
 *
 * Balance holds: Dr(delta + advanceConsume + waived) = Cr(principal + grossLateFee + ...).
 */
export function buildReceiptLines(input: BuildReceiptLinesInput): ReceiptLine[] {
  const { split } = input;
  const zero = new Decimal(0);
  const lines: ReceiptLine[] = [];

  if (input.delta.gt(0)) {
    lines.push({ accountCode: input.debitAccountCode, dr: input.delta, cr: zero, description: 'รับเงิน' });
  }
  if (input.advanceConsume.gt(0)) {
    lines.push({ accountCode: '21-1103', dr: input.advanceConsume, cr: zero, description: 'หักเงินรับล่วงหน้า' });
  }
  if (split.underpayRounding.gt(0)) {
    lines.push({
      accountCode: input.underpayCode,
      dr: split.underpayRounding,
      cr: zero,
      description: 'ส่วนลดเศษสตางค์ (ปิดยอด)',
    });
  }
  // Late-fee waiver — discount expense (Dr 52-1105) for the waived portion.
  if (input.lateFeeWaived.gt(0)) {
    lines.push({
      accountCode: '52-1105',
      dr: input.lateFeeWaived,
      cr: zero,
      description: 'ส่วนลดให้ลูกค้า — อนุโลมค่าปรับ',
    });
  }
  if (split.principalCleared.gt(0)) {
    lines.push({ accountCode: '11-2103', dr: zero, cr: split.principalCleared, description: 'ล้างลูกหนี้ค้างชำระ' });
  }
  // Cr 42-1103 = GROSS late fee (net cash-covered portion + waived portion) — one line.
  const lateFeeCr = split.lateFeePortion.plus(input.lateFeeWaived);
  if (lateFeeCr.gt(0)) {
    lines.push({ accountCode: '42-1103', dr: zero, cr: lateFeeCr, description: 'ค่าปรับชำระล่าช้า' });
  }
  if (split.overpayRounding.gt(0)) {
    lines.push({ accountCode: input.overpayCode, dr: zero, cr: split.overpayRounding, description: 'กำไรปัดเศษ' });
  }
  if (input.advanceCredit.gt(0)) {
    lines.push({ accountCode: '21-1103', dr: zero, cr: input.advanceCredit, description: 'เงินรับล่วงหน้า' });
  }

  return lines;
}
