import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('kpis')
  getKPIs(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch =
      user.role === 'SALES' || user.role === 'BRANCH_MANAGER'
        ? user.branchId || undefined
        : branchId || undefined;
    return this.dashboardService.getKPIs(effectiveBranch);
  }

  @Get('monthly-trend')
  getMonthlyTrend(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch =
      user.role === 'SALES' || user.role === 'BRANCH_MANAGER'
        ? user.branchId || undefined
        : branchId || undefined;
    return this.dashboardService.getMonthlyTrend(effectiveBranch);
  }

  @Get('top-overdue')
  getTopOverdue(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch =
      user.role === 'SALES' || user.role === 'BRANCH_MANAGER'
        ? user.branchId || undefined
        : branchId || undefined;
    return this.dashboardService.getTopOverdue(effectiveBranch);
  }

  @Get('status-distribution')
  getStatusDistribution(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch =
      user.role === 'SALES' || user.role === 'BRANCH_MANAGER'
        ? user.branchId || undefined
        : branchId || undefined;
    return this.dashboardService.getStatusDistribution(effectiveBranch);
  }

  @Get('branch-comparison')
  getBranchComparison() {
    return this.dashboardService.getBranchComparison();
  }

  @Get('monthly-revenue')
  getMonthlyRevenue(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch =
      user.role === 'SALES' || user.role === 'BRANCH_MANAGER'
        ? user.branchId || undefined
        : branchId || undefined;
    return this.dashboardService.getMonthlyRevenue(effectiveBranch);
  }

  @Get('aging-summary')
  getAgingSummary(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch =
      user.role === 'SALES' || user.role === 'BRANCH_MANAGER'
        ? user.branchId || undefined
        : branchId || undefined;
    return this.dashboardService.getAgingSummary(effectiveBranch);
  }

  @Get('staff-performance')
  getStaffPerformance(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch =
      user.role === 'SALES' || user.role === 'BRANCH_MANAGER'
        ? user.branchId || undefined
        : branchId || undefined;
    return this.dashboardService.getStaffPerformance(effectiveBranch);
  }
}
