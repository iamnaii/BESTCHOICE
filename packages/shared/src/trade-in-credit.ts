/** Frozen split: device value is tender; the exchange bonus is a discount. */
export type TradeInCreditSnapshot = {
  version: 1;
  redemptionId: string;
  tradeInId: string;
  voucherNumber: string | null;
  baseAmount: string;
  bonusAmount: string;
  cashDownAmount: string;
  totalDownAmount: string;
};
export type AvailableTradeInCredit = {
  id: string;
  voucherNumber: string | null;
  deviceLabel: string;
  baseAmount: string;
  bonusAmount: string;
  totalAmount: string;
};
