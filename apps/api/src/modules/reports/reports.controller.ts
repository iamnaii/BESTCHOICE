import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Reports')
@ApiBearerAuth('JWT')
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('aging')
  getAging(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = user.role === 'BRANCH_MANAGER' ? user.branchId || undefined : branchId;
    return this.reportsService.getAgingReport(effectiveBranch);
  }

  @Get('revenue-pl')
  getRevenuePL(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = user.role === 'BRANCH_MANAGER' ? user.branchId || undefined : branchId;
    return this.reportsService.getRevenuePLReport(startDate, endDate, effectiveBranch);
  }

  @Get('monthly-pl')
  async getMonthlyPL(
    @Query('year') year: string,
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
    @Query('companyId') companyId?: string,
  ) {
    if (user.role === 'BRANCH_MANAGER') {
      const effectiveBranch = user.branchId || undefined;
      return this.reportsService.getMonthlyPLSummary(parseInt(year) || new Date().getFullYear(), effectiveBranch);
    }
    const resolvedBranchIds = await this.reportsService.resolveCompanyBranches(companyId, branchId);
    return this.reportsService.getMonthlyPLSummary(
      parseInt(year) || new Date().getFullYear(),
      undefined,
      resolvedBranchIds,
    );
  }

  @Get('profit-loss')
  async getProfitLoss(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
    @Query('companyId') companyId?: string,
  ) {
    if (user.role === 'BRANCH_MANAGER') {
      const effectiveBranch = user.branchId || undefined;
      return this.reportsService.getProfitLossReport(startDate, endDate, effectiveBranch);
    }
    const resolvedBranchIds = await this.reportsService.resolveCompanyBranches(companyId, branchId);
    return this.reportsService.getProfitLossReport(startDate, endDate, undefined, resolvedBranchIds);
  }

  @Get('comparative-pl')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getComparativePL(
    @Query('year') year: string,
    @Query('month') month: string,
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = user.role === 'BRANCH_MANAGER' ? user.branchId || undefined : branchId;
    return this.reportsService.getComparativePL(
      parseInt(year) || new Date().getFullYear(),
      parseInt(month) || new Date().getMonth() + 1,
      effectiveBranch,
    );
  }

  @Get('balance-sheet')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async getBalanceSheet(
    @Query('asOfDate') asOfDate?: string,
    @Query('branchId') branchId?: string,
    @Query('companyId') companyId?: string,
  ) {
    const resolvedBranchIds = await this.reportsService.resolveCompanyBranches(companyId, branchId);
    return this.reportsService.getBalanceSheet(
      asOfDate || new Date().toISOString().split('T')[0],
      undefined,
      resolvedBranchIds,
    );
  }

  @Get('cash-flow')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getCashFlowStatement(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = user.role === 'BRANCH_MANAGER' ? user.branchId || undefined : branchId;
    return this.reportsService.getCashFlowStatement(startDate, endDate, effectiveBranch);
  }

  @Get('high-risk')
  getHighRisk(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const effectiveBranch = user.role === 'BRANCH_MANAGER' ? user.branchId || undefined : branchId;
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : undefined;
    return this.reportsService.getHighRiskCustomers(
      effectiveBranch,
      parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    );
  }

  @Get('sales-comparison')
  getSalesComparison(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const effectiveBranch = user.role === 'BRANCH_MANAGER' ? user.branchId || undefined : branchId;
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : undefined;
    return this.reportsService.getSalesComparisonReport(
      startDate,
      endDate,
      effectiveBranch,
      parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    );
  }

  @Get('branch-comparison')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getBranchComparison(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.reportsService.getBranchComparisonReport(startDate, endDate);
  }

  @Get('daily-payments')
  getDailyPayments(
    @Query('date') date: string,
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const effectiveBranch = user.role === 'BRANCH_MANAGER' ? user.branchId || undefined : branchId;
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : undefined;
    return this.reportsService.getDailyPaymentSummary(
      date,
      effectiveBranch,
      parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    );
  }

  @Get('stock')
  getStock(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = user.role === 'BRANCH_MANAGER' ? user.branchId || undefined : branchId;
    return this.reportsService.getStockReport(effectiveBranch);
  }

  @Get('entity-profit')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async getEntityProfit(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('branchId') branchId?: string,
    @Query('entity') entity?: string,
    @Query('companyId') companyId?: string,
  ) {
    // entity-profit uses a single branchId filter on InterCompanyTransaction — resolve to first branch
    // when company is given without a specific branch (multi-branch aggregation is done within the method)
    const resolvedBranchIds = await this.reportsService.resolveCompanyBranches(companyId, branchId);
    const effectiveBranch = resolvedBranchIds && resolvedBranchIds.length === 1
      ? resolvedBranchIds[0]
      : undefined;
    return this.reportsService.getEntityProfitReport(startDate, endDate, effectiveBranch, entity);
  }

  @Get('quarterly')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER')
  getQuarterly(
    @Query('year') year: string,
    @Query('quarter') quarter: string,
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = user.role === 'BRANCH_MANAGER' ? user.branchId || undefined : branchId;
    return this.reportsService.getQuarterlyReport(
      parseInt(year) || new Date().getFullYear(),
      parseInt(quarter) || 1,
      effectiveBranch,
    );
  }

  @Get('finance-portfolio')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getFinancePortfolio(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 100) : undefined;
    return this.reportsService.getFinancePortfolio(
      status,
      parsedPage && !isNaN(parsedPage) ? parsedPage : 1,
      parsedLimit && !isNaN(parsedLimit) ? parsedLimit : 50,
    );
  }

  @Get('export/contracts')
  exportContracts(
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.exportContracts({ status, branchId, startDate, endDate });
  }
}
