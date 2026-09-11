/** Server-resolved contract amounts. Money is serialized as decimal strings. */
export interface ContractQuotePayment {
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  monthlyPrincipal: string;
  monthlyInterest: string;
  monthlyCommission: string;
  vatAmount: string;
}
export interface ContractQuote {
  fingerprint: string;
  sellingPrice: string;
  downPayment: string;
  cashDownPayment: string;
  tradeInCreditAmount: string;
  configId: string | null;
  vatSource: 'BRANCH_COMPANY' | 'CONFIG_FALLBACK';
  effectiveVatPct: string;
  interestRate: string;
  storeCommissionPct: string;
  minDownPaymentPct: string;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
  ratePct: string;
  principal: string;
  interestTotal: string;
  storeCommission: string;
  vatAmount: string;
  totalPayable: string;
  monthlyPayment: string;
  lastPayment: string;
  totalMonths: number;
  firstDueDate: string;
  schedule: ContractQuotePayment[];
}
