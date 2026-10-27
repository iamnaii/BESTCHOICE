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
  /** Payroll D4 — ติ๊ก "รายการปรับปรุงงวดก่อน" ⇒ ส่ง `isAdjustment: true` (server เก็บ source ADJUSTMENT) */
  isAdjustment: boolean;
}

/**
 * Payroll D4 — แถวรายได้ที่ server คิดจากการลงเวลา (ATTENDANCE_* · ส่วนที่ 2 จะมี COMMISSION ที่ quantity/rate/multiplier = null).
 * อ่านอย่างเดียว: ฟอร์มไม่ส่งแถวเหล่านี้กลับ — server คิดใหม่ทุกครั้งที่บันทึก
 */
export interface PayrollSystemIncomeRow {
  source: string;
  accountCode: string;
  name: string;
  /** ชั่วโมง */
  quantity: string | null;
  /** อัตราต่อชั่วโมง (แสดงอย่างเดียว) */
  rate: string | null;
  multiplier: string | null;
  amount: string;
}

/** สรุปลงเวลาที่ server เก็บไว้ต่อบรรทัด (`PayrollLine.attendanceSummary`) — ข้อมูลประกอบ ไม่หักเงิน */
export interface PayrollAttendanceSummary {
  workDays: number;
  lateCount: number;
  lateMinutes: number;
  absent: number;
  leave: number;
  /** ชั่วโมงเป็นสตริงทศนิยม 1 ตำแหน่ง */
  otHours: string;
  holidayHours: string;
  holidayOtHours: string;
  holidayWorkedDays: number;
  reviewCount: number;
  /** รายเดือน + มีเงินเดือนในทะเบียน = ระบบคิด OT ให้ */
  autoOtEligible: boolean;
}

/** วันที่ต้องตรวจ (`systemNotes.review`) — `date` = 'YYYY-MM-DD' วันไทย · `blocking` = เครื่องถูกใช้ซ้อน (อนุมัติไม่ได้) */
export interface PayrollReviewDay {
  dayId: string;
  date: string;
  branchId: string;
  flags: string[];
  blocking: boolean;
}

export type PayrollSystemWarning =
  | { code: 'NOT_MONTHLY_OR_NO_BASE'; otHours: string }
  | { code: 'IN_OTHER_DOCUMENT'; documentId: string; documentNumber: string; branchName: string; status: string }
  | { code: 'NO_PIN' }
  | { code: 'NOT_YET_CLOSABLE'; closableAt: string };

export interface PayrollSystemNotes {
  review: PayrollReviewDay[];
  warnings: PayrollSystemWarning[];
}

/** วันติดธงเครื่องถูกใช้ซ้อนของพนักงานในใบ (`payrollGate.deviceConflicts`) — `date` = 'YYYY-MM-DD' วันไทย */
export interface PayrollGateDay {
  dayId: string;
  userId: string;
  employeeName: string;
  date: string;
  /** สาขาของวันนั้น — ลิงก์ไปหน้าลงเวลาของสาขานั้น */
  branchId: string;
}

/**
 * ด่านของใบเงินเดือนที่ `GET /expense-documents/:id` คืน (`payrollGate`) — มีค่าเฉพาะใบ DRAFT / PENDING_APPROVAL / APPROVED
 * ที่มีพนักงานผูก · null = ใบลงบัญชี/กลับรายการแล้ว หรือไม่มีด่าน
 */
export interface PayrollGateView {
  /** เวลาปิดงวด (ISO) เมื่อยังไม่ถึง · null = ส่ง/ลงบัญชีได้แล้ว */
  closableAt: string | null;
  deviceConflicts: PayrollGateDay[];
}

