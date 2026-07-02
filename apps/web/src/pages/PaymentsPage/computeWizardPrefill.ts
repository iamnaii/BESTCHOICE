import Decimal from 'decimal.js';
import { computeNetReceiptDue } from './computeNetReceiptDue';

/**
 * The RecordPaymentWizard's FIRST-render "เต็มงวด" amount for an installment.
 *
 * = base amountDue + net late fee − already-paid, via the single source of truth
 * computeNetReceiptDue. Deliberately OMITS waiver / advance / consumeAdvance: the
 * initial render shows the plain owed figure so the cashier sees the full charge
 * (base + fee − paid); the wizard's auto-sync effect layers the waiver + advance
 * deduction on afterward once those inputs exist.
 *
 * Extracted (PR #1314 gap-fill) so the prefill wiring — specifically that it
 * INCLUDES the late fee and EXCLUDES advance/waiver — is unit-testable without
 * rendering the multi-query wizard.
 */
export function computeWizardPrefill(payment: {
  amountDue: Decimal.Value;
  lateFee: Decimal.Value;
  amountPaid: Decimal.Value;
}): Decimal {
  return computeNetReceiptDue({
    amountDue: payment.amountDue,
    lateFee: payment.lateFee,
    amountPaid: payment.amountPaid,
  });
}
