import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BranchGuard } from '../auth/guards/branch.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JourneyEntryCreatedResponse, JourneyListResponse, JourneyRedirect, JourneySummary } from '@installment/shared';
import { CustomerJourneyService } from './customer-journey.service';
import { CreateJourneyEntryDto } from './dto/create-journey-entry.dto';
import { JourneyListQueryDto } from './dto/journey-list-query.dto';
import { JourneyManualEntryService } from './journey-manual-entry.service';

@ApiTags('Customer Journey')
@ApiBearerAuth('JWT')
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class CustomerJourneyController {
  constructor(
    private readonly journey: CustomerJourneyService,
    private readonly manualEntries: JourneyManualEntryService,
  ) {}

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

  /** ACCOUNTANT ไม่มีสิทธิ์เขียน (และไม่เห็นกลุ่มแชทที่แถวบันทึกมืออยู่) · Customer ไม่มี branchId จึงไม่มีขอบเขตสาขา */
  @Post(':id/journey/entries')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  @ApiOperation({ summary: 'บันทึกมือแตะเดียว — ติดต่อ · รู้จักร้านจากไหน · ติดป้ายหลุด · เปิดใหม่ · เวลาเซิร์ฟเวอร์ · clientRequestId กันกดซ้ำ · 201 เสมอ (เปิดใหม่ตอนไม่หลุด = entryId null)' })
  createEntry(@Param('id') id: string, @Body() dto: CreateJourneyEntryDto, @CurrentUser() user: { id: string; role: string }): Promise<JourneyEntryCreatedResponse> {
    return this.manualEntries.create(id, dto, { id: user.id, role: user.role });
  }
}
