import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { TaxFormCode, TaxService } from './tax.service';
import { GenerateTaxReportDto } from './dto/tax.dto';
import { PayrollRemitDto } from './dto/payroll-remit.dto';
import { PayrollRemittanceTemplate } from '../journal/cpa-templates/payroll-remittance.template';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { EntityScope } from './tax-entity.util';

@ApiTags('Tax')
@ApiBearerAuth('JWT')
@Controller('tax')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class TaxController {
  constructor(
    private taxService: TaxService,
    private payrollRemit: PayrollRemittanceTemplate,
  ) {}

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findAll(
    @Req() req: Request,
    @Query('companyId') companyId?: string,
    @Query('reportType') reportType?: string,
    @Query('year') year?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.taxService.findAll(
      companyId,
      reportType,
      year ? parseInt(year) : undefined,
      status,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
      req.entityScope as EntityScope | undefined,
    );
  }

  @Get('pp30-preview')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  previewPP30(
    @Req() req: Request,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.taxService.previewPP30(
      companyId,
      parseInt(year),
      parseInt(month),
      req.entityScope as EntityScope | undefined,
    );
  }

  @Get('pnd1-preview')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  previewPND1(
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.taxService.previewPND1(companyId, parseInt(year), parseInt(month));
  }

  @Get('pnd3-preview')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  previewPND3(
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.taxService.previewPND3(companyId, parseInt(year), parseInt(month));
  }

  @Get('pnd53-preview')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  previewPND53(
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.taxService.previewPND53(companyId, parseInt(year), parseInt(month));
  }

  // ── Payroll round 2 (2026-08-06) — สปส.1-10 + ภ.ง.ด.1ก + นำส่ง ────────────
  // Company-wide (นิติบุคคลเดียว ยื่นรวม) — no companyId param.

  @Get('sso-1-10-preview')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  previewSso110(@Query('year') year: string, @Query('month') month: string) {
    const y = parseInt(year);
    const m = parseInt(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      throw new BadRequestException('ปี/เดือนไม่ถูกต้อง');
    }
    return this.taxService.previewSso110(y, m);
  }

  @Get('pnd1-annual-preview')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  previewPnd1Annual(@Query('year') year: string) {
    const y = parseInt(year);
    if (!Number.isInteger(y) || y < 2020 || y > 2100) {
      throw new BadRequestException('ปีไม่ถูกต้อง (ค.ศ.)');
    }
    return this.taxService.previewPnd1Annual(y);
  }

  // ภ.ง.ด.2 — หัก ณ ที่จ่ายเงินปันผล (ม.50(2)) จากเอกสาร equity DIV_PAY
  @Get('pnd2-preview')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  previewPnd2(@Query('year') year: string, @Query('month') month: string) {
    const y = parseInt(year);
    const m = parseInt(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      throw new BadRequestException('ปี/เดือนไม่ถูกต้อง');
    }
    return this.taxService.previewPnd2(y, m);
  }

  // นำส่ง = โพสต์ JE ล้างเจ้าหนี้จริง — จำกัด OWNER/FINANCE_MANAGER (จ่ายเงินออก)
  @Post('payroll-remit/sso')
  @Roles('OWNER', 'FINANCE_MANAGER')
  remitSso(@Body() dto: PayrollRemitDto) {
    return this.payrollRemit.executeSso({
      scope: dto.scope,
      period: dto.period,
      depositAccountCode: dto.depositAccountCode,
      payDate: dto.payDate ? new Date(dto.payDate) : undefined,
    });
  }

  @Post('payroll-remit/pnd1')
  @Roles('OWNER', 'FINANCE_MANAGER')
  remitPnd1(@Body() dto: PayrollRemitDto) {
    return this.payrollRemit.executePnd1({
      scope: dto.scope,
      period: dto.period,
      depositAccountCode: dto.depositAccountCode,
      payDate: dto.payDate ? new Date(dto.payDate) : undefined,
    });
  }

  @Get('export-xlsx')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async exportXlsx(
    @Query('form') form: string,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @Res() res: Response,
  ): Promise<void> {
    const ALLOWED: TaxFormCode[] = ['PP30', 'PND1', 'PND3', 'PND53', 'SSO110', 'PND1A', 'PND2'];
    if (!ALLOWED.includes(form as TaxFormCode)) {
      throw new BadRequestException('รูปแบบฟอร์มภาษีไม่ถูกต้อง');
    }
    // SSO110/PND1A/PND2 are company-wide (นิติบุคคลเดียว); PND1A is annual (no month).
    const companyWide = form === 'SSO110' || form === 'PND1A' || form === 'PND2';
    if (!companyWide && !companyId) throw new BadRequestException('กรุณาระบุบริษัท');
    const y = parseInt(year);
    const m = form === 'PND1A' ? 0 : parseInt(month);
    if (!Number.isInteger(y) || (form !== 'PND1A' && (!Number.isInteger(m) || m < 1 || m > 12))) {
      throw new BadRequestException('ปี/เดือนไม่ถูกต้อง');
    }
    const buffer = await this.taxService.exportTaxFormXlsx(
      form as TaxFormCode,
      companyId ?? '',
      y,
      m,
    );
    const filename =
      form === 'PND1A' ? `PND1A-${y}.xlsx` : `${form}-${y}-${String(m).padStart(2, '0')}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.end(buffer);
  }

  @Get(':id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.taxService.findOne(id);
  }

  @Post('generate')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  generate(
    @Body() dto: GenerateTaxReportDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.taxService.generate(dto, userId, req.entityScope as EntityScope | undefined);
  }

  @Patch(':id/submit')
  @Roles('OWNER', 'FINANCE_MANAGER')
  submit(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.taxService.submit(id, userId);
  }
}
