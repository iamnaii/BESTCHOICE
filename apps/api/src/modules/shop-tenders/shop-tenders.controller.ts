import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { bangkokDateString } from '../../utils/date.util';
import { ShopTendersReportService, TenderViewer } from './shop-tenders-report.service';

/**
 * ไม่ใส่ BranchGuard: ขอบเขตสาขา/ขอบเขต "ของตัวเอง" บังคับใน service (`resolveScope`) —
 * guard ปฏิเสธ SALES ที่ส่ง branchId อื่นไปเลย ทั้งที่กติกาของหน้านี้คือ "ละเลย branchId แล้วให้เห็นเฉพาะของตัวเอง".
 */
@ApiTags('shop-tenders')
@ApiBearerAuth()
@Controller('shop-tenders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShopTendersController {
  constructor(private readonly report: ShopTendersReportService) {}

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
}

