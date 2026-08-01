import { Controller, Get, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IntercompanyService } from './intercompany.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Inter-company')
@ApiBearerAuth('JWT')
@Controller('accounting/intercompany')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntercompanyController {
  constructor(private intercompany: IntercompanyService) {}

  @Get('balance')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getBalance() {
    return this.intercompany.getOutstandingBalance();
  }

  /**
   * Retired 2026-07-30 — superseded by the "จ่ายให้หน้าร้าน (INTER-CO)" batch
   * menu (`POST /interco-settlement/batches` + `/approve`). Kept as a 410
   * (rather than deleted outright) so any stale client/script still pointed
   * at this route gets an actionable error instead of a silent 404.
   *
   * Spec: docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md §9
   */
  @Post('settle')
  @Roles('OWNER', 'FINANCE_MANAGER')
  settle(): never {
    throw new HttpException(
      'เส้นทางนี้ถูกแทนที่ด้วยเมนูรอบจ่ายให้หน้าร้าน (INTER-CO) ใหม่ — ใช้ /interco-settlement',
      HttpStatus.GONE,
    );
  }
}
