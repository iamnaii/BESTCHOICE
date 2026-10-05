import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { StockAdjustmentReason } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdjustmentPhotosInterceptor } from './adjustment-photos.interceptor';
import { CreateStockAdjustmentDto, STOCK_ADJUSTMENT_REASONS } from './dto/create-stock-adjustment.dto';
import { RejectStockAdjustmentDto } from './dto/reject-stock-adjustment.dto';
import { AdjustmentActor, StockAdjustmentsService } from './stock-adjustments.service';

type ActorUser = { id: string; role: string; branchId?: string | null };

const toActor = (user: ActorUser): AdjustmentActor => user;

function parseReason(reason: string | undefined): StockAdjustmentReason {
  if (!reason || !(STOCK_ADJUSTMENT_REASONS as readonly string[]).includes(reason)) {
    throw new BadRequestException('เหตุผลต้องเป็น DAMAGED, LOST, FOUND, CORRECTION, WRITE_OFF หรือ OTHER');
  }
  return reason as StockAdjustmentReason;
}

/**
 * คำขอตัดสินค้า (ก้อน 3 · 2026-10-05) — ผู้ขอ = SALES/BM/OWNER (สาขาตัวเอง — service บังคับ เพราะ `BranchGuard` ไม่ scope route
 * ที่มีแต่ `:id`) · อนุมัติ/ไม่อนุมัติ = OWNER เท่านั้น (คำตัดสินเจ้าของ) · อ่าน = ทุก role ที่เห็นหน้าคลัง (SALES เห็นสาขาตัวเอง).
 * ลำดับ route: ชื่อคงที่ (`summary` · `pending-count` · `lookup` · `preview`) **ก่อน** `:id`.
 */
@ApiTags('Products')
@ApiBearerAuth('JWT')
@Controller('stock-adjustments')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class StockAdjustmentsController {
  constructor(private readonly stockAdjustmentsService: StockAdjustmentsService) {}

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiConsumes('multipart/form-data')
  // AdjustmentPhotosInterceptor = FilesInterceptor('photos', 6, 5MB) + แปล error ของ Multer เป็นไทย
  @UseInterceptors(AdjustmentPhotosInterceptor)
  createRequest(
    @Body() dto: CreateStockAdjustmentDto,
    @UploadedFiles() photos: Express.Multer.File[],
    @CurrentUser() user: ActorUser,
  ) {
    return this.stockAdjustmentsService.createRequest(dto, photos ?? [], toActor(user));
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(
    @CurrentUser() user: ActorUser,
    @Query('branchId') branchId?: string,
    @Query('reason') reason?: string,
    @Query('status') status?: string,
    @Query('mine') mine?: string,
    @Query('productId') productId?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.stockAdjustmentsService.findAll(
      {
        branchId,
        reason,
        status,
        mine: mine === 'true' || mine === '1',
        productId,
        search,
        startDate,
        endDate,
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      },
      toActor(user),
    );
  }

  @Get('summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getSummary(
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stockAdjustmentsService.getSummary({ branchId, startDate, endDate });
  }

  /** ป้ายตัวเลขบนเมนู "ตัดสินค้า" — จำนวนคำขอที่รออนุมัติในขอบเขตที่ผู้ใช้เห็น */
  @Get('pending-count')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  pendingCount(@CurrentUser() user: ActorUser) {
    return this.stockAdjustmentsService.pendingCount(toActor(user));
  }

  @Get('lookup')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  async lookup(
    @Query('imei') imei: string | undefined,
    @Query('search') search: string | undefined,
    @Query('reason') reason: string,
    @CurrentUser() user: ActorUser,
  ) {
    return this.stockAdjustmentsService.lookupProduct({ imei, search, reason: parseReason(reason) }, toActor(user));
  }

  @Get('preview')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  async preview(@Query('productId') productId: string, @Query('reason') reason: string, @CurrentUser() user: ActorUser) {
    if (!productId) throw new BadRequestException('กรุณาระบุรหัสสินค้า');
    return this.stockAdjustmentsService.preview(productId, parseReason(reason), toActor(user));
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findOne(@Param('id') id: string, @CurrentUser() user: ActorUser) {
    return this.stockAdjustmentsService.findOne(id, toActor(user));
  }

  @Post(':id/approve')
  @Roles('OWNER')
  approve(@Param('id') id: string, @CurrentUser() user: ActorUser) {
    return this.stockAdjustmentsService.approve(id, toActor(user));
  }

  @Post(':id/reject')
  @Roles('OWNER')
  reject(@Param('id') id: string, @Body() dto: RejectStockAdjustmentDto, @CurrentUser() user: ActorUser) {
    return this.stockAdjustmentsService.reject(id, dto, toActor(user));
  }

  @Post(':id/cancel')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  cancel(@Param('id') id: string, @CurrentUser() user: ActorUser) {
    return this.stockAdjustmentsService.cancel(id, toActor(user));
  }
}