/** หนึ่งแถวของ 409 `PAYROLL_STALE` (`diffs`) — ยอด/ชั่วโมงในใบเทียบที่คิดใหม่ (hours = null เมื่อแถวไม่มีชั่วโมง) */
export interface PayrollStaleDiff {
  userId: string;
  employeeName: string;
  label: string;
  stored: { amount: string; hours: string | null };
  current: { amount: string; hours: string | null };
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
  // PR-C — FK to the chosen payroll employee. '' = legacy free-text row.
  userId: string;
  employeeTaxId: string;
  baseSalary: string;
  ssoEmployee: string;
  whtAmount: string;
  // C2 — custom income/deduction (per-employee). Optional in API but always
  // present as empty arrays in form state for ergonomic editing.
  customIncome: PayrollCustomIncomeRow[];
  customDeduction: PayrollCustomDeductionRow[];
  // Payroll D4 — ที่ server เก็บไว้ตอนบันทึกครั้งล่าสุด (อ่านอย่างเดียว · ไม่ส่งกลับ). บรรทัดใหม่/คัดลอกมา = ว่าง
  systemIncome: PayrollSystemIncomeRow[];
  attendanceSummary: PayrollAttendanceSummary | null;
  systemNotes: PayrollSystemNotes | null;
  // UI-only: accordion expand toggle. Excluded from POST body.
  _expanded?: boolean;
}

export interface PayrollFormFields {
  year: number;
  month: number;
  payrollPeriod: string;
  // คำสั่งเจ้าของ 2026-08-06 — SHOP (default, พนักงานสาขา → ผัง S + เงินสด S11-XXXX)
  // | FINANCE (ส่วนกลาง → ผัง FINANCE + เงินสด 11-XXXX). ส่งไปกับ POST /payroll.
  entityScope: 'SHOP' | 'FINANCE';
  lines: PayrollLineForm[];
}

export interface SettlementSelection {
  docId: string;
  amount: string;
}

export interface SettlementFormFields {
  selections: Map<string, SettlementSelection>;
  vendorName: string;
  /** Supplier FK from the picker — persisted as vendorSupplierId on the SE document. */
  vendorSupplierId: string;
  whtAmount: string;
  whtFormType: WhtFormType | '';
}

/**
 * C1 — Petty Cash Reimbursement. Per-line supplier (relaxes 1-doc-1-supplier).
 * No WHT support — vendors with WHT use regular EXPENSE flow. The cash leg
 * routes to the petty-cash float account (default 11-1103 เงินสดพนักงานบัญชี —
 * Imprest Fund pattern per Owner Response Q1 2026-05-17; configurable via
 * system_config.petty_cash_account).
 */
export interface PettyCashLineForm {
  uid: string;
  supplierName: string;
  /** Supplier FK from the picker — persisted as supplierId on the petty-cash line. */
  supplierId: string;
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
  /** Supplier FK from the picker — persisted as vendorSupplierId on the expense document. */
  vendorSupplierId: string;
  taxInvoiceNo: string;
  priceType: PriceType;
  whtFormType: WhtFormType | '';
  paymentMethod: string;
  depositAccountCode: string;
  reference: string;
  receiptImageUrl: string;
  note: string;
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
  userId: '',
  employeeTaxId: '',
  baseSalary: '',
  ssoEmployee: '0',
  whtAmount: '0',
  customIncome: [],
  customDeduction: [],
  systemIncome: [],
  attendanceSummary: null,
  systemNotes: null,
  _expanded: false,
  ...overrides,
});

export const newPayrollCustomIncome = (
  overrides?: Partial<PayrollCustomIncomeRow>,
): PayrollCustomIncomeRow => ({
  uid: Math.random().toString(36).slice(2),
  // Default account is scope-dependent (SHOP vs FINANCE whitelist) — the
  // caller (CustomIncomeSubTable.add) passes the first whitelist option.
  accountCode: '',
  name: '',
  amount: '',
  isTaxable: true,
  isAdjustment: false,
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
  supplierId: '',
  category: '',
  description: '',
  amount: '',
  vatPercent: '0',
  taxInvoiceNo: '',
  ...overrides,
});
