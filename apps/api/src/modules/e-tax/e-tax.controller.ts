import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ETaxService } from './e-tax.service';

/**
 * e-Tax Invoice endpoints — Phase 1 (list + PDF + CSV).
 * Phase 2 = RD XML submission + digital signature (deferred per SP3 spec).
 */
@ApiTags('e-Tax')
@ApiBearerAuth('JWT')
@Controller('e-tax')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ETaxController {
  constructor(private readonly eTaxService: ETaxService) {}

  @Get('invoices')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  listInvoices(
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!companyId) throw new BadRequestException('กรุณาระบุบริษัท');
    const y = parseInt(year);
    const m = parseInt(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      throw new BadRequestException('ปี/เดือนไม่ถูกต้อง');
    }
    return this.eTaxService.listInvoices(
      companyId,
      y,
      m,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
    );
  }

  @Get('invoices/:paymentId/pdf')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async invoicePdf(@Param('paymentId') paymentId: string, @Res() res: Response): Promise<void> {
    const pdf = await this.eTaxService.generateInvoicePdf(paymentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="e-tax-${paymentId}.pdf"`);
    res.setHeader('Content-Length', pdf.length.toString());
    res.end(pdf);
  }

  @Get('export-csv')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async exportCsv(
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!companyId) throw new BadRequestException('กรุณาระบุบริษัท');
    const y = parseInt(year);
    const m = parseInt(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      throw new BadRequestException('ปี/เดือนไม่ถูกต้อง');
    }
    const csv = await this.eTaxService.exportCsv(companyId, y, m);
    const filename = `e-tax-${y}-${String(m).padStart(2, '0')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(csv);
  }
}
