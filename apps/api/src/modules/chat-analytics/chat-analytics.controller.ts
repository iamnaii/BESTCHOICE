import type { ChatWorkActor } from '@installment/shared';
import { ChatAnalyticsV2Service } from './chat-analytics-v2.service';
import {
  ChatAnalyticsQueryDto,
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
  constructor(private v2: ChatAnalyticsV2Service) {}
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
