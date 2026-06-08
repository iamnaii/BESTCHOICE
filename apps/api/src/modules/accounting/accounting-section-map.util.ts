/**
 * Pure, stateless chart-of-accounts → report-section maps + helpers, extracted
 * from AccountingService (Wave-4 decomposition, P1 tracer bullet). No DB, no
 * state, no DI — behaviour is byte-identical to the former private static
 * members. Shareable with MonthlyCloseService / ReportsService and independently
 * unit-testable.
 */

/** Granular /reports P&L expense category (display only; section sums are authoritative). */
export type ReportExpenseCategory =
  | 'SELL_COMMISSION' | 'SELL_ADVERTISING'
  | 'ADMIN_SALARY' | 'ADMIN_SOCIAL_SECURITY' | 'ADMIN_OFFICE_SUPPLIES'
  | 'ADMIN_UTILITIES' | 'ADMIN_TELEPHONE' | 'ADMIN_TRAVEL' | 'ADMIN_MAINTENANCE'
  | 'ADMIN_TAX_FEE' | 'ADMIN_DEPRECIATION'
  | 'OTHER_LOSS' | 'OTHER_FINE' | 'OTHER_MISC';

/**
 * Account → /reports P&L granular category (display only; totals come from
 * section sums). Accountant-reviewable: rollups chosen from the FINANCE chart
 * names (see docs/superpowers/specs/2026-06-07-reports-pl-expense-migration-design.md).
 * Accounts not listed still count in their section total but show no granular line.
 */
export const EXPENSE_ACCOUNT_CATEGORY: Record<string, ReportExpenseCategory> = {
  '52-1101': 'SELL_COMMISSION',
  '52-1102': 'SELL_ADVERTISING', '52-1103': 'SELL_ADVERTISING',
  '53-1101': 'ADMIN_SALARY', '53-1103': 'ADMIN_SALARY', '53-1104': 'ADMIN_SALARY',
  '53-1105': 'ADMIN_SALARY', '53-1106': 'ADMIN_SALARY',
  '53-1102': 'ADMIN_SOCIAL_SECURITY',
  '53-1201': 'ADMIN_OFFICE_SUPPLIES', '53-1202': 'ADMIN_OFFICE_SUPPLIES', '53-1203': 'ADMIN_OFFICE_SUPPLIES',
  '53-1301': 'ADMIN_UTILITIES', '53-1302': 'ADMIN_UTILITIES',
  '53-1303': 'ADMIN_TELEPHONE',
  '53-1304': 'ADMIN_TRAVEL',
  '53-1305': 'ADMIN_MAINTENANCE', '53-1306': 'ADMIN_MAINTENANCE',
  '53-1401': 'ADMIN_TAX_FEE', '53-1402': 'ADMIN_TAX_FEE', '53-1403': 'ADMIN_TAX_FEE',
  '53-1404': 'ADMIN_TAX_FEE', '53-1501': 'ADMIN_TAX_FEE', '53-1502': 'ADMIN_TAX_FEE',
  '53-1701': 'ADMIN_TAX_FEE', '53-1702': 'ADMIN_TAX_FEE',
  '53-1601': 'ADMIN_DEPRECIATION', '53-1602': 'ADMIN_DEPRECIATION',
  '53-1603': 'ADMIN_DEPRECIATION', '53-1604': 'ADMIN_DEPRECIATION',
  '51-1102': 'OTHER_LOSS', '51-1103': 'OTHER_LOSS', '53-1605': 'OTHER_LOSS',
  '51-1104': 'OTHER_FINE', '54-1103': 'OTHER_FINE', '54-1104': 'OTHER_FINE',
  '51-1101': 'OTHER_MISC', '51-1105': 'OTHER_MISC', '53-1503': 'OTHER_MISC',
  '54-1101': 'OTHER_MISC', '54-1102': 'OTHER_MISC',
};

/** Account-code section-prefix → Thai section name (FINANCE single-prefix + SHOP S-prefix). */
export const SECTION_MAP: Record<string, string> = {
  // FINANCE chart (single-prefix)
  '11': 'สินทรัพย์หมุนเวียน',
  '12': 'สินทรัพย์ไม่หมุนเวียน',
  '21': 'หนี้สินหมุนเวียน',
  '22': 'หนี้สินไม่หมุนเวียน',
  '31': 'ทุนจดทะเบียน',
  '32': 'กำไรสะสม',
  '33': 'กำไรขาดทุนปีปัจจุบัน',
  '41': 'รายได้จากการดำเนินงาน',
  '42': 'รายได้อื่น',
  '51': 'ต้นทุนทางการเงิน',
  '52': 'ค่าใช้จ่ายขาย',
  '53': 'ค่าใช้จ่ายบริหาร',
  '54': 'ค่าใช้จ่ายต้องห้ามทางภาษี',
  '55': 'ค่าใช้จ่ายโปรแกรมบัญชี (ยกเว้น P&L)',
  // P3-SP5 — SHOP chart (S-prefix). Same logical grouping as FINANCE but
  // labelled "(SHOP)" so a combined report makes it obvious which side a
  // section came from.
  'S11': 'สินทรัพย์หมุนเวียน (SHOP)',
  'S12': 'สินทรัพย์ไม่หมุนเวียน (SHOP)',
  'S21': 'หนี้สินหมุนเวียน (SHOP)',
  'S22': 'หนี้สินไม่หมุนเวียน (SHOP)',
  'S31': 'ทุนจดทะเบียน (SHOP)',
  'S32': 'กำไรสะสม (SHOP)',
  'S33': 'กำไรขาดทุนปีปัจจุบัน (SHOP)',
  'S41': 'รายได้ (SHOP)',
  'S42': 'รายได้อื่น (SHOP)',
  'S50': 'ต้นทุนขาย (SHOP)',
  'S51': 'ค่าใช้จ่ายขาย (SHOP)',
  'S52': 'ค่าใช้จ่ายบริหาร (SHOP)',
  'S53': 'ค่าใช้จ่ายอื่น (SHOP)',
};

/**
 * Extract the section-prefix from an account code.
 * - FINANCE: `11-1101` → `11` (first 2 chars)
 * - SHOP:    `S11-1101` → `S11` (first 3 chars, S + 2 digits)
 */
export function codePrefix(code: string): string {
  return code.startsWith('S') ? code.slice(0, 3) : code.slice(0, 2);
}

/** Equity accounts (code + fallback name) for the equity statement. */
export const EQUITY_ACCOUNTS: { code: string; defaultName: string }[] = [
  { code: '31-1101', defaultName: 'หุ้นสามัญ' },
  { code: '31-1102', defaultName: 'ส่วนเกินมูลค่าหุ้น' },
  { code: '32-1101', defaultName: 'กำไร(ขาดทุน)สะสม' },
  { code: '33-1101', defaultName: 'กำไร(ขาดทุน)สุทธิประจำปี' },
];
