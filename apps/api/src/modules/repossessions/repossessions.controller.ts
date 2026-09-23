import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RepossessionsService, RequestUser } from './repossessions.service';
import { UpdateRepossessionDto } from './dto/create-repossession.dto';
import { ReadyForSaleDto } from './dto/ready-for-sale.dto';
import { RefundPaymentDto, RefundWaiveDto } from './dto/refund-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Repossessions')
@ApiBearerAuth('JWT')
@Controller('repossessions')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class RepossessionsController {
  constructor(private repossessionsService: RepossessionsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findAll(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.repossessionsService.findAll(
      {
        status,
        branchId,
        page: page ? parseInt(page) : undefined,
        limit: limit ? parseInt(limit) : undefined,
      },
      user,
    );
  }

  @Get('profit-loss')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getProfitLoss(@Query('page') page?: string, @Query('limit') limit?: string) {
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : undefined;
    return this.repossessionsService.getProfitLossSummary(
      parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    );
  }

  // คำสั่งเจ้าของ 2026-09-23: "คนอื่นคำนวณได้ แต่ผู้จัดการอนุมัติทีหลัง" — ทุก role เปิดดู
  // ตัวเลขยอดปิด/P&L ได้ ส่วนการยืนยัน (JP5) ยังเป็น OWNER/FM ที่ `POST /device-returns/:id/confirm`
  @Get('preview/:contractId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  previewCalculation(
    @Param('contractId') contractId: string,
    @CurrentUser() user: RequestUser,
    @Query('appraisalPrice') appraisalPrice?: string,
    @Query('discountPct') discountPct?: string,
    @Query('conditionGrade') conditionGrade?: string,
    @Query('deviceReturnId') deviceReturnId?: string,
  ) {
    return this.repossessionsService.previewCalculation(
      contractId,
      {
        appraisalPrice: appraisalPrice ? parseFloat(appraisalPrice) : undefined,
        discountPct: discountPct ? parseFloat(discountPct) : undefined,
        conditionGrade: conditionGrade || undefined,
        deviceReturnId: deviceReturnId || undefined,
      },
      user,
    );
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.repossessionsService.findOne(id, user);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRepossessionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.repossessionsService.update(id, dto, user);
  }

  @Post(':id/ready-for-sale')
  @Roles('OWNER', 'BRANCH_MANAGER')
  markReadyForSale(
    @Param('id') id: string,
    @Body() dto: ReadyForSaleDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.repossessionsService.markReadyForSale(
      id,
      { resellPrice: dto.resellPrice, installmentPrice: dto.installmentPrice },
      user,
    );
  }

  // Task 2 (คำสั่งเจ้าของ 2026-08-08 ข้อ 2) — จ่ายเงินคืนส่วนต่างลูกค้า (ล้าง 21-1107)
  @Post(':id/refund-payment')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  refundPayment(
    @Param('id') id: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.repossessionsService.refundPayment(id, user, dto);
  }

  // คำสั่งเจ้าของ 2026-08-08 เพิ่มเติม — ไม่คืนเงิน (ล้าง 21-1107 ที่เหลือเข้ารายได้ 41-1102)
  @Post(':id/refund-waive')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  refundWaive(
    @Param('id') id: string,
    @Body() dto: RefundWaiveDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.repossessionsService.waiveRefund(id, user, dto);
  }
}
