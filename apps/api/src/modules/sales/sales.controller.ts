import { Throttle } from '@nestjs/throttler';
import { SalesListQueryDto } from './dto/sales-list-query.dto';
import { bangkokDateString } from '../../utils/date.util';
import { BadRequestException, Controller, Get, Post, Param, Body, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SaleReceiptLineService } from './services/sale-receipt-line.service';
import { INSTALLMENT_RECEIPT_MSG, SaleReceiptPdfService } from './services/sale-receipt-pdf.service';
import { SaleReceiptTokenService } from './services/sale-receipt-token.service';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { SaleVoidService } from './services/sale-void.service';
import { CreateSaleDto } from './dto/sale.dto';
import { VoidSaleDto } from './dto/void-sale.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SalesReadActor } from './sales-read.types';

@ApiTags('Sales')
@ApiBearerAuth('JWT')
@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class SalesController {
  constructor(
    private salesService: SalesService,
    private saleVoidService: SaleVoidService,
    private readonly receiptPdf: SaleReceiptPdfService,
    private readonly receiptTokens: SaleReceiptTokenService,
    private readonly receiptLine: SaleReceiptLineService,
  ) {}

  @Get('export')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  exportRows(@Query() filters: SalesListQueryDto, @CurrentUser() user: SalesReadActor) {
    return this.salesService.exportRows(filters, user);
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(
    @CurrentUser() user: SalesReadActor,
    @Query() filters: SalesListQueryDto,
  ) {
    return this.salesService.findAll(filters, user);
  }

  @Get('salespersons')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getSalespersons(@CurrentUser() user: SalesReadActor) {
    return this.salesService.getSalespersons(user);
  }

  @Get('config')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  getPosConfig() {
    return this.salesService.getPosConfig();
  }

  @Get('top-products')
  // SALES included — the POS page shows top-selling products to sales staff.
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getTopProducts(@CurrentUser() user: SalesReadActor) {
    return this.salesService.getTopSellingProducts(user);
  }

  @Get('daily-summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getDailySummary(
    @CurrentUser() user: SalesReadActor,
    @Query('date') date?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.salesService.getDailySummary(
      date || bangkokDateString(),
      user,
      branchId,
    );
  }

  // ─── ใบเสร็จขายสด (ก้อน 4 · 2026-10-23) — ต้องอยู่ก่อน `:id` ─────────────────────────────
  // พนักงานเปิด PDF ได้แม้ใบถูกยกเลิก (ลายน้ำ) แต่แชร์/ส่ง LINE ไม่ได้ · ขอบเขตสาขาตาม salesBranchWhere ใน service
  @Get(':id/receipt.pdf')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async getReceiptPdf(@Param('id') id: string, @CurrentUser() user: SalesReadActor, @Res() res: Response) {
    const { pdf, saleNumber } = await this.receiptPdf.generate(id, user);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(`ใบเสร็จ-${saleNumber}`)}.pdf"`,
      'Cache-Control': 'private, no-store',
      'Content-Length': pdf.length.toString(),
    });
    res.send(pdf);
  }

  @Post(':id/receipt/share')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async shareReceipt(@Param('id') id: string, @CurrentUser() user: SalesReadActor) {
    // findOne = ด่านสาขา/ไม่พบ เดิมของ /sales/:id — token ออกให้เฉพาะใบที่ยังมีผลและเป็นขายสด/ไฟแนนซ์นอก
    const sale = await this.salesService.findOne(id, user);
    if (sale.saleType !== 'CASH' && sale.saleType !== 'EXTERNAL_FINANCE') {
      throw new BadRequestException(INSTALLMENT_RECEIPT_MSG);
    }
    if (sale.deletedAt) throw new BadRequestException('ใบขายนี้ถูกยกเลิกแล้ว');
    const { token, expiresAt } = await this.receiptTokens.ensureToken(id);
    return { url: this.receiptTokens.publicUrl(token), expiresAt };
  }

  @Post(':id/receipt/line')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  sendReceiptLine(@Param('id') id: string, @CurrentUser() user: SalesReadActor) {
    return this.receiptLine.send(id, user);
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findOne(@Param('id') id: string, @CurrentUser() user: SalesReadActor) {
    return this.salesService.findOne(id, user);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(
    @Body() dto: CreateSaleDto,
    @CurrentUser() user: SalesReadActor,
  ) {
    return this.salesService.create(dto, user.id, user.role, user.branchId);
  }

  @Post(':id/void')
  @Roles('OWNER', 'BRANCH_MANAGER')
  voidSale(
    @Param('id') id: string,
    @Body() dto: VoidSaleDto,
    // ส่ง user ทั้งก้อน — service ใช้ role/branchId ทำ branch scope (BranchGuard
    // ไม่ scope route ที่ไม่มี branchId ใน request)
    @CurrentUser() user: { id: string; role: string; branchId?: string },
  ) {
    return this.saleVoidService.voidSale(id, user, dto.reason);
  }
}
