import Decimal from 'decimal.js';

/** Standard BESTCHOICE sheet plan, confirmed by the owner on 2026-11-23.
 * The sheet fixes the factor at .1712 (10 months) / .1426 (12 months), then
 * floors the installment to whole baht. Other rates/terms retain their policy.
 * Reduce interest before VAT so the collected total is exactly monthly × n;
 * never recover the rounding discount in the last installment.
 */
export function bcSheetAmounts(input: {
  principal: Decimal.Value;
  ratePct: Decimal.Value;
  commissionPct: Decimal.Value;
  vatPct: Decimal.Value;
  months: number;
}) {
  const { months } = input;
  const principal = new Decimal(input.principal).toDecimalPlaces(2);
  if (![10, 12].includes(months) || !new Decimal(input.ratePct).eq('.5')
    || !new Decimal(input.commissionPct).eq('.1') || !new Decimal(input.vatPct).eq('.07')
    || !principal.gt(0)) return null;
  const monthlyPayment = principal.mul(months === 10 ? '.1712' : '.1426').floor();
  const totalWithVat = monthlyPayment.mul(months);
  const subtotal = totalWithVat.div('1.07').toDecimalPlaces(2);
  const commissionAmount = principal.mul('.1').toDecimalPlaces(2);
  const interestAmount = subtotal.minus(principal).minus(commissionAmount);
  // Tiny balances cannot support a whole-baht installment without forgiving
  // principal/commission; retain the normal satang policy in that case.
  if (interestAmount.lt(0)) return null;
  return {
    monthlyPayment, totalWithVat, subtotal, commissionAmount, interestAmount,
    vatAmount: totalWithVat.minus(subtotal),
    interestPct: interestAmount.div(principal),
  };
}
