import { Decimal } from '@prisma/client/runtime/library';
import { resolveStoreCommission } from '../../utils/store-commission.util';

/**
 * Single source of truth for the per-installment money breakdown of a FINANCE
 * installment contract.
 *
 * The same derivation was copy-pasted across the JE templates that need it
 * (InstallmentAccrual2A, PaymentReceipt2B, PaymentReceipt2BSplit, and the
 * early-payoff JE). Centralising it here guarantees they all round identically.
 *
 * Rounding (.claude/rules/accounting.md — MUST match CPA CSV golden values):
 *   grossExclVat / totalMonths → ROUND_DOWN   (17000/12 = 1416.66, NOT .67)
 *   interest    / totalMonths → ROUND_HALF_UP (6000/12  =  500.00)
 *   vat         / totalMonths → ROUND_HALF_UP (1190/12  =   99.17)
 *   installmentTotal           = installmentExclVat + vatPerInst   (= 1515.83)
 *
 * Omit installmentNo for the base breakdown. Passing the last installment
 * includes the residual used by 2A, so receipts clear the same receivable.
 */

type DecimalInput = Decimal | string | number;

export interface InstallmentBreakdownInput {
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
  installmentNo?: number;
}

export interface InstallmentBreakdown {
  /** financed + commission + interest (excl VAT). */
  grossExclVat: Decimal;
  /** Resolved store commission (defaulted to 10% when null). */
  commission: Decimal;
  /** Resolved total VAT (defaulted to 7% of gross when null). */
  vat: Decimal;
  /** grossExclVat / totalMonths, ROUND_DOWN. */
  installmentExclVat: Decimal;
  /** interestTotal / totalMonths, ROUND_HALF_UP. */
  interestPerInst: Decimal;
  /** vat / totalMonths, ROUND_HALF_UP. */
  vatPerInst: Decimal;
  /** installmentExclVat + vatPerInst (the cash a customer pays per installment). */
  installmentTotal: Decimal;
}

export function computeInstallmentBreakdown(
  input: InstallmentBreakdownInput,
): InstallmentBreakdown {
  const total = new Decimal(input.totalMonths);

  const financed = new Decimal(input.financedAmount);
  // helper เดียวกับ 1A / SHOP legs — CPA ข้อ C1 2026-08-24 (ห้ามเขียนสูตรซ้ำ)
  const commission = resolveStoreCommission({
    storeCommission: input.storeCommission,
    financedAmount: financed,
  });
  const interest = new Decimal(input.interestTotal);
  const grossExclVat = financed.plus(commission).plus(interest);
  const vat =
    input.vatAmount != null
      ? new Decimal(input.vatAmount)
      : grossExclVat.times('0.07').toDecimalPlaces(2);

  let installmentExclVat = grossExclVat.div(total).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  let interestPerInst = interest.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  let vatPerInst = vat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (input.installmentNo === input.totalMonths) {
    const priorPeriods = total.minus(1);
    installmentExclVat = grossExclVat.minus(installmentExclVat.times(priorPeriods));
    interestPerInst = interest.minus(interestPerInst.times(priorPeriods));
    vatPerInst = vat.minus(vatPerInst.times(priorPeriods));
  }
  const installmentTotal = installmentExclVat.plus(vatPerInst);

  return {
    grossExclVat,
    commission,
    vat,
    installmentExclVat,
    interestPerInst,
    vatPerInst,
    installmentTotal,
  };
}
