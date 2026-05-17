import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { TaxFormCode, TaxService } from './tax.service';
import { GenerateTaxReportDto } from './dto/tax.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Tax')
@ApiBearerAuth('JWT')
@Controller('tax')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class TaxController {
  constructor(private taxService: TaxService) {}

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findAll(
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
    );
  }

  @Get('pp30-preview')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  previewPP30(
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.taxService.previewPP30(companyId, parseInt(year), parseInt(month));
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

  @Get('export-xlsx')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async exportXlsx(
    @Query('form') form: string,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @Res() res: Response,
  ): Promise<void> {
    const ALLOWED: TaxFormCode[] = ['PP30', 'PND1', 'PND3', 'PND53'];
    if (!ALLOWED.includes(form as TaxFormCode)) {
      throw new BadRequestException('รูปแบบฟอร์มภาษีไม่ถูกต้อง');
    }
    if (!companyId) throw new BadRequestException('กรุณาระบุบริษัท');
    const y = parseInt(year);
    const m = parseInt(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      throw new BadRequestException('ปี/เดือนไม่ถูกต้อง');
    }
    const buffer = await this.taxService.exportTaxFormXlsx(
      form as TaxFormCode,
      companyId,
      y,
      m,
    );
    const filename = `${form}-${y}-${String(m).padStart(2, '0')}.xlsx`;
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
  generate(@Body() dto: GenerateTaxReportDto, @CurrentUser('id') userId: string) {
    return this.taxService.generate(dto, userId);
  }

  @Patch(':id/submit')
  @Roles('OWNER', 'FINANCE_MANAGER')
  submit(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.taxService.submit(id, userId);
  }
}
