import {
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
import { CreateBatchDto } from './dto/create-batch.dto';
import { ApproveBatchDto } from './dto/approve-batch.dto';
import { ReverseBatchDto } from './dto/reverse-batch.dto';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — รอบจ่าย batch endpoints.
 *
 * Roles per spec §6/§9 + plan Task 5 table:
 *   - read (pending queue / batch list / batch detail): OWNER, FINANCE_MANAGER, ACCOUNTANT
 *   - create/submit/withdraw/cancel/update-DRAFT/attach-slip (maker side): ACCOUNTANT, FINANCE_MANAGER
 *   - approve/reverse (checker side): OWNER, FINANCE_MANAGER — maker≠approver enforced
 *     server-side inside `IntercoSettlementService.approveBatch` (SoD), not here.
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
  ) {}

  /** คิวรอจ่าย + reconcile totals ระดับบัญชี (spec §4/§8 แท็บ "รอจ่าย"). */
  @Get('pending')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async pending() {
    const [pending, reconcile] = await Promise.all([
      this.pendingService.getPendingContracts(),
      this.pendingService.getReconcileTotals(),
    ]);
    return { pending, reconcile };
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

  /** อนุมัติ = post paired JE (checker side — approver ≠ maker เช็คใน service). */
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
