import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BranchGuard } from '../auth/guards/branch.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JourneyListResponse, JourneyRedirect, JourneySummary } from '@installment/shared';
import { CustomerJourneyService } from './customer-journey.service';
import { JourneyListQueryDto } from './dto/journey-list-query.dto';

@ApiTags('Customer Journey')
@ApiBearerAuth('JWT')
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class CustomerJourneyController {
  constructor(private readonly journey: CustomerJourneyService) {}

  @Get(':id/journey')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'การเดินทางของลูกค้า — แชท เครดิต การขาย ชำระเงิน ติดตามหนี้ บริการ แต้ม (keyset cursor)' })
  list(@Param('id') id: string, @Query() query: JourneyListQueryDto, @CurrentUser() user: { id: string; role: string }): Promise<JourneyListResponse | JourneyRedirect> {
    return this.journey.list(id, query, { id: user.id, role: user.role });
  }

  @Get(':id/journey/summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'แถบขั้นการเดินทางของลูกค้า — ขั้นซื้อแล้วตรวจสดกับ BOUGHT_WHERE ทุกคำขอ · ผู้สนใจที่ถูกรวมแล้วได้ redirect' })
  summary(@Param('id') id: string, @CurrentUser() user: { id: string; role: string }): Promise<JourneySummary | JourneyRedirect> {
    return this.journey.summary(id, { id: user.id, role: user.role });
  }
}
