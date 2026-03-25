import { Controller, Get, Post, Param, Body, Query, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { ReceiptsService } from './receipts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { VoidReceiptDto } from './dto/void-receipt.dto';

@Controller('receipts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReceiptsController {
  constructor(private receiptsService: ReceiptsService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('receiptType') receiptType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.receiptsService.findAll({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? Math.min(parseInt(limit, 10), 10000) : undefined,
      search,
      receiptType,
      dateFrom,
      dateTo,
      branchId,
    });
  }

  @Get('contract/:contractId')
  getContractReceipts(@Param('contractId') contractId: string) {
    return this.receiptsService.getContractReceipts(contractId);
  }

  @Get(':id')
  getReceipt(@Param('id') id: string) {
    return this.receiptsService.getReceipt(id);
  }

  @Get('number/:receiptNumber')
  getReceiptByNumber(@Param('receiptNumber') receiptNumber: string) {
    return this.receiptsService.getReceiptByNumber(receiptNumber);
  }

  @Post(':id/void')
  @Roles('OWNER', 'BRANCH_MANAGER')
  voidReceipt(
    @Param('id') id: string,
    @Body() dto: VoidReceiptDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.receiptsService.voidReceipt(id, dto.reason, user.id);
  }

  @Get(':id/pdf')
  async getReceiptPDF(@Param('id') id: string, @Res() res: Response) {
    const pdf = await this.receiptsService.generatePDF(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${id}.pdf"`,
    });
    res.send(pdf);
  }
}
