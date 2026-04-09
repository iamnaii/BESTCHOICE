import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Analytics')
@ApiBearerAuth('JWT')
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('cohort-analysis')
  @ApiOperation({ summary: 'วิเคราะห์ cohort retention รายเดือน' })
  getCohortAnalysis(@Query('branchId') branchId?: string) {
    return this.analyticsService.getCohortAnalysis(branchId);
  }

  @Get('revenue-forecast')
  @ApiOperation({ summary: 'พยากรณ์รายได้ 3 เดือนข้างหน้า (linear regression)' })
  getRevenueForecast(@Query('branchId') branchId?: string) {
    return this.analyticsService.getRevenueForecast(branchId);
  }

  @Get('sales-heatmap')
  @ApiOperation({ summary: 'Sales heatmap: ยอดขายตามวันและชั่วโมง' })
  getSalesHeatmap(
    @Query('branchId') branchId?: string,
    @Query('months') months?: string,
  ) {
    return this.analyticsService.getSalesHeatmap(branchId, months ? parseInt(months) : 3);
  }
}
