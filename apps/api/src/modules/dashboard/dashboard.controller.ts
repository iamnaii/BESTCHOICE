import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth , ApiOperation} from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Dashboard')
@ApiBearerAuth('JWT')
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('alerts')
  getAlerts(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = this.getEffectiveBranch(branchId, user);
    return this.dashboardService.getAlerts(effectiveBranch);
  }

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
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getBranchComparison() {
    return this.dashboardService.getBranchComparison();
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

  @Get('sla')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getSlaMetrics(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = this.getEffectiveBranch(branchId, user);
    return this.dashboardService.getSlaMetrics(effectiveBranch);
  }

  @Get('watch-list')
  @ApiOperation({ summary: 'Watch list: ลูกค้าเสี่ยงค้างชำระ (early warning)' })
  getWatchList(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = this.getEffectiveBranch(branchId, user);
    return this.dashboardService.getWatchList(effectiveBranch);
  }

  @Get('staff-performance')
  getStaffPerformance(
    @CurrentUser() user: { role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranch = this.getEffectiveBranch(branchId, user);
    return this.dashboardService.getStaffPerformance(effectiveBranch);
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
