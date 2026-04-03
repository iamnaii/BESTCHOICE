import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Reports')
@ApiBearerAuth('JWT')
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
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
  getMonthlyPL(
    @Query('year') year: string,
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = user.role === 'BRANCH_MANAGER' ? user.branchId || undefined : branchId;
    return this.reportsService.getMonthlyPLSummary(parseInt(year) || new Date().getFullYear(), effectiveBranch);
  }

  @Get('profit-loss')
  getProfitLoss(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = user.role === 'BRANCH_MANAGER' ? user.branchId || undefined : branchId;
    return this.reportsService.getProfitLossReport(startDate, endDate, effectiveBranch);
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
  @Roles('OWNER', 'ACCOUNTANT')
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
