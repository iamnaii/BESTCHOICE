import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { PeakExportService } from './peak-export.service';
import { ReceivablesReportService } from './receivables-report.service';
import { TransactionalReportService } from './transactional-report.service';
import { GeneralLedgerReportService } from './general-ledger-report.service';

/**
 * INVENTORY COSTING METHOD: Specific Identification
 * Each product has a unique costPrice (IMEI-level tracking).
 * COGS is calculated as the specific costPrice of the sold product.
 * This is compliant with TAS 2 for items that are not interchangeable.
 */
export const INVENTORY_COSTING_METHOD = 'SPECIFIC_IDENTIFICATION' as const;

// Legacy CATEGORY_ACCOUNT_MAP / CATEGORY_CODE_MAP / generateExpenseNumber were removed
// alongside the legacy Expense model. The new ExpenseDocument module owns category↔code
// resolution and document numbering — see modules/expense-documents/.

// Phase A.6 boot validator was tied to the legacy CATEGORY_CODE_MAP — the new
// ExpenseDocument module performs its own CoA validation at document creation time.

/**
 * ═══════════════════════════════════════════════════════════════
 * นโยบายการบัญชี (Accounting Policies) — BESTCHOICE
 * มาตรฐาน: TFRS for NPAEs (กิจการที่ไม่มีส่วนได้เสียสาธารณะ)
 * ═══════════════════════════════════════════════════════════════
 *
 * 1. การรับรู้รายได้ (Revenue Recognition) — เกณฑ์เงินสด (Cash Basis)
 *    - ขายเงินสด: รับรู้เมื่อส่งมอบสินค้าและรับเงิน
 *    - ขายผ่อน (เงินดาวน์): รับรู้เมื่อรับเงินดาวน์
 *    - ขายผ่อน (งวดผ่อน): รับรู้เมื่อลูกค้าชำระแต่ละงวด
 *    - ไฟแนนซ์ภายนอก: รับรู้เมื่อได้รับเงินจากบริษัทไฟแนนซ์
 *    หมายเหตุ: amountPaid รวมเงินต้น + ดอกเบี้ย + ค่าปรับ ทั้งหมดไว้แล้ว
 *
 * 2. ดอกเบี้ยเช่าซื้อ — Straight-line method (เกณฑ์เส้นตรง)
 *    - ดอกเบี้ยรายเดือน = ดอกเบี้ยรวม / จำนวนงวด
 *    - เป็นค่า memo สำหรับแสดงผลใน P&L (ไม่บวกเพิ่มจาก amountPaid)
 *
 * 3. ค่าใช้จ่าย — เกณฑ์คงค้าง (Accrual Basis)
 *    - บันทึกเมื่อเกิดรายการ ไม่ว่าจะจ่ายเงินแล้วหรือยัง
 *
 * 4. สินค้าคงเหลือ — Specific Identification (ระบุเฉพาะ)
 *    - สินค้าแต่ละชิ้นมี costPrice เฉพาะ (IMEI-level tracking)
 */
