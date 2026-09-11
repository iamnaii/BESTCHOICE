import Decimal from 'decimal.js';

/** Only known recorded cost contributes to operational main-device margin. */
export function saleMargin(netAmount: string, cost: string | null | undefined): number | null {
  return cost == null ? null : new Decimal(netAmount).minus(cost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}
