import { Body, Controller, Get, Post, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ContractExchangeService } from './contract-exchange.service';
import { ExchangeCancelService } from './contract-exchange-cancel.service';
import { RejectExchangeRequestDto } from './dto/reject-exchange-request.dto';
import { CancelExchangeRequestDto } from './dto/cancel-exchange-request.dto';
import { deviceSwapClosed } from './device-swap-closed.policy';

/**
 * เส้นทางเดิมของคำขอเปลี่ยนเครื่อง (ก่อนรวมเข้า /after-sales). **ยื่น / preview / อนุมัติ ปิดใช้ 2026-10-06**
 * (คำตัดสินเจ้าของ — ดู device-swap-closed.policy.ts) → 410 พร้อมข้อความชี้ทาง; เหลือเฉพาะเส้นทางที่ใช้
 * ปิดคำขอที่ค้างอยู่ก่อนปิดเมนู: รายการ pending/recent · ยกเลิก (swap ที่ลงผลแล้ว) · ปฏิเสธ.
 */
@Controller('insurance/exchange-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractExchangeController {
  constructor(
    private readonly svc: ContractExchangeService,
    private readonly cancelSvc: ExchangeCancelService,
  ) {}

  @Post()
  @Roles('SALES', 'BRANCH_MANAGER', 'OWNER')
  submit(): never {
    throw deviceSwapClosed();
  }

  @Get('preview')
  @Roles('SALES', 'BRANCH_MANAGER', 'OWNER')
  preview(): never {
    throw deviceSwapClosed();
  }

  @Get('pending')
  @Roles('OWNER', 'BRANCH_MANAGER')
  listPending(@Req() req: any) {
    // I7: BM sees only their own branch's queue (scoped in-service).
    return this.svc.listPending(req.user);
  }

  @Get('recent')
  @Roles('OWNER', 'BRANCH_MANAGER')
  listRecent(@Req() req: any) {
    // I7: BM sees only their own branch's recent approvals (scoped in-service).
    return this.svc.listRecent(req.user);
  }

  @Post(':id/approve')
  @Roles('OWNER', 'BRANCH_MANAGER')
  approve(): never {
    throw deviceSwapClosed();
  }

  @Post(':id/cancel')
  @Roles('OWNER', 'BRANCH_MANAGER')
  cancel(@Param('id') id: string, @Body() dto: CancelExchangeRequestDto, @Req() req: any) {
    return this.cancelSvc.cancel(id, dto.reason, req.user);
  }

  @Post(':id/reject')
  @Roles('OWNER')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectExchangeRequestDto,
    @Req() req: any,
  ) {
    return this.svc.reject(id, dto.reason, req.user.id);
  }
}