@Injectable()
export class AccountingService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
    // P3-SP5 W7: defense-in-depth filter on companyId for SHOP/FINANCE scoping.
    private companyResolver: CompanyResolverService,
    // Wave-4 P3: PEAK CSV export extracted into a collaborator service.
    private peakExport: PeakExportService,
    // Wave-4 P4: aging + bad-debt receivables reports extracted into a collaborator service.
    private receivablesReport: ReceivablesReportService,
    // Wave-4 P5: transactional (sales/payment-aggregate-based) financial reports
    // extracted into a collaborator service. AccountingService delegates to it.
    private transactionalReport: TransactionalReportService,
    // Wave-4 P6: journal-line-based general-ledger reports (Trial Balance,
    // journal P&L/Balance Sheet, Cash Flow, Equity Statement, General Ledger,
    // General Journal) extracted into a collaborator service. AccountingService
    // delegates to it.
    private generalLedgerReport: GeneralLedgerReportService,
  ) {}

  /**
   * Boot hook retained for future CoA validation needs. Legacy CATEGORY_CODE_MAP
   * validation moved to the new ExpenseDocument module.
   */
  async onModuleInit() {
    // No-op — see ExpenseDocument module for CoA validation.
  }

  /**
   * Resolve companyId to an array of branchIds belonging to that company.
   * Used to scope financial reports by company entity.
   */
  async getBranchIdsForCompany(companyId: string): Promise<string[]> {
    const branches = await this.prisma.branch.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true },
    });
    return branches.map((b) => b.id);
  }


  // ─── P&L Calculation ─────────────────────────────────────────────────────────

  async getProfitLossReport(
    startDate: string,
    endDate: string,
    branchId?: string,
    branchIds?: string[],
    includeFinanceExpenses = false,
  ) {
    return this.transactionalReport.getProfitLossReport(
      startDate,
      endDate,
      branchId,
      branchIds,
      includeFinanceExpenses,
    );
  }

  async getMonthlyPLSummary(
    year: number,
    branchId?: string,
    branchIds?: string[],
    includeFinanceExpenses = false,
  ) {
    return this.transactionalReport.getMonthlyPLSummary(
      year,
      branchId,
      branchIds,
      includeFinanceExpenses,
    );
  }

  // ─── W-012: Comparative P&L (MoM / YoY) ──────────────────────────────────────

  async getComparativePL(
    year: number,
    month: number,
    branchId?: string,
    branchIds?: string[],
    includeFinanceExpenses = false,
  ) {
    return this.transactionalReport.getComparativePL(
      year,
      month,
      branchId,
      branchIds,
      includeFinanceExpenses,
    );
  }

  // ─── Balance Sheet (derived from existing data, no general ledger) ────────────

  async getBalanceSheet(asOfDate: string, branchId?: string, branchIds?: string[]) {
    return this.transactionalReport.getBalanceSheet(asOfDate, branchId, branchIds);
  }

  // ─── T17: Journal-line-based Trial Balance / P&L / Balance Sheet ─────────────
  //
  // These methods pull from the JournalEntry/JournalLine general ledger (Phase A.4
  // CPA chart). They are distinct from getProfitLossReport / getBalanceSheet (which
  // pull from raw transactional tables and are retained for backward compat).
  //
  // Account code prefix → section mapping (FINANCE 99-account chart):
  //   11 = สินทรัพย์หมุนเวียน (Current Assets)
  //   12 = สินทรัพย์ไม่หมุนเวียน (Non-Current Assets)
  //   21 = หนี้สินหมุนเวียน (Current Liabilities)
  //   22 = หนี้สินไม่หมุนเวียน (Non-Current Liabilities)
  //   31 = ทุนจดทะเบียน (Share Capital)
  //   32 = กำไรสะสม (Retained Earnings)
  //   33 = กำไรขาดทุนปีปัจจุบัน (Current Year Profit)
  //   41 = รายได้จากการดำเนินงาน (Operating Revenue)
  //   42 = รายได้อื่น (Other Income)
  //   51 = ต้นทุนทางการเงิน (Finance Costs)
  //   52 = ค่าใช้จ่ายขาย (Selling Expenses)
  //   53 = ค่าใช้จ่ายบริหาร (Admin Expenses)
  //   54 = ค่าใช้จ่ายต้องห้าม (Tax-disallowed Expenses)
  //   55 = EXCLUDE from P&L (พีคโปรแกรม — ไม่นำมาแสดงในงบกำไรขาดทุน)

  /**
   * Get Trial Balance from journal lines as of a given date.
   *
   * Queries all ChartOfAccount records and sums JournalLine debit/credit
   * from POSTED JournalEntries with entryDate <= asOfDate.
   *
   * Sections are grouped by the 2-digit prefix of the account code (11, 12, 21, …).
   * isBalanced = grandDrTotal equals grandCrTotal (accounting identity check).
   *
   * P3-SP5: `scope` filters by account code prefix:
   *   - 'FINANCE' (default) — codes WITHOUT `S` prefix (the FINANCE chart)
   *   - 'SHOP'              — codes WITH    `S` prefix (the SHOP chart)
   *   - 'ALL'               — all accounts (combined report — both prefixes)
   *
   * Filtering happens on `chartOfAccount.code` and `journalLine.accountCode`
   * at the DB level so SHOP/FINANCE running balances stay strictly separate.
   */
  async getTrialBalance(asOfDate?: Date, scope: 'FINANCE' | 'SHOP' | 'ALL' = 'FINANCE') {
    return this.generalLedgerReport.getTrialBalance(asOfDate, scope);
  }

  /**
   * Get P&L from journal lines for a given period.
   *
   * Revenue = net Cr balance of accounts 41 + 42 for the period.
   * Expenses = net Dr balance of accounts 51 + 52 + 53 + 54 for the period.
   * COGS    = net Dr balance of S50 (SHOP only — FINANCE does not carry COGS).
   * Accounts in prefix 55 are EXCLUDED per CPA chart note ("ไม่นำมาแสดงในงบกำไรขาดทุน").
   *
   * Period filter: JournalEntry.entryDate between periodStart and periodEnd (inclusive).
   *
   * Optional companyId scopes to JournalEntry.companyId — used by multi-entity
   * reports (SP2 Cash Flow / Equity Statement / General Ledger).
   *
   * P3-SP5: `scope` filters by account code prefix:
   *   - 'FINANCE' (default) — codes WITHOUT `S` prefix
   *   - 'SHOP'              — codes WITH    `S` prefix (S41, S42, S50, S51, S52, S53)
   *   - 'ALL'               — both
   */
  async getProfitLossFromJournal(
    periodStart: Date,
    periodEnd: Date,
    companyId?: string,
    scope: 'FINANCE' | 'SHOP' | 'ALL' = 'FINANCE',
  ) {
    return this.generalLedgerReport.getProfitLossFromJournal(periodStart, periodEnd, companyId, scope);
  }

  /**
   * Get Balance Sheet from journal lines as of a given date.
   *
   * Assets (11 + 12): Dr-normal accounts add, Contra assets (type='สินทรัพย์ (Contra)'
   *   or normalBalance='Cr') subtract.
   * Liabilities (21 + 22): Cr-normal sums.
   * Equity (31 + 32 + 33): Cr-normal sums.
   *
   * isBalanced: assets.total === liabilities.total + equity.total
   */
  async getBalanceSheetFromJournal(asOfDate?: Date) {
    return this.generalLedgerReport.getBalanceSheetFromJournal(asOfDate);
  }

  // ─── Cash Flow Statement (derived from existing data, no general ledger) ──────

  async getCashFlowStatement(startDate: string, endDate: string, branchId?: string, branchIds?: string[]) {
    return this.transactionalReport.getCashFlowStatement(startDate, endDate, branchId, branchIds);
  }

  // ─── SP2: Cash Flow (Indirect Method) ─────────────────────────────────────────
  //
  // TFRS for NPAEs Indirect Method:
  //   1. Net Income (from getProfitLossFromJournal)
  //   2. + Non-cash adjustments (depreciation, bad-debt provision Δ, unearned interest Δ)
  //   3. ± Working capital Δ (AR, Inventory, AP, VAT payable)
  //   4. Investing (PPE purchases / disposals)
  //   5. Financing (capital injections / dividends)
  //   6. Net Change reconciled vs. actual cash account movement (±1 THB tolerance)

  /**
   * Cash Flow Statement — Indirect Method (TFRS for NPAEs).
   *
   * @param periodStart start of period (inclusive)
   * @param periodEnd   end of period (inclusive — caller should set 23:59:59.999 if needed)
   * @param companyId   optional CompanyInfo.id scope
   */
  async getCashFlowFromJournal(
    periodStart: Date,
    periodEnd: Date,
    companyId?: string,
  ) {
    return this.generalLedgerReport.getCashFlowFromJournal(periodStart, periodEnd, companyId);
  }

  // ─── SP2: Equity Statement ────────────────────────────────────────────────────
  //
  // Matrix of equity accounts (31-1101, 31-1102, 32-1101, 33-1101) showing
  // ยอดต้นงวด / +เพิ่ม / -ลด / ยอดปลายงวด with movement details.
  // The current-year P&L line is derived from getProfitLossFromJournal — labelled
  // with a caveat because year-end closing entries have not been posted to 33-1101.

  async getEquityStatementFromJournal(
    periodStart: Date,
    periodEnd: Date,
    companyId?: string,
  ) {
    return this.generalLedgerReport.getEquityStatementFromJournal(periodStart, periodEnd, companyId);
  }

  // ─── SP2: General Ledger ──────────────────────────────────────────────────────

  /**
   * General Ledger for a single account over a period.
   * Returns opening balance, every posted journal line, and running balance.
   *
   * Running balance is signed on the normal side:
   *   - Dr-normal account: balance = Σ(debit - credit)
   *   - Cr-normal account: balance = Σ(credit - debit)
   *   - Dr/Cr account: treated as Dr-normal for display purposes.
   */
  async getGeneralLedger(
    accountCode: string,
    periodStart: Date,
    periodEnd: Date,
    companyId?: string,
  ) {
    return this.generalLedgerReport.getGeneralLedger(accountCode, periodStart, periodEnd, companyId);
  }

  // ============================================================
  // P3-SP3: PEAK CSV export (journal lines tagged with PEAK code)
  // ============================================================

  /**
   * Build a CSV of POSTED journal lines within `[periodStart, periodEnd]`
   * joined with their `ChartOfAccount.peakCode`. Lines whose account has no
   * PEAK mapping are SKIPPED (returned `skippedLineCount`) so the caller can
   * surface a warning. Date range is capped at ~6 months (186 days) so accidental
   * "give me everything" queries don't dump millions of rows.
   *
   * Output columns:
   *   entryDate, entryNumber, peakCode, accountCode, accountName,
   *   debit, credit, description, reference
   *
   * Money values are emitted via `.toString()` to preserve Decimal precision
   * (matches the "DO NOT Number() on Prisma.Decimal in export" rule).
   */
  async exportJournalWithPeakCodes(
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ csv: string; rowCount: number; skippedLineCount: number }> {
    return this.peakExport.exportJournalWithPeakCodes(periodStart, periodEnd);
  }

  // ─── General Journal ──────────────────────────────────────────────────────

  /**
   * Returns a paginated list of JournalEntries within the given date range,
   * ordered by postedAt descending, with their lines included.
   *
   * Used by the GeneralJournalPage (P4-SP1, Task 7).
   */
  async getGeneralJournal(
    periodStart: Date,
    periodEnd: Date,
    opts: { page?: number; limit?: number; companyId?: string } = {},
  ) {
    return this.generalLedgerReport.getGeneralJournal(periodStart, periodEnd, opts);
  }

  // ─── P4-SP1: Aging Report ────────────────────────────────────────────────

  async getAgingReport(asOf: Date) {
    return this.receivablesReport.getAgingReport(asOf);
  }

  // ─── P4-SP1 Task 3: Bad Debt Report ─────────────────────────────────────────

  /**
   * Returns journal lines posted to account 51-1102 (หนี้สูญ/ขาดทุนจากยึดเครื่อง)
   * within the given period. Used by BadDebtReportPage to display write-off history.
   *
   * Per .claude/rules/accounting.md:
   *   51-1102 = หนี้สูญ/ขาดทุนจากยึดเครื่อง (RepossessionJP5Template loss branch)
   */
  async getBadDebtReport(periodStart: Date, periodEnd: Date, companyId?: string) {
    return this.receivablesReport.getBadDebtReport(periodStart, periodEnd, companyId);
  }
}
