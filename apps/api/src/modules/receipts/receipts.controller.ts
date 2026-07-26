import { Controller, Get, Post, Param, Body, Query, UseGuards, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { ReceiptsService } from './receipts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { VoidReceiptDto } from './dto/void-receipt.dto';
import { IssueCreditNoteDto } from './dto/issue-credit-note.dto';
import { ExportEnabledGuard } from '../settings/guards/export-enabled.guard';

@ApiTags('Receipts')
@ApiBearerAuth('JWT')
@Controller('receipts')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class ReceiptsController {
  constructor(private receiptsService: ReceiptsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
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
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getContractReceipts(
    @Param('contractId') contractId: string,
    @Query('includeVoided') includeVoided?: string,
  ) {
    return this.receiptsService.getContractReceipts(contractId, includeVoided === 'true');
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getReceipt(@Param('id') id: string) {
    return this.receiptsService.getReceipt(id);
  }

  @Get('number/:receiptNumber')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getReceiptByNumber(@Param('receiptNumber') receiptNumber: string) {
    return this.receiptsService.getReceiptByNumber(receiptNumber);
  }

  // Phase 3 CN Task 5 — manual CN issue endpoint. Literal two-segment path
  // ('credit-note/issue') declared before the ':id/...' POST routes below per
  // Nest routing convention — a literal path always takes precedence, though
  // in this case there's no actual collision risk since ':id/void' and
  // ':id/send-line' both require a literal second segment that 'issue' can't
  // match either way.
  @Post('credit-note/issue')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  issueCreditNote(
    @Body() dto: IssueCreditNoteDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.receiptsService.issueCreditNoteManually(dto.contractId, dto.source, user.id);
  }

  @Post(':id/void')
  // Wave 3 T2 (ปพพ.386 W-3): Receipt void restricted to OWNER / ACCOUNTANT /
  // BRANCH_MANAGER / FINANCE_MANAGER. SALES cannot void — fraud prevention.
  @Roles('OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  voidReceipt(
    @Param('id') id: string,
    @Body() dto: VoidReceiptDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.receiptsService.voidReceipt(
      id,
      dto.reason,
      user.id,
      dto.approvedById,
      user.role,
    );
  }

  @Post(':id/send-line')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  sendReceiptToCustomer(@Param('id') id: string) {
    return this.receiptsService.sendReceiptToCustomer(id);
  }

  @Get(':id/pdf')
  // D1.3.3.1 — ExportEnabledGuard short-circuits this endpoint with 403
  // when OWNER toggles SystemConfig `export_enabled` to 'false'.
  @UseGuards(ExportEnabledGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async getReceiptPDF(@Param('id') id: string, @Res() res: Response) {
    const pdf = await this.receiptsService.generatePDF(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${id}.pdf"`,
    });
    res.send(pdf);
  }
}
