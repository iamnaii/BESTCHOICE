import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PdfReportService } from './pdf-report.service';
import { PdfReportQueryDto } from './dto/pdf-report-query.dto';
import { UpdateRecipientsDto } from './dto/recipients.dto';
import { ExportEnabledGuard } from '../settings/guards/export-enabled.guard';

/**
 * Reporting endpoints (P3 D1 — PDF export + recipient management).
 * Class-level role gate: OWNER + FINANCE_MANAGER.
 * Recipient management is OWNER-only (per-method override).
 */
@ApiTags('Reporting')
@ApiBearerAuth('JWT')
@Controller('reporting')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'FINANCE_MANAGER')
export class ReportingController {
  constructor(private readonly pdfReport: PdfReportService) {}

  // -------- D1: PDF report --------

  @Post('pdf')
  // D1.3.3.1 — gated by ExportEnabledGuard (403 when export_enabled=false).
  @UseGuards(ExportEnabledGuard)
  async generatePdf(@Query() dto: PdfReportQueryDto, @Res() res: Response): Promise<void> {
    const to = dto.to ? new Date(dto.to) : new Date();
    const from = dto.from
      ? new Date(dto.from)
      : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('รูปแบบวันที่ไม่ถูกต้อง');
    }
    if (from.getTime() >= to.getTime()) {
      throw new BadRequestException('from ต้องมาก่อน to');
    }
    const pdf = await this.pdfReport.generate({ from, to });
    const filename = `collections-${to.toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length.toString());
    res.end(pdf);
  }

  @Get('recipients')
  @Roles('OWNER')
  async getRecipients(): Promise<{ recipients: string[] }> {
    const recipients = await this.pdfReport.getRecipients();
    return { recipients };
  }

  @Put('recipients')
  @Roles('OWNER')
  updateRecipients(@Body() dto: UpdateRecipientsDto): Promise<{ recipients: string[] }> {
    return this.pdfReport.setRecipients(dto.recipients);
  }
}
