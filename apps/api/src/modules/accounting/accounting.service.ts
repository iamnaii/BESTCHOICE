import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal/journal-auto.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { PeakExportService } from './peak-export.service';
import { ReceivablesReportService } from './receivables-report.service';
import { TransactionalReportService } from './transactional-report.service';
import {
  SECTION_MAP,
  codePrefix,
  EQUITY_ACCOUNTS,
} from './accounting-section-map.util';

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
  private readonly logger = new Logger(AccountingService.name);
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
    const cutoff = asOfDate ?? new Date();

    // Code-prefix filter: SHOP codes start with 'S' (S11-XXXX); FINANCE codes
    // are bare digits (11-XXXX). Use Prisma `startsWith` for the SHOP filter
    // and `not.startsWith` for FINANCE. 'ALL' skips the filter entirely.
    const codeFilter: Prisma.StringFilter | undefined =
      scope === 'SHOP'
        ? { startsWith: 'S' }
        : scope === 'FINANCE'
          ? { not: { startsWith: 'S' } }
          : undefined;

    // P3-SP5 W7 — defense-in-depth: ALSO filter by JournalEntry.companyId.
    // Code-prefix is the partition key but companyId guards against the
    // edge case of a misposted JE (S-code lines under FINANCE companyId
    // or vice versa). 'ALL' skips this filter so combined views work.
    const companyIdFilter: string | undefined =
      scope === 'SHOP'
        ? await this.companyResolver.getShopCompanyId()
        : scope === 'FINANCE'
          ? await this.companyResolver.getFinanceCompanyId()
          : undefined;

    // 1. Load all active chart of accounts (scoped)
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: {
        deletedAt: null,
        status: 'ใช้งาน',
        ...(codeFilter ? { code: codeFilter } : {}),
      },
      orderBy: { code: 'asc' },
    });

    // 2. Sum journal lines per accountCode from POSTED entries up to cutoff
    const lineSums = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        journalEntry: {
          status: 'POSTED',
          entryDate: { lte: cutoff },
          deletedAt: null,
          ...(companyIdFilter ? { companyId: companyIdFilter } : {}),
        },
        deletedAt: null,
        ...(codeFilter ? { accountCode: codeFilter } : {}),
      },
      _sum: { debit: true, credit: true },
    });

    const sumMap = new Map<string, { dr: Prisma.Decimal; cr: Prisma.Decimal }>();
    for (const row of lineSums) {
      sumMap.set(row.accountCode, {
        dr: new Prisma.Decimal(row._sum.debit ?? 0),
        cr: new Prisma.Decimal(row._sum.credit ?? 0),
      });
    }

    // 3. Build per-section rows (include accounts with activity even if CoA doesn't exist,
    //    and include CoA accounts with zero balances)
    const sectionMap = new Map<string, {
      sectionName: string;
      codePrefix: string;
      rows: {
        code: string; name: string; type: string; normalBalance: string;
        drBalance: Prisma.Decimal; crBalance: Prisma.Decimal; netBalance: Prisma.Decimal;
      }[];
      drTotal: Prisma.Decimal;
      crTotal: Prisma.Decimal;
    }>();

    for (const acc of accounts) {
      const prefix = codePrefix(acc.code);
      const sectionName = SECTION_MAP[prefix] ?? `หมวด ${prefix}`;

      if (!sectionMap.has(prefix)) {
        sectionMap.set(prefix, {
          sectionName,
          codePrefix: prefix,
          rows: [],
          drTotal: new Prisma.Decimal(0),
          crTotal: new Prisma.Decimal(0),
        });
      }

      const sums = sumMap.get(acc.code) ?? { dr: new Prisma.Decimal(0), cr: new Prisma.Decimal(0) };
      // netBalance: Dr-normal → dr - cr; Cr-normal → cr - dr; Dr/Cr → dr - cr (default Dr)
      const netBalance = acc.normalBalance === 'Cr'
        ? sums.cr.sub(sums.dr)
        : sums.dr.sub(sums.cr);

      const section = sectionMap.get(prefix)!;
      section.rows.push({
        code: acc.code,
        name: acc.name,
        type: acc.type,
        normalBalance: acc.normalBalance,
        drBalance: sums.dr,
        crBalance: sums.cr,
        netBalance,
      });
      section.drTotal = section.drTotal.add(sums.dr);
      section.crTotal = section.crTotal.add(sums.cr);
    }

    // Also include any journal lines for codes not in CoA (orphan codes)
    for (const [code, sums] of sumMap) {
      const prefix = codePrefix(code);
      if (!sectionMap.has(prefix)) {
        sectionMap.set(prefix, {
          sectionName: SECTION_MAP[prefix] ?? `หมวด ${prefix}`,
          codePrefix: prefix,
          rows: [],
          drTotal: new Prisma.Decimal(0),
          crTotal: new Prisma.Decimal(0),
        });
      }
      const section = sectionMap.get(prefix)!;
      // Check if already added via CoA iteration
      if (!section.rows.find((r) => r.code === code)) {
        section.rows.push({
          code,
          name: `[ไม่พบในผังบัญชี] ${code}`,
          type: 'ไม่ระบุ',
          normalBalance: 'Dr',
          drBalance: sums.dr,
          crBalance: sums.cr,
          netBalance: sums.dr.sub(sums.cr),
        });
        section.drTotal = section.drTotal.add(sums.dr);
        section.crTotal = section.crTotal.add(sums.cr);
      }
    }

    // 4. Sort sections by code prefix and compute grand totals
    const sections = Array.from(sectionMap.values()).sort((a, b) =>
      a.codePrefix.localeCompare(b.codePrefix),
    );

    let grandDrTotal = new Prisma.Decimal(0);
    let grandCrTotal = new Prisma.Decimal(0);
    for (const s of sections) {
      grandDrTotal = grandDrTotal.add(s.drTotal);
      grandCrTotal = grandCrTotal.add(s.crTotal);
    }

    // P3-SP5 DEEP review C5 — per-scope subtotals + per-scope balance check.
    //
    // For scope='ALL' the combined Dr / Cr totals can sum to zero even if
    // the SHOP half is unbalanced and the FINANCE half is unbalanced by
    // the same magnitude in opposite directions. That hides real bugs.
    // Always return strict per-scope totals so the UI can show TWO balance
    // badges (SHOP balanced / FINANCE balanced) instead of one combined.
    const shopDr = sections
      .filter((s) => s.codePrefix.startsWith('S'))
      .reduce((acc, s) => acc.add(s.drTotal), new Prisma.Decimal(0));
    const shopCr = sections
      .filter((s) => s.codePrefix.startsWith('S'))
      .reduce((acc, s) => acc.add(s.crTotal), new Prisma.Decimal(0));
    const financeDr = sections
      .filter((s) => !s.codePrefix.startsWith('S'))
      .reduce((acc, s) => acc.add(s.drTotal), new Prisma.Decimal(0));
    const financeCr = sections
      .filter((s) => !s.codePrefix.startsWith('S'))
      .reduce((acc, s) => acc.add(s.crTotal), new Prisma.Decimal(0));

    const shopBalanced = shopDr.equals(shopCr);
    const financeBalanced = financeDr.equals(financeCr);
    // isAllBalanced is STRICTER than the combined Dr=Cr check — both halves
    // MUST balance independently. Combined Dr=Cr alone is not enough.
    const isAllBalanced =
      scope === 'ALL'
        ? shopBalanced && financeBalanced
        : scope === 'SHOP'
          ? shopBalanced
          : financeBalanced;

    return {
      asOfDate: cutoff,
      scope,
      sections,
      grandDrTotal,
      grandCrTotal,
      // Per-scope subtotals (always populated; consumers can show them per
      // their needs — UI shows both badges when scope='ALL').
      perScope: {
        shop: {
          drTotal: shopDr,
          crTotal: shopCr,
          isBalanced: shopBalanced,
        },
        finance: {
          drTotal: financeDr,
          crTotal: financeCr,
          isBalanced: financeBalanced,
        },
      },
      // Legacy combined balance check (kept for backward compatibility but
      // do NOT rely on it for scope='ALL' — use `isAllBalanced` instead).
      isBalanced: grandDrTotal.equals(grandCrTotal),
      isAllBalanced,
    };
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
    // Prefixes per scope. SHOP introduces S50-XXXX COGS (treated as
    // expense in the P&L — separately reported under "ต้นทุนขาย").
    const REVENUE_PREFIXES =
      scope === 'SHOP'
        ? ['S41', 'S42']
        : scope === 'ALL'
          ? ['41', '42', 'S41', 'S42']
          : ['41', '42'];
    const EXPENSE_PREFIXES =
      scope === 'SHOP'
        ? ['S50', 'S51', 'S52', 'S53']
        : scope === 'ALL'
          ? ['51', '52', '53', '54', 'S50', 'S51', 'S52', 'S53']
          : ['51', '52', '53', '54']; // 55 excluded

    const codeFilter: Prisma.StringFilter | undefined =
      scope === 'SHOP'
        ? { startsWith: 'S' }
        : scope === 'FINANCE'
          ? { not: { startsWith: 'S' } }
          : undefined;

    // P3-SP5 W7 — defense-in-depth companyId filter (see getTrialBalance for
    // rationale). Honour an explicit `companyId` override from callers that
    // already know the company; otherwise resolve from scope.
    let companyIdFilter: string | undefined = companyId;
    if (!companyIdFilter) {
      if (scope === 'SHOP') {
        companyIdFilter = await this.companyResolver.getShopCompanyId();
      } else if (scope === 'FINANCE') {
        companyIdFilter = await this.companyResolver.getFinanceCompanyId();
      }
      // scope === 'ALL' leaves companyIdFilter unset (cross-company view).
    }

    const lineSums = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
          ...(companyIdFilter ? { companyId: companyIdFilter } : {}),
        },
        deletedAt: null,
        ...(codeFilter ? { accountCode: codeFilter } : {}),
      },
      _sum: { debit: true, credit: true },
    });

    // Load CoA for names
    const codes = lineSums.map((r) => r.accountCode);
    const coaRecords = codes.length > 0
      ? await this.prisma.chartOfAccount.findMany({
          where: { code: { in: codes }, deletedAt: null },
          select: { code: true, name: true },
        })
      : [];
    const nameMap = new Map(coaRecords.map((c) => [c.code, c.name]));

    const revenueRows: { code: string; name: string; amount: Prisma.Decimal }[] = [];
    const expenseRows: { code: string; name: string; amount: Prisma.Decimal }[] = [];
    let revenueTotal = new Prisma.Decimal(0);
    let expenseTotal = new Prisma.Decimal(0);

    // P3-SP5 DEEP review C5 — per-scope subtotals so the UI can show SHOP
    // vs FINANCE side-by-side without re-querying.
    let shopRevenueTotal = new Prisma.Decimal(0);
    let shopExpenseTotal = new Prisma.Decimal(0);
    let financeRevenueTotal = new Prisma.Decimal(0);
    let financeExpenseTotal = new Prisma.Decimal(0);

    for (const row of lineSums) {
      const prefix = codePrefix(row.accountCode);
      const dr = new Prisma.Decimal(row._sum.debit ?? 0);
      const cr = new Prisma.Decimal(row._sum.credit ?? 0);
      const name = nameMap.get(row.accountCode) ?? row.accountCode;
      const isShop = row.accountCode.startsWith('S');

      if (REVENUE_PREFIXES.includes(prefix)) {
        // Revenue accounts are Cr-normal: net = Cr - Dr
        const amount = cr.sub(dr);
        revenueRows.push({ code: row.accountCode, name, amount });
        revenueTotal = revenueTotal.add(amount);
        if (isShop) shopRevenueTotal = shopRevenueTotal.add(amount);
        else financeRevenueTotal = financeRevenueTotal.add(amount);
      } else if (EXPENSE_PREFIXES.includes(prefix)) {
        // Expense accounts are Dr-normal: net = Dr - Cr
        const amount = dr.sub(cr);
        expenseRows.push({ code: row.accountCode, name, amount });
        expenseTotal = expenseTotal.add(amount);
        if (isShop) shopExpenseTotal = shopExpenseTotal.add(amount);
        else financeExpenseTotal = financeExpenseTotal.add(amount);
      }
      // prefix 55 and others: skip
    }

    revenueRows.sort((a, b) => a.code.localeCompare(b.code));
    expenseRows.sort((a, b) => a.code.localeCompare(b.code));

    return {
      periodStart,
      periodEnd,
      scope,
      revenue: {
        sectionName: 'รายได้รวม',
        rows: revenueRows,
        total: revenueTotal,
      },
      expenses: {
        sectionName: 'ค่าใช้จ่ายรวม',
        rows: expenseRows,
        total: expenseTotal,
      },
      netIncome: revenueTotal.sub(expenseTotal),
      // P3-SP5 DEEP review C5 — per-scope subtotals (always populated).
      // For scope='ALL' the UI displays BOTH side-by-side; for SHOP/FINANCE
      // the other side will be 0.
      perScope: {
        shop: {
          revenueTotal: shopRevenueTotal,
          expenseTotal: shopExpenseTotal,
          netIncome: shopRevenueTotal.sub(shopExpenseTotal),
        },
        finance: {
          revenueTotal: financeRevenueTotal,
          expenseTotal: financeExpenseTotal,
          netIncome: financeRevenueTotal.sub(financeExpenseTotal),
        },
      },
    };
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
    const cutoff = asOfDate ?? new Date();
    // P3-SP5 W1: explicit 'FINANCE' scope — this method historically reports
    // the FINANCE-side balance sheet. SHOP balance sheet is deferred to SP7.
    const tb = await this.getTrialBalance(cutoff, 'FINANCE');

    const zero = new Prisma.Decimal(0);

    // Helper: sum net balances for a set of code prefixes within trial balance sections
    const sumNetForPrefixes = (prefixes: string[]) => {
      let total = zero;
      for (const section of tb.sections) {
        if (!prefixes.includes(section.codePrefix)) continue;
        for (const row of section.rows) {
          // For Contra assets (Cr-normal inside asset sections):
          // netBalance is already negative (cr - dr when Cr-normal), so adding it reduces total — correct.
          // For Dr-normal assets: netBalance is positive — adds to total.
          total = total.add(row.netBalance);
        }
      }
      return total;
    };

    const buildSection = (prefixes: string[]) => {
      const rows: { code: string; name: string; type: string; normalBalance: string; netBalance: Prisma.Decimal }[] = [];
      for (const section of tb.sections) {
        if (!prefixes.includes(section.codePrefix)) continue;
        for (const row of section.rows) {
          rows.push({ code: row.code, name: row.name, type: row.type, normalBalance: row.normalBalance, netBalance: row.netBalance });
        }
      }
      rows.sort((a, b) => a.code.localeCompare(b.code));
      const total = rows.reduce((sum, r) => sum.add(r.netBalance), zero);
      return { rows, total };
    };

    const currentAssets = buildSection(['11']);
    const nonCurrentAssets = buildSection(['12']);
    const assetsTotal = currentAssets.total.add(nonCurrentAssets.total);

    const currentLiabilities = buildSection(['21']);
    const nonCurrentLiabilities = buildSection(['22']);
    const liabilitiesTotal = currentLiabilities.total.add(nonCurrentLiabilities.total);

    const equity = buildSection(['31', '32', '33']);

    const isBalanced = assetsTotal.equals(liabilitiesTotal.add(equity.total));

    return {
      asOfDate: cutoff,
      assets: {
        current: { ...currentAssets, sectionName: 'สินทรัพย์หมุนเวียน' },
        nonCurrent: { ...nonCurrentAssets, sectionName: 'สินทรัพย์ไม่หมุนเวียน' },
        total: assetsTotal,
      },
      liabilities: {
        current: { ...currentLiabilities, sectionName: 'หนี้สินหมุนเวียน' },
        nonCurrent: { ...nonCurrentLiabilities, sectionName: 'หนี้สินไม่หมุนเวียน' },
        total: liabilitiesTotal,
      },
      equity: { ...equity, sectionName: 'ส่วนของผู้ถือหุ้น' },
      isBalanced,
    };
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
   * Sum net balance of a list of account-code prefixes as of a specific date.
   * Aggregates over JournalLine on POSTED entries (entryDate <= asOfDate).
   *
   * normalSide controls signing:
   *   - 'Dr' → returns (debit - credit). Positive = balance on debit side.
   *   - 'Cr' → returns (credit - debit). Positive = balance on credit side.
   *
   * Optional companyId scopes to JournalEntry.companyId (multi-entity reports).
   */
  private async sumAccountBalances(
    codePrefixes: string[],
    asOfDate: Date,
    normalSide: 'Dr' | 'Cr',
    companyId?: string,
  ): Promise<Prisma.Decimal> {
    if (codePrefixes.length === 0) return new Prisma.Decimal(0);

    const orFilters = codePrefixes.map((p) => ({ accountCode: { startsWith: p } }));
    const lineSums = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        OR: orFilters,
        deletedAt: null,
        journalEntry: {
          status: 'POSTED',
          entryDate: { lte: asOfDate },
          deletedAt: null,
          ...(companyId ? { companyId } : {}),
        },
      },
      _sum: { debit: true, credit: true },
    });

    let total = new Prisma.Decimal(0);
    for (const row of lineSums) {
      const dr = new Prisma.Decimal(row._sum.debit ?? 0);
      const cr = new Prisma.Decimal(row._sum.credit ?? 0);
      const delta = normalSide === 'Cr' ? cr.sub(dr) : dr.sub(cr);
      total = total.add(delta);
    }
    return total;
  }

  /**
   * Sum the period-only debit total for accounts matching the given prefixes.
   * Used for depreciation expense (Dr 53-16XX) where we want only Dr posted in the period,
   * not the running balance.
   */
  private async sumDebitInPeriod(
    codePrefixes: string[],
    periodStart: Date,
    periodEnd: Date,
    companyId?: string,
  ): Promise<Prisma.Decimal> {
    if (codePrefixes.length === 0) return new Prisma.Decimal(0);

    const orFilters = codePrefixes.map((p) => ({ accountCode: { startsWith: p } }));
    const lineSums = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        OR: orFilters,
        deletedAt: null,
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
          ...(companyId ? { companyId } : {}),
        },
      },
      _sum: { debit: true, credit: true },
    });

    let total = new Prisma.Decimal(0);
    for (const row of lineSums) {
      const dr = new Prisma.Decimal(row._sum.debit ?? 0);
      const cr = new Prisma.Decimal(row._sum.credit ?? 0);
      // Net debit posted in period: Dr - Cr (positive for expense buildup)
      total = total.add(dr.sub(cr));
    }
    return total;
  }

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
    const startMinusOne = new Date(periodStart);
    startMinusOne.setMilliseconds(startMinusOne.getMilliseconds() - 1);

    // 1. Net Income for the period
    // P3-SP5 W1: explicit 'FINANCE' scope — Cash Flow is FINANCE-only.
    const pl = await this.getProfitLossFromJournal(periodStart, periodEnd, companyId, 'FINANCE');
    const netIncome = pl.netIncome;

    // 2. Non-cash adjustments
    // Depreciation: Dr side of 53-16XX in the period
    const depreciation = await this.sumDebitInPeriod(['53-16'], periodStart, periodEnd, companyId);
    // Bad-debt provision change: Δ balance of 11-2102 (Cr-normal contra asset)
    const allowanceOpening = await this.sumAccountBalances(['11-2102'], startMinusOne, 'Cr', companyId);
    const allowanceClosing = await this.sumAccountBalances(['11-2102'], periodEnd, 'Cr', companyId);
    const badDebtProvisionChange = allowanceClosing.sub(allowanceOpening);
    // Unearned interest change: Δ balance of 11-2106 (Cr-normal contra asset)
    const unearnedOpening = await this.sumAccountBalances(['11-2106'], startMinusOne, 'Cr', companyId);
    const unearnedClosing = await this.sumAccountBalances(['11-2106'], periodEnd, 'Cr', companyId);
    const unearnedInterestChange = unearnedClosing.sub(unearnedOpening);

    // 3. Working capital changes
    // AR (Dr-normal): 11-2101 + 11-2103. Increase consumes cash → subtract change.
    const arOpening = await this.sumAccountBalances(['11-2101', '11-2103'], startMinusOne, 'Dr', companyId);
    const arClosing = await this.sumAccountBalances(['11-2101', '11-2103'], periodEnd, 'Dr', companyId);
    const arChange = arClosing.sub(arOpening); // positive = AR grew → cash OUT
    // Inventory (Dr-normal): 11-3XXX
    const invOpening = await this.sumAccountBalances(['11-3'], startMinusOne, 'Dr', companyId);
    const invClosing = await this.sumAccountBalances(['11-3'], periodEnd, 'Dr', companyId);
    const inventoryChange = invClosing.sub(invOpening); // positive = inventory grew → cash OUT
    // AP (Cr-normal): 21-1101 + 21-1102 + 21-31XX. Increase frees cash → add change.
    const apOpening = await this.sumAccountBalances(
      ['21-1101', '21-1102', '21-31'],
      startMinusOne,
      'Cr',
      companyId,
    );
    const apClosing = await this.sumAccountBalances(
      ['21-1101', '21-1102', '21-31'],
      periodEnd,
      'Cr',
      companyId,
    );
    const apChange = apClosing.sub(apOpening); // positive = AP grew → cash IN
    // VAT payable (Cr-normal): 21-2101 + 21-2102
    const vatOpening = await this.sumAccountBalances(
      ['21-2101', '21-2102'],
      startMinusOne,
      'Cr',
      companyId,
    );
    const vatClosing = await this.sumAccountBalances(
      ['21-2101', '21-2102'],
      periodEnd,
      'Cr',
      companyId,
    );
    const vatPayableChange = vatClosing.sub(vatOpening); // positive = VAT payable grew → cash IN

    // Net Operating = NI + non-cash − ΔAR − ΔInventory + ΔAP + ΔVAT
    // (depreciation, bad-debt provision, unearned interest are non-cash → add back)
    const netOperating = netIncome
      .add(depreciation)
      .add(badDebtProvisionChange)
      .add(unearnedInterestChange)
      .sub(arChange)
      .sub(inventoryChange)
      .add(apChange)
      .add(vatPayableChange);

    // 4. Investing
    // PPE purchases (cash OUT) — sum FixedAsset.purchaseCost where status=POSTED and
    // postedAt in period. We use postedAt (the date the cost JE was posted) rather
    // than purchaseDate to align with the cash effect — purchaseDate can lag well
    // behind the actual cash settlement in an accrual system.
    //
    // SP2 KNOWN GAP — FixedAsset has no companyId column, so passing `companyId`
    // filter has no effect on this aggregate. The number reflects ALL fixed
    // assets across both SHOP+FINANCE entities. Phase A.5 will add companyId
    // scoping on FixedAsset; until then we warn the caller.
    if (companyId) {
      this.logger.warn(
        `Cash Flow getCashFlowFromJournal called with companyId=${companyId} but ` +
          `FixedAsset lacks companyId. investing.ppePurchases will reflect company-wide PPE.`,
      );
    }
    const ppePurchasesAgg = await this.prisma.fixedAsset.aggregate({
      where: {
        status: 'POSTED',
        postedAt: { gte: periodStart, lte: periodEnd },
        deletedAt: null,
      },
      _sum: { purchaseCost: true },
    });
    const ppePurchases = new Prisma.Decimal(ppePurchasesAgg._sum.purchaseCost ?? 0);

    // PPE disposals (cash IN) — proceeds aren't a column on FixedAsset; they live in
    // JE metadata under flow='asset-disposal'. We aggregate disposalProceeds from the
    // metadata of POSTED disposal JEs whose entryDate falls in the period. This is
    // the authoritative source (template asset-disposal.template.ts writes it).
    const disposalEntries = await this.prisma.journalEntry.findMany({
      where: {
        status: 'POSTED',
        entryDate: { gte: periodStart, lte: periodEnd },
        deletedAt: null,
        ...(companyId ? { companyId } : {}),
        AND: [
          { metadata: { path: ['flow'], equals: 'asset-disposal' } } as Prisma.JournalEntryWhereInput,
        ],
      },
      select: { metadata: true },
    });
    let ppeDisposals = new Prisma.Decimal(0);
    for (const e of disposalEntries) {
      const meta = e.metadata as { disposalProceeds?: string | number } | null;
      if (meta && meta.disposalProceeds != null) {
        ppeDisposals = ppeDisposals.add(new Prisma.Decimal(meta.disposalProceeds.toString()));
      }
    }
    const netInvesting = ppeDisposals.sub(ppePurchases);

    // 5. Financing
    // Capital injections (Cr-normal): Δ (31-1101 + 31-1102)
    const capitalOpening = await this.sumAccountBalances(
      ['31-1101', '31-1102'],
      startMinusOne,
      'Cr',
      companyId,
    );
    const capitalClosing = await this.sumAccountBalances(
      ['31-1101', '31-1102'],
      periodEnd,
      'Cr',
      companyId,
    );
    const capitalInjections = capitalClosing.sub(capitalOpening); // positive = cash IN

    // Dividends: Δ 32-1101 (Cr-normal). Decrease = cash OUT. We expose the raw
    // delta — UI displays positive movements as injections (rare) and negative as
    // dividends. Without year-end closing entries the line is approximate.
    const dividendOpening = await this.sumAccountBalances(['32-1101'], startMinusOne, 'Cr', companyId);
    const dividendClosing = await this.sumAccountBalances(['32-1101'], periodEnd, 'Cr', companyId);
    const dividends = dividendOpening.sub(dividendClosing); // positive = paid out

    const netFinancing = capitalInjections.sub(dividends);

    const netChange = netOperating.add(netInvesting).add(netFinancing);

    // 6. Reconciliation: compare with raw cash account movement
    const CASH_PREFIXES = ['11-11', '11-12']; // 11-1101..11-1103 + 11-1201..11-1203
    const openingCash = await this.sumAccountBalances(CASH_PREFIXES, startMinusOne, 'Dr', companyId);
    const closingCash = await this.sumAccountBalances(CASH_PREFIXES, periodEnd, 'Dr', companyId);
    const actualCashChange = closingCash.sub(openingCash);
    const drift = netChange.sub(actualCashChange);
    const isReconciled = drift.abs().lte(new Prisma.Decimal(1));

    return {
      periodStart,
      periodEnd,
      method: 'indirect' as const,
      operating: {
        netIncome: netIncome.toNumber(),
        depreciation: depreciation.toNumber(),
        badDebtProvisionChange: badDebtProvisionChange.toNumber(),
        unearnedInterestChange: unearnedInterestChange.toNumber(),
        arChange: arChange.toNumber(),
        inventoryChange: inventoryChange.toNumber(),
        apChange: apChange.toNumber(),
        vatPayableChange: vatPayableChange.toNumber(),
        netOperating: netOperating.toNumber(),
      },
      investing: {
        ppePurchases: ppePurchases.toNumber(),
        ppeDisposals: ppeDisposals.toNumber(),
        netInvesting: netInvesting.toNumber(),
      },
      financing: {
        capitalInjections: capitalInjections.toNumber(),
        dividends: dividends.toNumber(),
        netFinancing: netFinancing.toNumber(),
      },
      netChange: netChange.toNumber(),
      openingCash: openingCash.toNumber(),
      closingCash: closingCash.toNumber(),
      actualCashChange: actualCashChange.toNumber(),
      isReconciled,
      drift: drift.toNumber(),
    };
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
    const codes = EQUITY_ACCOUNTS.map((a) => a.code);
    const startMinusOne = new Date(periodStart);
    startMinusOne.setMilliseconds(startMinusOne.getMilliseconds() - 1);

    // Load CoA names (may be missing if not seeded)
    const coa = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes }, deletedAt: null },
      select: { code: true, name: true },
    });
    const nameMap = new Map(coa.map((c) => [c.code, c.name]));

    // Load all journal lines that touched these accounts in the period
    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountCode: { in: codes },
        deletedAt: null,
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
          ...(companyId ? { companyId } : {}),
        },
      },
      select: {
        accountCode: true,
        debit: true,
        credit: true,
        description: true,
        journalEntry: {
          select: { entryDate: true, entryNumber: true, description: true },
        },
      },
      orderBy: { journalEntry: { entryDate: 'asc' } },
    });

    type Movement = { entryDate: Date; entryNumber: string; description: string; amount: number };
    const rows: Array<{
      accountCode: string;
      accountName: string;
      opening: number;
      increases: Movement[];
      decreases: Movement[];
      totalIncrease: number;
      totalDecrease: number;
      closing: number;
    }> = [];

    let totalOpening = new Prisma.Decimal(0);
    let totalClosing = new Prisma.Decimal(0);

    for (const accDef of EQUITY_ACCOUNTS) {
      // Opening balance (Cr-normal): credits - debits before periodStart
      const opening = await this.sumAccountBalances([accDef.code], startMinusOne, 'Cr', companyId);

      const increases: Movement[] = [];
      const decreases: Movement[] = [];
      let increaseTotal = new Prisma.Decimal(0);
      let decreaseTotal = new Prisma.Decimal(0);

      for (const line of lines) {
        if (line.accountCode !== accDef.code) continue;
        const dr = new Prisma.Decimal(line.debit);
        const cr = new Prisma.Decimal(line.credit);
        const movement: Omit<Movement, 'amount'> = {
          entryDate: line.journalEntry.entryDate,
          entryNumber: line.journalEntry.entryNumber,
          description: line.description ?? line.journalEntry.description,
        };
        // Equity is Cr-normal: Cr = increase, Dr = decrease.
        if (cr.gt(0)) {
          const amount = cr.toNumber();
          increases.push({ ...movement, amount });
          increaseTotal = increaseTotal.add(cr);
        }
        if (dr.gt(0)) {
          const amount = dr.toNumber();
          decreases.push({ ...movement, amount });
          decreaseTotal = decreaseTotal.add(dr);
        }
      }

      const closing = opening.add(increaseTotal).sub(decreaseTotal);

      rows.push({
        accountCode: accDef.code,
        accountName: nameMap.get(accDef.code) ?? accDef.defaultName,
        opening: opening.toNumber(),
        increases,
        decreases,
        totalIncrease: increaseTotal.toNumber(),
        totalDecrease: decreaseTotal.toNumber(),
        closing: closing.toNumber(),
      });

      totalOpening = totalOpening.add(opening);
      totalClosing = totalClosing.add(closing);
    }

    // Derive current-year P&L (yearStart .. periodEnd) for the caveat line.
    // This represents the implicit profit not yet closed into 33-1101.
    const yearStart = new Date(periodEnd.getFullYear(), 0, 1);
    // P3-SP5 W1: explicit 'FINANCE' scope — Equity Statement is FINANCE-only.
    const yearPL = await this.getProfitLossFromJournal(yearStart, periodEnd, companyId, 'FINANCE');
    const currentYearProfit = yearPL.netIncome.toNumber();

    return {
      periodStart,
      periodEnd,
      rows,
      currentYearProfit,
      caveat:
        'ค่าประมาณกำไรปีปัจจุบัน — ยังไม่ปิดบัญชีจริงเข้า 33-1101 / 32-1101 (รอปิดบัญชีสิ้นปี)',
      totalOpening: totalOpening.toNumber(),
      totalClosing: totalClosing.toNumber(),
    };
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
    const account = await this.prisma.chartOfAccount.findFirst({
      where: { code: accountCode, deletedAt: null },
      select: { code: true, name: true, normalBalance: true },
    });
    if (!account) {
      throw new NotFoundException(`ไม่พบรหัสบัญชี ${accountCode} ในผังบัญชี`);
    }

    const normalBalance = account.normalBalance as 'Dr' | 'Cr' | 'Dr/Cr';
    const startMinusOne = new Date(periodStart);
    startMinusOne.setMilliseconds(startMinusOne.getMilliseconds() - 1);

    // Opening balance (everything before periodStart)
    const opening = await this.sumAccountBalances(
      [accountCode],
      startMinusOne,
      normalBalance === 'Cr' ? 'Cr' : 'Dr',
      companyId,
    );

    // All journal lines in the period
    const rawLines = await this.prisma.journalLine.findMany({
      where: {
        accountCode,
        deletedAt: null,
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
          ...(companyId ? { companyId } : {}),
        },
      },
      select: {
        debit: true,
        credit: true,
        description: true,
        journalEntry: {
          select: {
            entryDate: true,
            entryNumber: true,
            description: true,
            referenceType: true,
            referenceId: true,
          },
        },
      },
      orderBy: [{ journalEntry: { entryDate: 'asc' } }, { journalEntry: { entryNumber: 'asc' } }],
    });

    let running = new Prisma.Decimal(opening);
    let totalDebit = new Prisma.Decimal(0);
    let totalCredit = new Prisma.Decimal(0);

    const lines = rawLines.map((line) => {
      const dr = new Prisma.Decimal(line.debit);
      const cr = new Prisma.Decimal(line.credit);
      // Running balance on normal side
      const delta = normalBalance === 'Cr' ? cr.sub(dr) : dr.sub(cr);
      running = running.add(delta);
      totalDebit = totalDebit.add(dr);
      totalCredit = totalCredit.add(cr);

      return {
        entryDate: line.journalEntry.entryDate,
        entryNumber: line.journalEntry.entryNumber,
        description: line.description ?? line.journalEntry.description,
        referenceType: line.journalEntry.referenceType,
        referenceId: line.journalEntry.referenceId,
        debit: dr.toNumber(),
        credit: cr.toNumber(),
        runningBalance: running.toNumber(),
      };
    });

    return {
      accountCode: account.code,
      accountName: account.name,
      normalBalance,
      periodStart,
      periodEnd,
      opening: opening.toNumber(),
      closing: running.toNumber(),
      totalDebit: totalDebit.toNumber(),
      totalCredit: totalCredit.toNumber(),
      lines,
    };
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
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 50;
    const where = {
      postedAt: { gte: periodStart, lte: periodEnd },
      deletedAt: null,
      ...(opts.companyId ? { companyId: opts.companyId } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: {
          lines: {
            select: {
              accountCode: true,
              debit: true,
              credit: true,
              description: true,
            },
            orderBy: { id: 'asc' },
          },
        },
        orderBy: { postedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);
    return { data, total, page, limit };
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
