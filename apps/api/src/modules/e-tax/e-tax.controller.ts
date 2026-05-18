import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ETaxService } from './e-tax.service';

/** Express Request augmented with JWT user info (set by JwtAuthGuard) */
type AuthRequest = Request & {
  user?: { id: string; role: string; branchId?: string | null };
};

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
    @Req() req: AuthRequest,
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
      req.user ? { role: req.user.role, branchId: req.user.branchId } : undefined,
    );
  }

  // Critical #5: Phase 1 PDF is a RECEIPT, not a legal tax invoice.
  // File name uses 'receipt-' prefix (#6+#7). Endpoint requires the
  // requesting user so the service can scope by accessible branches —
  // prevents PII leak where any auth user could fetch any payment.
  @Get('invoices/:paymentId/pdf')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async invoicePdf(
    @Param('paymentId') paymentId: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ): Promise<void> {
    if (!req.user) throw new BadRequestException('กรุณาเข้าสู่ระบบ');
    const pdf = await this.eTaxService.generateInvoicePdf(paymentId, {
      role: req.user.role,
      branchId: req.user.branchId,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${paymentId}.pdf"`);
    res.setHeader('Content-Length', pdf.length.toString());
    res.end(pdf);
  }

  @Get('export-csv')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async exportCsv(
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ): Promise<void> {
    if (!companyId) throw new BadRequestException('กรุณาระบุบริษัท');
    const y = parseInt(year);
    const m = parseInt(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      throw new BadRequestException('ปี/เดือนไม่ถูกต้อง');
    }
    const csv = await this.eTaxService.exportCsv(
      companyId,
      y,
      m,
      req.user ? { role: req.user.role, branchId: req.user.branchId } : undefined,
    );
    const filename = `e-tax-${y}-${String(m).padStart(2, '0')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(csv);
  }
}
