import { Decimal } from '@prisma/client/runtime/library';

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
 * NOTE: this is the BASE per-installment breakdown. The 2A accrual additionally
 * trues-up the LAST installment to absorb the rounding residual so the contract
 * nets exactly to zero — that last-period adjustment stays in 2A and is layered
 * on top of these base values.
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

  const installmentExclVat = grossExclVat.div(total).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const interestPerInst = interest.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const vatPerInst = vat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
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
