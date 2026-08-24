import { Decimal } from '@prisma/client/runtime/library';
import { STORE_COMMISSION_FALLBACK_RATE } from '../../utils/store-commission.util';

export interface ExchangePlan {
  financedAmount: Decimal;
  storeCommission: Decimal;
  interestTotal: Decimal;
  vatAmount: Decimal;
  monthlyPayment: Decimal;
  grossExclVat: Decimal;
}

/**
 * แผนผ่อนสัญญาใหม่ (PRICED mode) — server-authoritative (spec §11).
 * Conventions ตรงกับ ExchangeNewContract1ATemplate + accounting.md:
 *   commission = financed × 10% (fallback convention เดียวกับ 1A)
 *   vat        = 7% × (financed + commission + interest), HALF_UP 2dp
 *   monthly    = grossExclVat/months ROUND_DOWN + vat/months ROUND_HALF_UP
 */
export function computeExchangePlan(input: {
  newPrice: Decimal;
  months: number;
  /** flat rate ต่อเดือน เช่น 0.05 */
  monthlyRate: Decimal;
}): ExchangePlan {
  const financedAmount = input.newPrice.toDecimalPlaces(2);
  // สำเนาที่ 4 ของสูตร fallback เดิม — ใช้ค่าคงที่กลางแทน hardcode
  // (สาขานี้ 'ไม่ระบุ' เสมอ จึงเรียกอัตราตรง ๆ ไม่ผ่าน resolveStoreCommission)
  const storeCommission = financedAmount
    .times(STORE_COMMISSION_FALLBACK_RATE)
    .toDecimalPlaces(2);
  const interestTotal = financedAmount
    .times(input.monthlyRate)
    .times(input.months)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const grossExclVat = financedAmount.plus(storeCommission).plus(interestTotal);
  const vatAmount = grossExclVat.times('0.07').toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const monthlyPayment = grossExclVat
    .div(input.months)
    .toDecimalPlaces(2, Decimal.ROUND_DOWN)
    .plus(vatAmount.div(input.months).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  return { financedAmount, storeCommission, interestTotal, vatAmount, monthlyPayment, grossExclVat };
}
