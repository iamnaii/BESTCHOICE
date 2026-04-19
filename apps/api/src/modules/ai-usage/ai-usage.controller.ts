import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AiUsageService } from './ai-usage.service';

@ApiTags('AI Usage')
@ApiBearerAuth('JWT')
@Controller('ai-usage')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiUsageController {
  constructor(private readonly service: AiUsageService) {}

  @Get('summary')
  @Roles('OWNER')
  getSummary() {
    return this.service.getSummary();
  }

  @Get('breakdown')
  @Roles('OWNER')
  getBreakdown(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: 'service' | 'model' | 'user',
  ) {
    return this.service.getBreakdown({ from, to, groupBy: groupBy ?? 'service' });
  }

  @Get('trend')
  @Roles('OWNER')
  getTrend(@Query('days') days?: string) {
    const n = days ? Math.min(90, Math.max(1, parseInt(days))) : 30;
    return this.service.getDailyTrend(n);
  }

  @Get('logs')
  @Roles('OWNER')
  getLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('service') service?: string,
    @Query('status') status?: 'success' | 'error',
  ) {
    return this.service.getLogs({
      page: page ? Math.max(1, parseInt(page)) : 1,
      limit: limit ? Math.min(200, Math.max(1, parseInt(limit))) : 50,
      service,
      status,
    });
  }
}
