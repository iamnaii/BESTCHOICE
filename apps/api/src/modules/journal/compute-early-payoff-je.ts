import { Decimal } from '@prisma/client/runtime/library';

/**
 * Single source of truth for the Early-Payoff (JP4) journal-entry money math.
 *
 * Previously this computation was re-implemented in three places that could
 * silently drift apart (preview showing one number, ledger posting another):
 *   A) EarlyPayoffJP4Template.execute()             — the JP4 posting template
 *   B) ContractPaymentService.getEarlyPayoffQuote() — the UI/LIFF JE preview
 *   C) ContractPaymentService.earlyPayoff()         — the inline ledger posting
 *
 * All three now call this pure function, so `preview === posted` is guaranteed
 * by construction. Verified against the CPA golden fixtures
 * (apps/api/.../fixtures/cpa-cases/case-4-early-payoff.csv) — see the golden
 * spec compute-early-payoff-je.spec.ts and the DB-backed template golden
 * early-payoff-jp4.template.spec.ts.
 *
 * Rounding (.claude/rules/accounting.md — MUST match CPA CSV golden values):
 *   grossExclVat / totalMonths → ROUND_DOWN
 *   interest    / totalMonths → ROUND_HALF_UP
 *   vat         / totalMonths → ROUND_HALF_UP
 *   per-installment total      = sum of the above
 *
 * Policy A (CPA decision · 2026-05-09): VAT ไม่ลดตามส่วนลดดอกเบี้ย —
 *   Cr 21-2101 (VAT ภ.พ.30) = remainingDeferredVat เต็มยอด (settleVat).
 *   ไม่ออกใบลดหนี้ (Credit Note); บริษัทรับภาระ VAT ส่วนเกินจากส่วนลดเอง.
 *   Ref: docs/superpowers/specs/2026-05-09-cpa-policy-a-100-compliance-design.md
 */

type DecimalInput = Decimal | string | number;

export interface ComputeEarlyPayoffJeInput {
  /** Cash/bank account the customer pays into (Dr leg). */
  depositAccountCode: string;
  /** ยอดจัด (FINANCE principal base). */
  financedAmount: DecimalInput;
  /** Store commission. null → financedAmount × 10% (ROUND to 2dp). */
  storeCommission: DecimalInput | null;
  /** Total deferred interest over the whole contract. */
  interestTotal: DecimalInput;
  /** Total VAT over the whole contract. null → grossExclVat × 7% (ROUND to 2dp). */
  vatAmount: DecimalInput | null;
  /** Number of installments in the contract. */
  totalMonths: number;
  /** Number of unpaid installments being closed out. */
  unpaidCount: number;
  /** Interest discount as a PERCENTAGE 0..100 (e.g. 50 for 50%). */
  interestDiscountPercent: DecimalInput;
}

/** One canonical JE line — money only (accountCode + dr + cr). Descriptions are
 * the caller's concern (UI preview vs ledger posting word them differently). */
export interface EarlyPayoffJeLine {
  accountCode: string;
  dr: Decimal;
  cr: Decimal;
}

export interface ComputeEarlyPayoffJeResult {
  /** The canonical JE lines (52-1106 omitted when discount = 0). */
  lines: EarlyPayoffJeLine[];
  // Derived per-installment values (consistent with templates 2A/2B).
  installmentExclVat: Decimal;
  interestPerInst: Decimal;
  vatPerInst: Decimal;
  // Remaining balances for the unpaid installments.
  remainingGross: Decimal;
  remainingDeferredInterest: Decimal;
  remainingDeferredVat: Decimal;
  /** Interest discount (remainingDeferredInterest × pct / 100, ROUND to 2dp). */
  discount: Decimal;
  /** Policy A: settleVat = remainingDeferredVat (VAT not reduced by discount). */
  settleVat: Decimal;
  /** Cash the customer pays = remainingGross − discount + settleVat. */
  settlement: Decimal;
}

export function computeEarlyPayoffJE(
  input: ComputeEarlyPayoffJeInput,
): ComputeEarlyPayoffJeResult {
  const total = new Decimal(input.totalMonths);
  const unpaidD = new Decimal(input.unpaidCount);

  const financed = new Decimal(input.financedAmount);
  const commission =
    input.storeCommission != null
      ? new Decimal(input.storeCommission)
      : financed.times('0.10').toDecimalPlaces(2);
  const interest = new Decimal(input.interestTotal);
  const grossExclVat = financed.plus(commission).plus(interest);
  const vat =
    input.vatAmount != null
      ? new Decimal(input.vatAmount)
      : grossExclVat.times('0.07').toDecimalPlaces(2);

  // Per-installment amounts (same rounding as templates 2A/2B).
  const installmentExclVat = grossExclVat.div(total).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const interestPerInst = interest.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const vatPerInst = vat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  // Remaining balances for the unpaid installments.
  const remainingGross = installmentExclVat.times(unpaidD);
  const remainingDeferredInterest = interestPerInst.times(unpaidD);
  const remainingDeferredVat = vatPerInst.times(unpaidD);

  // Discount on interest only (percentage 0..100 → divide by 100).
  const discount = remainingDeferredInterest
    .times(new Decimal(input.interestDiscountPercent))
    .div(100)
    .toDecimalPlaces(2);

  // Policy A — VAT ไม่ลดตามส่วนลด (full deferred VAT settles).
  const settleVat = remainingDeferredVat;

  // Settlement the customer pays (reduced by discount only — VAT full).
  const settlement = remainingGross.minus(discount).plus(settleVat);

  const zero = new Decimal(0);
  const lines: EarlyPayoffJeLine[] = [
    { accountCode: input.depositAccountCode, dr: settlement, cr: zero },
    { accountCode: '11-2106', dr: remainingDeferredInterest, cr: zero },
    { accountCode: '21-2102', dr: remainingDeferredVat, cr: zero },
  ];

  // Guard: only emit the discount line when there is a discount (canonical —
  // matches the golden template + preview; a 0.00 line is a no-op).
  if (discount.gt(0)) {
    lines.push({ accountCode: '52-1106', dr: discount, cr: zero });
  }

  lines.push(
    { accountCode: '11-2101', dr: zero, cr: remainingGross },
    { accountCode: '11-2105', dr: zero, cr: remainingDeferredVat },
    { accountCode: '41-1101', dr: zero, cr: remainingDeferredInterest },
    { accountCode: '21-2101', dr: zero, cr: settleVat },
  );

  return {
    lines,
    installmentExclVat,
    interestPerInst,
    vatPerInst,
    remainingGross,
    remainingDeferredInterest,
    remainingDeferredVat,
    discount,
    settleVat,
    settlement,
  };
}
