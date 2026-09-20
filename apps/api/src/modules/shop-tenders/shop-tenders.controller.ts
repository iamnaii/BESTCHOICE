import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { bangkokDateString } from '../../utils/date.util';
import { ShopTendersReportService, TenderViewer } from './shop-tenders-report.service';
import { CashCloseActor, ShopCashCloseService } from './shop-cash-close.service';
import { ConfirmCashCloseDto, CountCashCloseDto, SendBackCashCloseDto } from './dto/cash-close.dto';

/**
 * ไม่ใส่ BranchGuard: ขอบเขตสาขา/ขอบเขต "ของตัวเอง" บังคับใน service (`resolveScope`) —
 * guard ปฏิเสธ SALES ที่ส่ง branchId อื่นไปเลย ทั้งที่กติกาของหน้านี้คือ "ละเลย branchId แล้วให้เห็นเฉพาะของตัวเอง".
 */
@ApiTags('shop-tenders')
@ApiBearerAuth()
@Controller('shop-tenders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShopTendersController {
  constructor(
    private readonly report: ShopTendersReportService,
    private readonly cashClose: ShopCashCloseService,
  ) {}

  @Get('daily-summary')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'สรุปเงินหน้าร้านรายวัน — เงินเข้า/ออกจริง แยกวิธีรับและผู้รับ' })
  getDailySummary(
    @CurrentUser() user: TenderViewer,
    @Query('date') date?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.report.getDailySummary({ date: date || bangkokDateString(), branchId: branchId || undefined }, user);
  }

  // ─── นับเงินปิดยอด (คำตัดสินเจ้าของ 2026-09-20) — ขอบเขตสาขา/ผู้นับ≠ผู้ยืนยัน บังคับใน ShopCashCloseService ───

  @Get('cash-close/status')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'กล่องปิดยอดของสาขา — ยอดที่ต้องมีในลิ้นชักตอนนี้ + การนับของวันที่เลือก' })
  getCashCloseStatus(@CurrentUser() user: CashCloseActor, @Query('branchId') branchId?: string, @Query('date') date?: string) {
    if (!branchId) throw new BadRequestException('กรุณาเลือกสาขา');
    return this.cashClose.getStatus(user, { branchId, date: date || undefined });
  }

  @Get('cash-close/history')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER')
  @ApiOperation({ summary: 'ประวัติการปิดยอด + แถบเตือนเจ้าของ' })
  getCashCloseHistory(@CurrentUser() user: CashCloseActor, @Query('branchId') branchId?: string, @Query('month') month?: string) {
    return this.cashClose.getHistory(user, { branchId: branchId || undefined, month: month || undefined });
  }

  @Post('cash-close')
  @Roles('SALES', 'BRANCH_MANAGER')
  @ApiOperation({ summary: 'พนักงานนับเงินปิดยอด (บันทึกแล้วแก้ไม่ได้)' })
  countCashClose(@CurrentUser() user: CashCloseActor, @Body() dto: CountCashCloseDto) {
    return this.cashClose.count(user, dto);
  }

  @Post('cash-close/:id/confirm')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  @ApiOperation({ summary: 'ยืนยันรับเงินและปิดยอด (ต้องไม่ใช่ผู้นับ)' })
  confirmCashClose(@CurrentUser() user: CashCloseActor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmCashCloseDto) {
    return this.cashClose.confirm(user, id, dto);
  }

  @Post('cash-close/:id/send-back')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  @ApiOperation({ summary: 'ตีกลับให้นับใหม่ (ต้องไม่ใช่ผู้นับ)' })
  sendBackCashClose(@CurrentUser() user: CashCloseActor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendBackCashCloseDto) {
    return this.cashClose.sendBack(user, id, dto);
  }
}
