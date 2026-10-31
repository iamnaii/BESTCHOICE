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
  /**
   * ที่มาของอัตรา VAT — `FINANCE_COMPANY` = บริษัทผู้ให้สินเชื่อ (ตั้งแต่ 2026-10-31) · `CONFIG_FALLBACK` = ค่าตั้งดอกเบี้ย/ระบบ ·
   * `BRANCH_COMPANY` = ป้ายเดิม (บริษัทของสาขา) ไม่มีผู้สร้างแล้ว — คงไว้ในชนิดเพื่อข้อมูล/fixture เก่า
   */
  vatSource: 'FINANCE_COMPANY' | 'CONFIG_FALLBACK' | 'BRANCH_COMPANY';
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
