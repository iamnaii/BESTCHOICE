import {
  BadRequestException,
  Body,
  Controller,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IntercoSettlementService } from './interco-settlement.service';
import { IntercoPendingService } from './interco-pending.service';
import { IntercoAgingService } from './interco-aging.service';
import {
  IntercoReconcileCron,
  type ReconcileFinding,
  type ReconcileFindingKind,
} from './crons/interco-reconcile.cron';
import { CreateBatchDto } from './dto/create-batch.dto';
import { ApproveBatchDto } from './dto/approve-batch.dto';
import { ReverseBatchDto } from './dto/reverse-batch.dto';
import { SettleRecallCashDto } from './dto/settle-recall-cash.dto';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — รอบจ่าย batch endpoints.
 *
 * Roles per spec §6/§9 + plan Task 5 table:
 *   - read (pending queue / batch list / batch detail): OWNER, FINANCE_MANAGER, ACCOUNTANT
 *   - create/submit/withdraw/cancel/update-DRAFT/attach-slip (maker side): ACCOUNTANT, FINANCE_MANAGER
 *   - approve/reverse (checker side): OWNER, FINANCE_MANAGER — สิทธิ์ตาม role นี้
 *     คือกลไกคุมการอนุมัติ (คำสั่งเจ้าของ 2026-08-03). กฎเดิม "ผู้อนุมัติต้องไม่ใช่
 *     ผู้สร้าง" ไม่บังคับแล้วโดยค่าเริ่มต้น — เปิดกลับได้ที่ SystemConfig
 *     `interco_maker_checker_enabled` = 'true' (เช็คใน `approveBatch`).
 *
 * Spec: docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md
 */
