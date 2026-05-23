import Decimal from 'decimal.js';

export interface BcConfig {
  minDownPct: Decimal;
  commissionPct: Decimal;
  vatPct: Decimal;
  /** Map of months → total-contract interest pct. e.g. { 12: 0.50 } */
  ratePctByMonths: Map<number, Decimal>;
  allowedMonths: number[];
}

export interface BcCalcInput {
  installmentPrice: Decimal;
  months: number;
  /** Override down payment as percentage. Mutually exclusive with customDownAmount. */
  downPct?: Decimal;
  /** Override down payment as amount. Mutually exclusive with downPct. */
  customDownAmount?: Decimal;
  config: BcConfig;
}

export interface BcCalcOutput {
  sellingPrice: Decimal;
  downPct: Decimal;
  downAmount: Decimal;
  financedAmount: Decimal;
  interestPct: Decimal;
  interestAmount: Decimal;
  commissionPct: Decimal;
  commissionAmount: Decimal;
  subtotal: Decimal;
  vatAmount: Decimal;
  totalWithVat: Decimal;
  monthlyPayment: Decimal;
  financeToShop: Decimal;
  isValid: boolean;
  errors: string[];
}

export type GfinCondition = 'HAND_1' | 'HAND_2';
export type ProductCategoryForGfin = 'PHONE_NEW' | 'PHONE_USED';

export interface GfinModelMappingRow {
  id: string;
  gfinSeries: string;
  gfinVariant: string | null;
  storage: string;
  condition: GfinCondition;
  maxPrice: Decimal;
  modelMatchPattern: string;
  isActive: boolean;
}

export interface GfinOverpriceRuleRow {
  id: string;
  label: string;
  seriesPattern: string;
  condition: GfinCondition;
  allowance: Decimal;
  isActive: boolean;
}

export interface GfinRateFactorRow {
  months: number;
  factor: Decimal;
  feePerInstallment: Decimal;
  isActive: boolean;
}

export interface ProductForGfin {
  brand: string;
  model: string;
  storage: string;
  category: ProductCategoryForGfin;
}

export interface GfinCalcInput {
  installmentPrice: Decimal;
  product: ProductForGfin;
  months: number;
  downPct?: Decimal;
  mapping: GfinModelMappingRow;
  overpriceRule: GfinOverpriceRuleRow | null;
  rateFactor: GfinRateFactorRow;
}

export interface GfinCalcOutput {
  gfinSubmitPrice: Decimal;
  downDiscount: Decimal;
  downPct: Decimal;
  downAmountByFormula: Decimal;
  downAmountActual: Decimal;
  financedAmount: Decimal;
  monthlyPayment: Decimal;
  totalPayback: Decimal;
  feePerInstallment: Decimal;
  isValid: boolean;
  errors: string[];
}
