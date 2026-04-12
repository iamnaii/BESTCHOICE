import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChatAnalyticsService } from './chat-analytics.service';

@Controller('chat-analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatAnalyticsController {
  constructor(private analyticsService: ChatAnalyticsService) {}

  @Get('overview')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async getOverview(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000);
    const end = endDate ? new Date(endDate) : new Date();
    return this.analyticsService.getOverview(start, end);
  }

  @Get('channels')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async getChannelVolume(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000);
    const end = endDate ? new Date(endDate) : new Date();
    return this.analyticsService.getChannelVolume(start, end);
  }

  @Get('staff-performance')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async getStaffPerformance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000);
    const end = endDate ? new Date(endDate) : new Date();
    return this.analyticsService.getStaffPerformance(start, end);
  }

  @Get('response-time')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async getResponseTime(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000);
    const end = endDate ? new Date(endDate) : new Date();
    return this.analyticsService.getAvgFirstResponseTime(start, end);
  }
}
