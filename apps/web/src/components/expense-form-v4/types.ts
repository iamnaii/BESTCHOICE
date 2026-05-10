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
