import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('kpis')
  getKPIs(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = this.getEffectiveBranch(branchId, user);
    return this.dashboardService.getKPIs(effectiveBranch);
  }

  @Get('monthly-trend')
  getMonthlyTrend(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = this.getEffectiveBranch(branchId, user);
    return this.dashboardService.getMonthlyTrend(effectiveBranch);
  }

  @Get('top-overdue')
  getTopOverdue(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = this.getEffectiveBranch(branchId, user);
    return this.dashboardService.getTopOverdue(effectiveBranch);
  }

  @Get('status-distribution')
  getStatusDistribution(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = this.getEffectiveBranch(branchId, user);
    return this.dashboardService.getStatusDistribution(effectiveBranch);
  }

  @Get('branch-comparison')
  @Roles('OWNER', 'ACCOUNTANT')
  getBranchComparison() {
    return this.dashboardService.getBranchComparison();
  }

  @Get('analytics/branches')
  @Roles('OWNER')
  getBranchAnalytics(@Query('period') period?: string) {
    return this.dashboardService.getBranchAnalytics(period || '1m');
  }

  @Get('monthly-revenue')
  getMonthlyRevenue(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = this.getEffectiveBranch(branchId, user);
    return this.dashboardService.getMonthlyRevenue(effectiveBranch);
  }

  @Get('aging-summary')
  getAgingSummary(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = this.getEffectiveBranch(branchId, user);
    return this.dashboardService.getAgingSummary(effectiveBranch);
  }

  @Get('staff-performance')
  getStaffPerformance(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const effectiveBranch = this.getEffectiveBranch(branchId, user);
    return this.dashboardService.getStaffPerformance(effectiveBranch, startDate, endDate);
  }

  private getEffectiveBranch(
    branchId: string | undefined,
    user: { role: string; branchId: string | null },
  ): string | undefined {
    return user.role === 'SALES' || user.role === 'BRANCH_MANAGER'
      ? user.branchId || undefined
      : branchId || undefined;
  }
}
