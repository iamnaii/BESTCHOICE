import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AccountingService } from './accounting.service';
import { BadDebtService } from './bad-debt.service';
import { MonthlyCloseService } from './monthly-close.service';
import { CloseMonthDto } from './dto/monthly-close.dto';
import { ReopenPeriodDto } from './dto/reopen-period.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';

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
  ) {}

  // ============================================================
  // T17: Journal-line-based financial reports (CPA chart)
  // ============================================================

  @Get('ledger/trial-balance')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getTrialBalance(@Query('asOfDate') asOfDate?: string) {
    return this.service.getTrialBalance(asOfDate ? new Date(asOfDate) : undefined);
  }

  @Get('ledger/profit-loss')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getProfitLossFromJournal(
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
  ) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    end.setHours(23, 59, 59, 999);
    return this.service.getProfitLossFromJournal(start, end);
  }

  @Get('ledger/balance-sheet')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getBalanceSheetFromJournal(@Query('asOfDate') asOfDate?: string) {
    return this.service.getBalanceSheetFromJournal(asOfDate ? new Date(asOfDate) : undefined);
  }

  // Balance Sheet & Cash Flow endpoints are in ReportsController (/reports/balance-sheet, /reports/cash-flow)
  // to avoid duplicate routes. See reports.controller.ts.

  // ============================================================
  // SP2: Cash Flow Indirect / Equity Statement / General Ledger
  // ============================================================

  @Get('ledger/cash-flow')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getCashFlowFromJournal(
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
    @Query('companyId') companyId?: string,
  ) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    end.setHours(23, 59, 59, 999);
    return this.service.getCashFlowFromJournal(start, end, companyId);
  }

  @Get('ledger/equity-statement')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getEquityStatementFromJournal(
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
    @Query('companyId') companyId?: string,
  ) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    end.setHours(23, 59, 59, 999);
    return this.service.getEquityStatementFromJournal(start, end, companyId);
  }

  @Get('ledger/general-ledger')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getGeneralLedger(
    @Query('accountCode') accountCode: string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
    @Query('companyId') companyId?: string,
  ) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    end.setHours(23, 59, 59, 999);
    return this.service.getGeneralLedger(accountCode, start, end, companyId);
  }

  // ============================================================
  // W-013: Period Closing Lock
  // ============================================================

  @Get('period-status')
  @Roles('OWNER')
  getPeriodStatus() {
    return this.service.getAccountingPeriodStatus();
  }

  @Post('close-period')
  @Roles('OWNER')
  closePeriod(@Body('closedUntil') closedUntil: string) {
    return this.service.closeAccountingPeriod(closedUntil);
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
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
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
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getPeriodsOverview(
    @Query('companyId') companyId: string,
    @Query('year') year: string,
  ) {
    return this.monthlyCloseService.getPeriodsOverview(companyId, parseInt(year));
  }

  @Get('periods/reopened')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getReopenedPeriods() {
    return this.monthlyCloseService.listReopenedPeriods();
  }

  @Get('periods/:companyId/:year/:month')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
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
}
