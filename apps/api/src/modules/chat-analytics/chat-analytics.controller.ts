import { ChatSalesAttributionService } from './chat-sales-attribution.service';
import type { ChatWorkActor } from '@installment/shared';
import { ChatAnalyticsV2Service } from './chat-analytics-v2.service';
import {
  ChatAnalyticsQueryDto,
  ChatFunnelDetailsDto,
  ChatOpenWorkDto,
  ChatCycleDetailsDto,
  ChatWorkDetailsDto,
} from './dto/chat-analytics-query.dto';
import { Controller, Get, GoneException, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('chat-analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatAnalyticsController {
  constructor(
    private v2: ChatAnalyticsV2Service,
    private sales: ChatSalesAttributionService,
  ) {}
  @Get('v2/filter-options')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  filterOptionsV2(@Req() req: { user: ChatWorkActor }, @Query() q: ChatAnalyticsQueryDto) {
    return this.v2.filterOptions(req.user, q);
  }
  @Get('v2/overview')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  overviewV2(@Req() req: { user: ChatWorkActor }, @Query() q: ChatAnalyticsQueryDto) {
    return this.v2.overview(req.user, q);
  }
  @Get('v2/staff')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  staffV2(@Req() req: { user: ChatWorkActor }, @Query() q: ChatAnalyticsQueryDto) {
    return this.v2.staff(req.user, q);
  }
  @Get('v2/cycles')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  cyclesV2(@Req() req: { user: ChatWorkActor }, @Query() q: ChatCycleDetailsDto) {
    return this.v2.cycles(req.user, q);
  }

  @Get('v2/open-work')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  openWorkV2(@Req() req: { user: ChatWorkActor }, @Query() q: ChatOpenWorkDto) {
    return this.v2.openWork(req.user, q);
  }
  @Get('v2/work')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  workV2(@Req() req: { user: ChatWorkActor }, @Query() q: ChatAnalyticsQueryDto) {
    return this.v2.work(req.user, q);
  }
  @Get('v2/work-details')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  workDetailsV2(@Req() req: { user: ChatWorkActor }, @Query() q: ChatWorkDetailsDto) {
    return this.v2.workDetails(req.user, q);
  }
  @Get('v2/sales')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  salesV2(@Req() req: { user: ChatWorkActor }, @Query() q: ChatAnalyticsQueryDto) {
    return this.sales.sales(q, req.user);
  }
  @Get('v2/sales/export')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  salesExportV2(@Req() req: { user: ChatWorkActor }, @Query() q: ChatAnalyticsQueryDto) {
    return this.sales.exportSales(q, req.user);
  }
  @Get('v2/funnel')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  funnelV2(@Req() req: { user: ChatWorkActor }, @Query() q: ChatAnalyticsQueryDto) {
    return this.sales.funnel(q, req.user);
  }
  @Get('v2/funnel-details')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  funnelDetailsV2(@Req() req: { user: ChatWorkActor }, @Query() q: ChatFunnelDetailsDto) {
    return this.sales.funnelDetails(q, req.user);
  }
  // The retired endpoints had no company/branch scope and mixed bot/human evidence.
  @Get('overview')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async getOverview() {
    throw new GoneException('กรุณาใช้รายงาน v2 พร้อมบริษัทและช่วงวันที่');
  }
  @Get('channels')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async getChannelVolume() {
    throw new GoneException('กรุณาใช้รายงาน v2 พร้อมบริษัทและช่วงวันที่');
  }
  @Get('staff-performance')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async getStaffPerformance() {
    throw new GoneException('กรุณาใช้รายงาน v2 พร้อมบริษัทและช่วงวันที่');
  }
  @Get('response-time')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async getResponseTime() {
    throw new GoneException('กรุณาใช้รายงาน v2 พร้อมบริษัทและช่วงวันที่');
  }
}
