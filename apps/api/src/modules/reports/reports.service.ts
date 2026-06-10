import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { ReceivablesReportService } from './services/receivables-report.service';
import { RevenueReportService } from './services/revenue-report.service';
import { OperationalReportService } from './services/operational-report.service';

@Injectable()
export class ReportsService {
  // Internally-constructed sub-services (NOT DI providers) — keeps the 2-arg ctor
  // so all 14 spec construction sites + the module + consumers stay untouched.
  // Each sub-service holds the moved-verbatim report-method bodies.
  private readonly receivables: ReceivablesReportService;
  private readonly revenue: RevenueReportService;
  private readonly operational: OperationalReportService;

  constructor(
    private prisma: PrismaService,
    private accounting: AccountingService,
  ) {
    this.receivables = new ReceivablesReportService(this.prisma);
    this.revenue = new RevenueReportService(this.prisma);
    this.operational = new OperationalReportService(this.prisma);
  }

  /**
   * Resolve companyId + branchId → effective branch ID list for report filtering.
   * Returns:
   * - [branchId]   — specific branch requested
   * - string[]     — all branches under the given company (SHOP multi-branch)
   * - []           — company exists but has no branches (FINANCE) → callers should return empty data
   * - undefined    — no filter at all (all branches across all companies)
   */
  async resolveCompanyBranches(companyId?: string, branchId?: string): Promise<string[] | undefined> {
    if (branchId) return [branchId]; // specific branch requested
    if (!companyId) return undefined; // no filter = all branches
    const branches = await this.prisma.branch.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true },
    });
    // FINANCE has no branches → empty array signals "no data for this company"
    return branches.map((b) => b.id);
  }

  /**
   * Aging Report: group receivables by age buckets (1-30, 31-60, 61-90, 90+)
   */
  getAgingReport(branchId?: string) {
    return this.receivables.getAgingReport(branchId);
  }

  /**
   * Revenue / Profit-Loss Report
   */
  getRevenuePLReport(startDate: string, endDate: string, branchId?: string) {
    return this.revenue.getRevenuePLReport(startDate, endDate, branchId);
  }

  // P&L calculation delegated to AccountingService
  getProfitLossReport(
    startDate: string,
    endDate: string,
    branchId?: string,
    branchIds?: string[],
    includeFinanceExpenses = false,
  ) {
    return this.accounting.getProfitLossReport(startDate, endDate, branchId, branchIds, includeFinanceExpenses);
  }

  getMonthlyPLSummary(
    year: number,
    branchId?: string,
    branchIds?: string[],
    includeFinanceExpenses = false,
  ) {
    return this.accounting.getMonthlyPLSummary(year, branchId, branchIds, includeFinanceExpenses);
  }

  /**
   * Whether a /reports P&L view should include the central FINANCE 51-54 expenses.
   * The caller has the full context the report method lacks. FINANCE expenses are
   * whole-business central costs — they belong only in a FINANCE or whole-business
   * P&L, never on an isolated branch or a SHOP-company view (SHOP P&L = separate work).
   */
  async shouldIncludeFinanceExpenses(
    role: string,
    branchId?: string,
    companyId?: string,
  ): Promise<boolean> {
    if (role === 'BRANCH_MANAGER') return false; // restricted to a single branch
    if (branchId) return false; // a specific branch is isolated
    if (!companyId) return true; // whole-business view
    const company = await this.prisma.companyInfo.findUnique({
      where: { id: companyId },
      select: { companyCode: true },
    });
    return company?.companyCode === 'FINANCE';
  }

  getComparativePL(
    year: number,
    month: number,
    branchId?: string,
    branchIds?: string[],
    includeFinanceExpenses = false,
  ) {
    return this.accounting.getComparativePL(year, month, branchId, branchIds, includeFinanceExpenses);
  }

  // Balance Sheet & Cash Flow delegated to AccountingService
  getBalanceSheet(asOfDate: string, branchId?: string, branchIds?: string[]) {
    return this.accounting.getBalanceSheet(asOfDate, branchId, branchIds);
  }

  getCashFlowStatement(startDate: string, endDate: string, branchId?: string, branchIds?: string[]) {
    return this.accounting.getCashFlowStatement(startDate, endDate, branchId, branchIds);
  }

  /**
   * High-risk customers report
   */
  getHighRiskCustomers(branchId?: string, page = 1, limit = 50) {
    return this.receivables.getHighRiskCustomers(branchId, page, limit);
  }

  /**
   * Sales comparison by staff
   */
  getSalesComparisonReport(startDate: string, endDate: string, branchId?: string, page = 1, limit = 50) {
    return this.revenue.getSalesComparisonReport(startDate, endDate, branchId, page, limit);
  }

  /**
   * Branch comparison report
   */
  getBranchComparisonReport(startDate: string, endDate: string) {
    return this.operational.getBranchComparisonReport(startDate, endDate);
  }

  /**
   * Daily payment summary
   */
  getDailyPaymentSummary(date: string, branchId?: string, page = 1, limit = 50) {
    return this.revenue.getDailyPaymentSummary(date, branchId, page, limit);
  }

  /**
   * Stock report
   */
  getStockReport(branchId?: string) {
    return this.operational.getStockReport(branchId);
  }

  /**
   * Export data as CSV-ready format
   */
  exportContracts(filters: { status?: string; branchId?: string; startDate?: string; endDate?: string }) {
    return this.operational.exportContracts(filters);
  }

  /**
   * Entity Profit Report: BESTCHOICE SHOP vs BESTCHOICE FINANCE
   * Uses InterCompanyTransaction data to calculate profit per entity.
   */
  getEntityProfitReport(startDate: string, endDate: string, branchId?: string, entity?: string) {
    return this.revenue.getEntityProfitReport(startDate, endDate, branchId, entity);
  }

  /**
   * FINANCE Portfolio: all contracts owned by BESTCHOICE FINANCE
   * Returns per-contract receivable calculations + portfolio summary + aging.
   */
  getFinancePortfolio(
    status?: string,
    page = 1,
    limit = 50,
    startDate?: string,
    endDate?: string,
  ) {
    return this.receivables.getFinancePortfolio(status, page, limit, startDate, endDate);
  }

  /**
   * R-015: Quarterly P&L report aggregation
   * Calculates start/end dates for the given quarter and delegates to AccountingService.
   */
  async getQuarterlyReport(
    year: number,
    quarter: number,
    branchId?: string,
    branchIds?: string[],
    includeFinanceExpenses = false,
  ) {
    if (quarter < 1 || quarter > 4) {
      throw new BadRequestException('ไตรมาสต้องอยู่ระหว่าง 1-4');
    }
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    const endDate = new Date(year, endMonth, 0).toISOString().split('T')[0];
    return this.accounting.getProfitLossReport(startDate, endDate, branchId, branchIds, includeFinanceExpenses);
  }
}
