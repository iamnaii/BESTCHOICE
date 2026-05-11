export type DocType = 'EXPENSE_SAMEDAY' | 'EXPENSE_ACCRUAL' | 'CREDIT_NOTE' | 'PAYROLL' | 'VENDOR_SETTLEMENT';
export type PriceType = 'EXCLUSIVE' | 'INCLUSIVE';
export type WhtFormType = 'PND3' | 'PND53';

export interface ExpenseLineForm {
  uid: string; // local React key
  category: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  vatPercent: string;
  whtPercent: string;
  // computed (server-authoritative)
  amountBeforeVat?: string;
  vatAmount?: string;
  whtAmount?: string;
}

/**
 * Fix Report v1.0 P0-4 — per-line adjustment row absorbing diff between
 * amountPaid and (totalAmount − wht). Each row carries its own Dr/Cr direction
 * via `side`. V12 in the API ensures Σ signed(adjustments) = amountPaid − netExpected.
 */
export interface ExpenseAdjustmentForm {
  uid: string; // local React key
  accountCode: string;
  side: 'DR' | 'CR';
  amount: string;
  note: string;
}

export interface PayrollLineForm {
  uid: string;
  employeeName: string;
  employeeTaxId: string;
  baseSalary: string;
  ssoEmployee: string;
  whtAmount: string;
}

export interface PayrollFormFields {
  year: number;
  month: number;
  payrollPeriod: string;
  lines: PayrollLineForm[];
}

export interface SettlementSelection {
  docId: string;
  amount: string;
}

export interface SettlementFormFields {
  selections: Map<string, SettlementSelection>;
  vendorName: string;
  whtAmount: string;
  whtFormType: WhtFormType | '';
}

export interface ExpenseFormState {
  docType: DocType;
  branchId: string;
  documentDate: string;
  vendorName: string;
  vendorTaxId: string;
  taxInvoiceNo: string;
  priceType: PriceType;
  whtFormType: WhtFormType | '';
  paymentMethod: string;
  depositAccountCode: string;
  reference: string;
  receiptImageUrl: string;
  note: string;
  approvedById: string;
  fromTemplateId: string;
  lines: ExpenseLineForm[];
  // CN-only
  originalDocumentId: string;
  cnReason: string;
  // PR-only
  payroll: PayrollFormFields;
  // SE-only
  settlement: SettlementFormFields;
  // Multi-line adjustment (Fix Report P0-4) — Section 5 in the UI.
  // Used when amountPaid ≠ totalAmount − wht (rounding tolerance, overpay/underpay).
  // Empty array = no adjustments needed (legacy behaviour).
  adjustments: ExpenseAdjustmentForm[];
  // Explicit "what we actually paid" (string Decimal). Empty = default to
  // computed totalAmount − wht. When set, signed Σ adjustments must equal
  // (amountPaid − (totalAmount − wht)).
  amountPaid: string;
}

export interface JePreviewLine {
  accountCode: string;
  accountName: string;
  description: string;
  dr: string;
  cr: string;
}

export interface JePreviewResponse {
  flow: 'expense-same-day' | 'expense-accrual';
  lines: JePreviewLine[];
  totals: {
    subtotal: string;
    vatAmount: string;
    withholdingTax: string;
    totalAmount: string;
    netPayment: string;
    drSum: string;
    crSum: string;
    balanced: boolean;
  };
}

export const newLine = (overrides?: Partial<ExpenseLineForm>): ExpenseLineForm => ({
  uid: Math.random().toString(36).slice(2),
  category: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discount: '0',
  vatPercent: '7',
  whtPercent: '0',
  ...overrides,
});

export const newPayrollLine = (overrides?: Partial<PayrollLineForm>): PayrollLineForm => ({
  uid: Math.random().toString(36).slice(2),
  employeeName: '',
  employeeTaxId: '',
  baseSalary: '',
  ssoEmployee: '0',
  whtAmount: '0',
  ...overrides,
});

export const newAdjustment = (
  overrides?: Partial<ExpenseAdjustmentForm>,
): ExpenseAdjustmentForm => ({
  uid: Math.random().toString(36).slice(2),
  accountCode: '',
  side: 'CR',
  amount: '',
  note: '',
  ...overrides,
});
