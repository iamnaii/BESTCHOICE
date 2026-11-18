import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  Request,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AccountingService } from './accounting.service';
import { BadDebtService } from './bad-debt.service';
import { MonthlyCloseService } from './monthly-close.service';
import { IntercompanyReportService } from './intercompany-report.service';
import { CloseMonthDto } from './dto/monthly-close.dto';
import { ReopenPeriodDto } from './dto/reopen-period.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { bangkokDateRange, reportAsOf, reportDayEnd, reportDayStart } from '../../utils/date.util';

/**
 * Legacy expenses CRUD endpoints have been removed (Phase: expense-documents PR-1).
 * Replaced by the new ExpenseDocument module — see modules/expense-documents/.
 *
 * This controller now exposes only the financial-reporting + period-close + bad-debt
 * + monthly-close endpoints that were historically grouped under /expenses for legacy
 * routing reasons. They retain the /expenses prefix to avoid breaking existing clients.
 */
@ApiTags('Accounting')
@ApiBearerAuth('JWT')
@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class AccountingController {
  constructor(
    private service: AccountingService,
    private badDebtService: BadDebtService,
    private monthlyCloseService: MonthlyCloseService,
    private intercoReportService: IntercompanyReportService,
  ) {}

  // ============================================================
  // T17: Journal-line-based financial reports (CPA chart)
  // ============================================================

  @Get('ledger/trial-balance')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getTrialBalance(
    @Query('asOfDate') asOfDate?: string,
    @Query('scope') scope?: 'FINANCE' | 'SHOP' | 'ALL',
    @Query('periodStart') periodStart?: string,
    @Query('periodEnd') periodEnd?: string,
  ) {
    // มี periodStart = งบทดลองแบบช่วงเวลา (ยอดยกมา / ระหว่างงวด / ยอดคงเหลือ) · ไม่มี = งบ ณ วันที่ ตามเดิม
    if (periodStart) {
      if (!periodEnd) throw new BadRequestException('กรุณาระบุวันสิ้นสุด');
      // พารามิเตอร์ใหม่ — รับเฉพาะ YYYY-MM-DD (รูปแบบผิด/วันไม่มีจริง/วันเริ่มหลังวันสิ้นสุด = 400)
      const { gte, lt } = bangkokDateRange(periodStart, periodEnd);
      return this.service.getPeriodTrialBalance(gte!, new Date(lt!.getTime() - 1), scope ?? 'FINANCE');
    }
    return this.service.getTrialBalance(
      asOfDate ? reportAsOf(asOfDate) : undefined,
      scope ?? 'FINANCE',
    );
  }

  @Get('ledger/profit-loss')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getProfitLossFromJournal(
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
    @Query('scope') scope?: 'FINANCE' | 'SHOP' | 'ALL',
  ) {
    const start = reportDayStart(periodStart);
    const end = reportDayEnd(periodEnd);
    return this.service.getProfitLossFromJournal(start, end, undefined, scope ?? 'FINANCE');
  }

  // ============================================================
  // P3-SP5: SHOP-side reports (separate paths for sidebar UX)
  // ============================================================
  //
  // POLICY (P3-SP5 W5): SHOP reports are cross-branch by design — these
  // endpoints aggregate SHOP-side journal lines across ALL branches into
  // ONE Trial Balance / P&L. BRANCH_MANAGER is NOT in CROSS_BRANCH_ROLES
  // (see apps/api/src/modules/auth/branch-access.util.ts), so adding BM to
  // @Roles here would actually 403 at BranchGuard. Roles intentionally
  // limited to the cross-branch set: OWNER, FINANCE_MANAGER, ACCOUNTANT.
  //
  // If owner ever wants branch-scoped SHOP P&L for BM, add a `?branchId=`
  // query and filter inside the service — do NOT just widen @Roles, the
  // global guard will block it anyway.

  @Get('ledger/shop/trial-balance')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getShopTrialBalance(@Query('asOfDate') asOfDate?: string) {
    return this.service.getTrialBalance(asOfDate ? reportAsOf(asOfDate) : undefined, 'SHOP');
  }

  @Get('ledger/shop/profit-loss')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getShopProfitLoss(
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
  ) {
    const start = reportDayStart(periodStart);
    const end = reportDayEnd(periodEnd);
    return this.service.getProfitLossFromJournal(start, end, undefined, 'SHOP');
  }

  @Get('ledger/balance-sheet')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getBalanceSheetFromJournal(@Query('asOfDate') asOfDate?: string) {
    return this.service.getBalanceSheetFromJournal(asOfDate ? reportAsOf(asOfDate) : undefined);
  }

  // ─── P4-SP1: Aging Report ────────────────────────────────────────────────

  @Get('ledger/aging')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getAgingReport(@Query('asOf') asOf?: string) {
    // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
    return this.service.getAgingReport(asOf ? reportAsOf(asOf) : new Date());
  }

  // ─── P4-SP1: Bad Debt Report ──────────────────────────────────────────────

  @Get('ledger/bad-debt')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getBadDebtReport(
    @Query('start') start: string,
    @Query('end') end: string,
    @Query('companyId') companyId?: string,
  ) {
    if (!start || !end) {
      throw new BadRequestException('กรุณาระบุวันเริ่มต้น (start) และวันสิ้นสุด (end)');
    }
    // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
    return this.service.getBadDebtReport(reportDayStart(start), reportAsOf(end), companyId);
  }

  // Balance Sheet & Cash Flow endpoints are in ReportsController (/reports/balance-sheet, /reports/cash-flow)
  // to avoid duplicate routes. See reports.controller.ts.

  // ============================================================
  // SP2: Cash Flow Indirect / Equity Statement / General Ledger
  // ============================================================

  @Get('ledger/cash-flow')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getCashFlowFromJournal(
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
    @Query('companyId') companyId?: string,
  ) {
    const start = reportDayStart(periodStart);
    const end = reportDayEnd(periodEnd);
    return this.service.getCashFlowFromJournal(start, end, companyId);
  }

  @Get('ledger/equity-statement')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getEquityStatementFromJournal(
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
    @Query('companyId') companyId?: string,
  ) {
    const start = reportDayStart(periodStart);
    const end = reportDayEnd(periodEnd);
    return this.service.getEquityStatementFromJournal(start, end, companyId);
  }

  // ============================================================
  // P3-SP3: PEAK CSV export
  // ============================================================

  /**
   * Stream a CSV of journal lines (within the date range) tagged with their
   * mapped PEAK code. Counts come back as response headers (all CORS-exposed):
   *   - `X-Row-Count` — rows in the file
   *   - `X-Skipped-Lines` — lines whose account has no PEAK mapping (skipped)
   *   - `X-Unresolved-Sub-Codes` — contact lines whose party has no PEAK contact code
   *   - `X-Excluded-Legacy-Entries` — legacy opening / prior-receipt entries left out
   *   - `X-Excluded-Legacy-Interest-Lines` — 11-2106 / 41-1101 lines of legacy contracts left out
   *   - `X-Legacy-Unbalanced-Entries` — entries the interest drop left unbalanced (known gap)
   */
  @Get('journal/export-peak')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  async exportJournalPeak(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!startDate || !endDate) {
      throw new BadRequestException('กรุณาระบุช่วงวันที่');
    }
    // Bangkok calendar days (คู่มือคืนตัด 5.3 D7): 00:00 Bangkok of startDate .. 23:59:59.999 Bangkok of endDate,
    // independent of the process TZ. `new Date('YYYY-MM-DD')` is UTC midnight (07:00 Bangkok) — adjacent files used
    // to miss every entry posted 00:00–06:59 Bangkok (the nightly 2A / allowance / catch-up VAT entries).
    // The service filters with `lte`, so pass the last millisecond before the exclusive bound (DateTime is ms precision).
    const { gte: start, lt: endExclusive } = bangkokDateRange(startDate, endDate);
    if (!start || !endExclusive) {
      // unreachable — both dates were checked non-empty above; narrows the optional return type
      throw new BadRequestException('กรุณาระบุช่วงวันที่');
    }
    const end = new Date(endExclusive.getTime() - 1);

    const result = await this.service.exportJournalWithPeakCodes(start, end);
    const filename = `peak-journal-${startDate}_${endDate}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Skipped-Lines', String(result.skippedLineCount));
    res.setHeader('X-Row-Count', String(result.rowCount));
    // mapping v5: contact-source lines whose party has no PEAK contact code yet
    res.setHeader('X-Unresolved-Sub-Codes', String(result.unresolvedSubCodeCount));
    // legacy backoffice import (spec ร่าง 5): opening / prior-receipt entries and the
    // 11-2106 / 41-1101 lines of legacy contracts left out of the file on purpose
    res.setHeader('X-Excluded-Legacy-Entries', String(result.excludedEntryCount));
    res.setHeader(
      'X-Excluded-Legacy-Interest-Lines',
      String(result.excludedLegacyInterestLineCount),
    );
    // known gap (exchange close-old of a legacy contract) — awaiting the accounting firm
    res.setHeader('X-Legacy-Unbalanced-Entries', String(result.legacyUnbalancedEntryCount));
    // Expose custom headers so the browser fetch() sees them through CORS.
    res.setHeader(
      'Access-Control-Expose-Headers',
      'X-Skipped-Lines, X-Row-Count, X-Unresolved-Sub-Codes, X-Excluded-Legacy-Entries, X-Excluded-Legacy-Interest-Lines, X-Legacy-Unbalanced-Entries',
    );
    res.end(result.csv);
  }

  @Get('ledger/general-journal')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getGeneralJournal(
    @Query('start') start: string,
    @Query('end') end: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('companyId') companyId?: string,
  ) {
    if (!start || !end) {
      throw new BadRequestException('กรุณาระบุวันเริ่มต้น (start) และวันสิ้นสุด (end)');
    }
    // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
    return this.service.getGeneralJournal(reportDayStart(start), reportAsOf(end), {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      companyId,
    });
  }

  @Get('ledger/general-ledger')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getGeneralLedger(
    @Query('accountCode') accountCode: string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
    @Query('companyId') companyId?: string,
  ) {
    const start = reportDayStart(periodStart);
    const end = reportDayEnd(periodEnd);
    return this.service.getGeneralLedger(accountCode, start, end, companyId);
  }

  // ============================================================
  // Bad Debt Provisioning (ค่าเผื่อหนี้สงสัยจะสูญ)
  // ============================================================

  @Post('bad-debt/calculate')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  calculateProvisions(
    @Request() req: { user: { id: string } },
    @Query('branchId') branchId?: string,
  ) {
    return this.badDebtService.calculateProvisions(req.user.id, branchId);
  }

  @Get('bad-debt/summary')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getProvisionSummary() {
    return this.badDebtService.getProvisionSummary();
  }

  @Post('bad-debt/write-off/:contractId')
  @Roles('OWNER')
  writeOffBadDebt(
    @Param('contractId') contractId: string,
    @Body() body: { approvedById: string; notes?: string },
    @Request() req: { user: { id: string } },
  ) {
    return this.badDebtService.writeOffBadDebt(
      contractId,
      req.user.id,
      body.approvedById,
      body.notes,
    );
  }

  // ============================================================
  // Monthly Close Workflow
  // ============================================================

  @Get('periods/overview')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getPeriodsOverview(
    @Query('companyId') companyId: string,
    @Query('year') year: string,
  ) {
    return this.monthlyCloseService.getPeriodsOverview(companyId, parseInt(year));
  }

  @Get('periods/reopened')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getReopenedPeriods() {
    return this.monthlyCloseService.listReopenedPeriods();
  }

  @Get('periods/:companyId/:year/:month')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getMonthlyPeriodStatus(
    @Param('companyId') companyId: string,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    return this.monthlyCloseService.getPeriodStatus(companyId, parseInt(year), parseInt(month));
  }

  @Post('periods/start-review')
  @Roles('OWNER', 'FINANCE_MANAGER')
  startReview(
    @Body() dto: CloseMonthDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.monthlyCloseService.startReview(dto.companyId, dto.year, dto.month, req.user.id);
  }

  @Post('periods/close')
  @Roles('OWNER', 'FINANCE_MANAGER')
  closeMonthlyPeriod(
    @Body() dto: CloseMonthDto,
    @Request() req: { user: { id: string; role: string } },
  ) {
    return this.monthlyCloseService.closePeriod(
      dto.companyId,
      dto.year,
      dto.month,
      req.user.id,
      dto.notes,
      dto.forceCloseReason,
      req.user.role,
    );
  }

  @Post('periods/sync-peak')
  @Roles('OWNER', 'ACCOUNTANT')
  syncToPeak(@Body() dto: CloseMonthDto) {
    return this.monthlyCloseService.syncToPeak(dto.companyId, dto.year, dto.month);
  }

  @Post('periods/reopen')
  @Roles('OWNER')
  reopenPeriod(
    @Body() dto: ReopenPeriodDto,
    @Request() req: { user: { id: string }; ip?: string },
  ) {
    return this.monthlyCloseService.reopenPeriod(dto, req.user.id, req.ip);
  }

  // ============================================================
  // P4-SP4: Inter-Company Report — FINANCE↔SHOP payables (21-1101, 21-1102)
  // ============================================================

  @Get('inter-co/report')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  getInterCoReport(
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    if (!start || !end) {
      throw new BadRequestException('กรุณาระบุ start และ end (ISO date string)');
    }
    // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
    return this.intercoReportService.getReport(reportDayStart(start), reportAsOf(end));
  }
}
