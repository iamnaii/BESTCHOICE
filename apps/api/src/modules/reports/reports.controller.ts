import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

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

  @Get('high-risk')
  getHighRisk(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = user.role === 'BRANCH_MANAGER' ? user.branchId || undefined : branchId;
    return this.reportsService.getHighRiskCustomers(effectiveBranch);
  }

  @Get('sales-comparison')
  getSalesComparison(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = user.role === 'BRANCH_MANAGER' ? user.branchId || undefined : branchId;
    return this.reportsService.getSalesComparisonReport(startDate, endDate, effectiveBranch);
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
  ) {
    const effectiveBranch = user.role === 'BRANCH_MANAGER' ? user.branchId || undefined : branchId;
    return this.reportsService.getDailyPaymentSummary(date, effectiveBranch);
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
