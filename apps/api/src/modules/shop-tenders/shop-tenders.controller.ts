import {
  BadRequestException, Body, Controller, FileTypeValidator, Get, MaxFileSizeValidator, Param, ParseFilePipe, ParseUUIDPipe, Post, Query,
  Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { Readable } from 'stream';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { bangkokDateString } from '../../utils/date.util';
import { ShopTendersReportService, TenderViewer } from './shop-tenders-report.service';
import { CashCloseActor, ShopCashCloseService } from './shop-cash-close.service';
import { ShopCashHoldingService } from './shop-cash-holding.service';
import { ShopCashOverviewService } from './shop-cash-overview.service';
import { ConfirmCashCloseDto, CountCashCloseDto, CreateCashDepositDto, SendBackCashCloseDto } from './dto/cash-close.dto';
import { EVIDENCE_IMAGE_MAX_BYTES, EVIDENCE_IMAGE_MIME } from '../../utils/upload-image.util';

/** รูปหลักฐาน ≤ 5MB · JPEG/PNG/WEBP — service ตรวจ byte แรกซ้ำอีกชั้น (`assertEvidenceImage`) */
const EVIDENCE_IMAGE_PIPE = new ParseFilePipe({
  validators: [
    new MaxFileSizeValidator({ maxSize: EVIDENCE_IMAGE_MAX_BYTES, message: 'รูปมีขนาดเกิน 5MB' }),
    new FileTypeValidator({ fileType: EVIDENCE_IMAGE_MIME }),
  ],
  fileIsRequired: true,
  errorHttpStatusCode: 400,
});

const IMAGE_TYPE: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function sendEvidenceImage(res: Response, file: { key: string; stream: Readable }) {
  const extension = file.key.split('.').pop() ?? '';
  res.setHeader('Content-Type', IMAGE_TYPE[extension] ?? 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=300');
  file.stream.pipe(res);
}

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
    private readonly overview: ShopCashOverviewService,
    private readonly holdings: ShopCashHoldingService,
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

  // ─── ปิดยอดทุกวัน + หลักฐานว่าเงินถึงบริษัท (คำตัดสินเจ้าของ 2026-09-21 — mockup กระดาน 10–11) ───

  @Get('cash-close/overview')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER')
  @ApiOperation({ summary: 'สถานะปิดยอดของวัน (ทุกสาขาในขอบเขต) + แถบ 14 วัน + เงินที่ยังไม่ได้นำฝาก' })
  getCashCloseOverview(@CurrentUser() user: CashCloseActor, @Query('date') date?: string, @Query('branchId') branchId?: string) {
    return this.overview.getOverview(user, { date: date || undefined, branchId: branchId || undefined });
  }

  @Get('cash-close/reminder')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'แถบเตือนบนหน้าขาย — เมื่อวานมีเงินสดแต่ยังไม่มีใครนับปิดยอด (เตือนอย่างเดียว ไม่ล็อกการขาย)' })
  getCashCloseReminder(@CurrentUser() user: CashCloseActor, @Query('branchId') branchId?: string) {
    if (!branchId) throw new BadRequestException('กรุณาเลือกสาขา');
    return this.overview.getReminder(user, branchId);
  }

  @Post('cash-close/:id/deposit-slip')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'แนบรูปสลิปฝากเงินก่อนยืนยันรับเงิน (บังคับเมื่อปลายทาง = นำฝากธนาคาร)' })
  attachDepositSlip(@CurrentUser() user: CashCloseActor, @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(EVIDENCE_IMAGE_PIPE) file: Express.Multer.File) {
    return this.cashClose.attachDepositSlip(user, id, file);
  }

  @Get('cash-close/:id/deposit-slip')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER')
  @ApiOperation({ summary: 'รูปสลิปฝากเงินของการปิดยอด' })
  async getCloseDepositSlip(@CurrentUser() user: CashCloseActor, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendEvidenceImage(res, await this.cashClose.getDepositSlip(user, id));
  }

  @Post('cash-deposits')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'บันทึกนำฝาก — ย้ายเงินในตู้เซฟสาขา/เงินที่เจ้าของเก็บ เข้าธนาคารของร้าน (แนบสลิป + ลงบัญชีให้เอง)' })
  createCashDeposit(@CurrentUser() user: CashCloseActor, @Body() dto: CreateCashDepositDto,
    @UploadedFile(EVIDENCE_IMAGE_PIPE) file: Express.Multer.File) {
    return this.holdings.createDeposit(user, dto, file);
  }

  @Get('cash-deposits/:id/slip')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER')
  @ApiOperation({ summary: 'รูปสลิปของการนำฝาก' })
  async getCashDepositSlip(@CurrentUser() user: CashCloseActor, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendEvidenceImage(res, await this.holdings.getDepositSlip(user, id));
  }
}
