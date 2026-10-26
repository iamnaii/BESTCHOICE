import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RecurringBillsService, type ScopedUser } from './recurring-bills.service';
import { RecurringBillsQueryDto } from './dto/recurring-bills-query.dto';
import { MarkPaidDto } from './dto/mark-paid.dto';
import { SkipOccurrenceDto } from './dto/skip-occurrence.dto';

/**
 * ก้อน 6 — บิลประจำ (D5): หน้า "บิลประจำ" ของเดือน + การกระทำบนงวด (spec §8)
 * ขอบเขตสาขาบังคับใน service (`getBranchScope`) — BM เห็น/ทำได้เฉพาะสาขาตัวเอง fail-closed
 */
@Controller('recurring-bills')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecurringBillsController {
  constructor(private readonly service: RecurringBillsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(@Query() query: RecurringBillsQueryDto, @CurrentUser() user: ScopedUser) {
    return this.service.listMonth(user, query.month, query.branchId);
  }

  @Post(':id/mark-paid')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  markPaid(@Param('id') id: string, @Body() dto: MarkPaidDto, @CurrentUser() user: ScopedUser) {
    return this.service.markPaid(id, user, dto);
  }

  @Post(':id/skip')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  skip(@Param('id') id: string, @Body() dto: SkipOccurrenceDto, @CurrentUser() user: ScopedUser) {
    return this.service.skip(id, user, dto);
  }

  @Post(':id/reopen')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  reopen(@Param('id') id: string, @CurrentUser() user: ScopedUser) {
    return this.service.reopen(id, user);
  }

  @Post(':id/create-draft')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  createDraft(@Param('id') id: string, @CurrentUser() user: ScopedUser) {
    return this.service.createDraft(id, user);
  }
}
