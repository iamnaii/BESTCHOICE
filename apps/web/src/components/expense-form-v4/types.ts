export type DocType =
  | 'EXPENSE_SAMEDAY'
  | 'EXPENSE_ACCRUAL'
  | 'CREDIT_NOTE'
  | 'PAYROLL'
  | 'VENDOR_SETTLEMENT'
  | 'PETTY_CASH_REIMBURSEMENT';
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
  // Phase A.5 — Per-line tax-disallowed override (ม.65 ตรี ป.รัษฎากร).
  // When true, this line is excluded from ภ.ง.ด.50/51 deductible totals
  // regardless of doc-level flag. Only relevant when one doc mixes
  // deductible + non-deductible categories.
  taxDisallowed?: boolean;
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

/**
 * C2 — Per-line custom income (bonus, OT, per-diem allowances).
 * `isTaxable=false` for ม.42 tax-exempt items; flag-only no UI confirm prompt.
 */
export interface PayrollCustomIncomeRow {
  uid: string;
  accountCode: string;
  name: string;
  amount: string;
  isTaxable: boolean;
}

/**
 * C2 — Per-line custom deduction (loan repayment, advance recovery, etc.).
 * No whitelist (employer-discretion); free CoA code.
 */
export interface PayrollCustomDeductionRow {
  uid: string;
  accountCode: string;
  name: string;
  amount: string;
}

export interface PayrollLineForm {
  uid: string;
  employeeName: string;
  employeeTaxId: string;
  baseSalary: string;
  ssoEmployee: string;
  whtAmount: string;
  // C2 — custom income/deduction (per-employee). Optional in API but always
  // present as empty arrays in form state for ergonomic editing.
  customIncome: PayrollCustomIncomeRow[];
  customDeduction: PayrollCustomDeductionRow[];
  // UI-only: accordion expand toggle. Excluded from POST body.
  _expanded?: boolean;
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

/**
 * C1 — Petty Cash Reimbursement. Per-line supplier (relaxes 1-doc-1-supplier).
 * No WHT support — vendors with WHT use regular EXPENSE flow. The cash leg
 * routes to the petty-cash float account (default 11-1201, configurable via
 * system_config.petty_cash_account).
 */
export interface PettyCashLineForm {
  uid: string;
  supplierName: string;
  category: string;
  description: string;
  amount: string;
  vatPercent: string;
  taxInvoiceNo: string;
}

export interface PettyCashFormFields {
  custodianName: string;
  lines: PettyCashLineForm[];
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
  /**
   * C4 · 2-Mode. `LINKED` (default) requires `originalDocumentId`; `STANDALONE`
   * requires top-level `vendorName` and skips the source-doc picker entirely.
   */
  cnMode: 'LINKED' | 'STANDALONE';
  originalDocumentId: string;
  cnReason: string;
  // PR-only
  payroll: PayrollFormFields;
  // SE-only
  settlement: SettlementFormFields;
  // PC-only (Petty Cash)
  pettyCash: PettyCashFormFields;
  // Multi-line adjustment (Fix Report P0-4) — Section 5 in the UI.
  // Used when amountPaid ≠ totalAmount − wht (rounding tolerance, overpay/underpay).
  // Empty array = no adjustments needed (legacy behaviour).
  adjustments: ExpenseAdjustmentForm[];
  // Explicit "what we actually paid" (string Decimal). Empty = default to
  // computed totalAmount − wht. When set, signed Σ adjustments must equal
  // (amountPaid − (totalAmount − wht)).
  amountPaid: string;
  // Phase A.5 — Doc-level tax-disallowed flag (ม.65 ตรี ป.รัษฎากร). When true,
  // every line in this doc is excluded from ภ.ง.ด.50/51 deductible totals.
  // The flag does not change the JE — disallowed expenses are still booked
  // normally. Only affects year-end corporate income-tax filing.
  taxDisallowed: boolean;
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
  customIncome: [],
  customDeduction: [],
  _expanded: false,
  ...overrides,
});

export const newPayrollCustomIncome = (
  overrides?: Partial<PayrollCustomIncomeRow>,
): PayrollCustomIncomeRow => ({
  uid: Math.random().toString(36).slice(2),
  accountCode: '53-1104', // default = bonus (most common)
  name: '',
  amount: '',
  isTaxable: true,
  ...overrides,
});

export const newPayrollCustomDeduction = (
  overrides?: Partial<PayrollCustomDeductionRow>,
): PayrollCustomDeductionRow => ({
  uid: Math.random().toString(36).slice(2),
  accountCode: '',
  name: '',
  amount: '',
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

export const newPettyCashLine = (
  overrides?: Partial<PettyCashLineForm>,
): PettyCashLineForm => ({
  uid: Math.random().toString(36).slice(2),
  supplierName: '',
  category: '',
  description: '',
  amount: '',
  vatPercent: '0',
  taxInvoiceNo: '',
  ...overrides,
});