@ApiTags('Inter-co Settlement')
@ApiBearerAuth('JWT')
@Controller('interco-settlement')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class IntercoSettlementController {
  constructor(
    private readonly service: IntercoSettlementService,
    private readonly pendingService: IntercoPendingService,
    private readonly agingService: IntercoAgingService,
    private readonly reconcileCron: IntercoReconcileCron,
  ) {}

  /** คิวรอจ่าย + คิวหักเรียกคืน (C-2) + reconcile totals ระดับบัญชี (spec §4/§8 แท็บ "รอจ่าย"). */
  @Get('pending')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async pending() {
    const [pending, recalls, reconcile] = await Promise.all([
      this.pendingService.getPendingContracts(),
      this.pendingService.getPendingRecalls(),
      this.pendingService.getReconcileTotals(),
    ]);
    return { pending, recalls, reconcile };
  }

  /**
   * รายงานอายุลูกหนี้-หน้าร้าน (11-2107 / S21-3001) แยกประเภท + อายุ ต่อสัญญา
   * (Phase 4 — spec §6 ข้อ 1). `asOf` มีผลกับการคำนวณ "อายุ" เท่านั้น —
   * ยอดคงเหลือเป็นยอดปัจจุบันเสมอ (ดู jsdoc ของ IntercoAgingService).
   */
  @Get('shop-receivable-aging')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  aging(@Query('asOf') asOf?: string, @Query('thresholdDays') thresholdDays?: string) {
    let asOfDate: Date | undefined;
    if (asOf !== undefined && asOf !== '') {
      asOfDate = new Date(asOf);
      if (Number.isNaN(asOfDate.getTime())) {
        throw new BadRequestException(
          'รูปแบบวันที่ (asOf) ไม่ถูกต้อง — ใช้รูปแบบ ISO เช่น 2026-08-21',
        );
      }
    }
    let threshold: number | undefined;
    if (thresholdDays !== undefined && thresholdDays !== '') {
      threshold = Number(thresholdDays);
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > 365) {
        throw new BadRequestException('เกณฑ์วันค้าง (thresholdDays) ต้องเป็นจำนวนเต็ม 1-365');
      }
    }
    return this.agingService.getShopReceivableAging(asOfDate, threshold);
  }

  /**
   * finding ที่ **ไม่ปรากฏบนแท็บอายุลูกหนี้** (Phase 5 Task 5 ข้อ 1) — คู่เจ้าหนี้/
   * ลูกหนี้รอบจ่ายที่ไม่ตรงกัน + แถวที่ยอด typed ติดลบ (ล้างเกิน). สองมุมนี้
   * reconcile cron รายงานทุกเดือนแต่ก่อนหน้านี้ **ไม่มีที่ให้ดู** — ใบ Todo จึง
   * ต้องเขียนว่า "ให้ใช้ข้อมูลในใบนี้"; endpoint นี้คือหน้าจอของมัน.
   *
   * ไม่มี query param โดยตั้งใจ: ยอดทุกตัวเป็นยอดปัจจุบันเสมอ (เหมือนรายงานอายุ
   * — `asOf` มีผลกับ "อายุ" เท่านั้น) การเปิดให้เลือกวันที่จะสื่อผิดว่าเป็นยอด
   * ย้อนหลัง. Roles เดียวกับรายงานอายุ: อ่านอย่างเดียว ไม่แตะ GL.
   */
  @Get('reconcile-findings')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  reconcileFindings() {
    return this.agingService.getReconcileFindings();
  }

  /**
   * สั่งรันกระทบยอดระหว่างกิจการ **เดี๋ยวนี้** (Phase 5 Task 5 ข้อ 4) — ไม่ต้อง
   * รอ cron วันที่ 1. เรียก `tick()` ตัวเดียวกับ cron ⇒ ได้ทั้ง dedup Todo
   * รายเดือนเดิม (tag + yyyy-mm + ยังไม่ DONE ⇒ รันซ้ำในเดือนเดียวกันไม่สร้าง
   * ใบซ้ำ), Sentry ชุดเดิม และ kill switch `interco_reconcile_enabled` ตัวเดิม
   * (ปิดอยู่ = คืน `enabled: false` ไม่ทำอะไร — เจตนา: สวิตช์เดียวคุมทั้งสอง
   * ช่องทาง ไม่มีทางลัดข้ามสวิตช์).
   *
   * `tick()` ไม่ throw ออกมาตาม doctrine (DB ล่ม = คืน enabled:false + Sentry)
   * ⇒ endpoint นี้จึงไม่ต้องมี error path ของตัวเอง. Roles ระดับ checker
   * (OWNER/FM) เพราะมันเขียน Todo + ยิง Sentry ให้ทั้งองค์กรเห็น.
   */
  @Post('reconcile/run')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async runReconcile() {
    const result = await this.reconcileCron.tick();
    const counts: Partial<Record<ReconcileFindingKind, number>> = {};
    for (const f of result.findings as ReconcileFinding[]) {
      counts[f.kind] = (counts[f.kind] ?? 0) + 1;
    }
    return {
      enabled: result.enabled,
      todoCreated: result.todoCreated,
      total: result.findings.length,
      counts,
      findings: result.findings,
    };
  }

  @Get('batches')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : NaN;
    const parsedLimit = limit ? parseInt(limit, 10) : NaN;
    return this.service.listBatches({
      status,
      page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : undefined,
      limit: Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
    });
  }

  @Get('batches/:id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.getBatch(id);
  }

  @Post('batches')
  @Roles('ACCOUNTANT', 'FINANCE_MANAGER')
  create(@Body() dto: CreateBatchDto, @CurrentUser('id') userId: string) {
    return this.service.createBatch(dto, userId);
  }

  /** แก้ไขรอบสถานะ DRAFT เท่านั้น (maker-only guard อยู่ใน service — spec §6). */
  @Put('batches/:id')
  @Roles('ACCOUNTANT', 'FINANCE_MANAGER')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateBatchDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.updateBatch(id, dto, userId);
  }

  @Post('batches/:id/submit')
  @Roles('ACCOUNTANT', 'FINANCE_MANAGER')
  submit(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string) {
    return this.service.submitBatch(id, userId);
  }

  @Post('batches/:id/withdraw')
  @Roles('ACCOUNTANT', 'FINANCE_MANAGER')
  withdraw(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string) {
    return this.service.withdrawBatch(id, userId);
  }

  @Post('batches/:id/cancel')
  @Roles('ACCOUNTANT', 'FINANCE_MANAGER')
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string) {
    return this.service.cancelBatch(id, userId);
  }

  /** อนุมัติ = post paired JE (checker side — คุมด้วย @Roles; SoD เป็น opt-in ใน service). */
  @Post('batches/:id/approve')
  @Roles('OWNER', 'FINANCE_MANAGER')
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApproveBatchDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.approveBatch(id, userId, dto.postedAt ? new Date(dto.postedAt) : undefined);
  }

  @Post('batches/:id/reverse')
  @Roles('OWNER', 'FINANCE_MANAGER')
  reverse(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReverseBatchDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.reverseBatch(id, userId, dto.reason);
  }

  /**
   * รับเงินสดคืนจากหน้าร้าน (Flow C-2 — Phase 3 Task 6): ล้างยอดเรียกคืนด้วย
   * เงินสดแทนการหักในรอบจ่าย. เป็นการโพสต์ JE สองสมุดทันที (ไม่มี batch/
   * maker-checker ชั้นเอกสาร) จึง gate ด้วย role ระดับ checker เหมือน
   * approve/reverse.
   */
  @Post('recalls/:contractId/settle-cash')
  @Roles('OWNER', 'FINANCE_MANAGER')
  settleRecallCash(
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @Body() dto: SettleRecallCashDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.settleRecallCash(contractId, dto, userId);
  }

  /** แนบสลิป/หลักฐานโอน (optional, maker-only, DRAFT/PENDING_APPROVAL only — service enforces). */
  @Post('batches/:id/slip')
  @Roles('ACCOUNTANT', 'FINANCE_MANAGER')
  @UseInterceptors(FileInterceptor('file'))
  uploadSlip(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') userId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024, message: 'ไฟล์มีขนาดเกิน 5MB' }),
          new FileTypeValidator({ fileType: /^(application\/pdf|image\/(jpeg|png|webp))$/ }),
        ],
        fileIsRequired: true,
        errorHttpStatusCode: 400,
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.service.uploadSlip(id, file, userId);
  }
}
