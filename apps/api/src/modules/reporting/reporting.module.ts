import { Module } from '@nestjs/common';
import { ReportingController } from './reporting.controller';
import { ComplianceController } from './compliance.controller';
import { PdfReportService } from './pdf-report.service';
import { ComplianceService } from './compliance.service';
import { PdfReportWeeklyCron } from './pdf-report-weekly.cron';
import { OverdueModule } from '../overdue/overdue.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [OverdueModule, EmailModule],
  controllers: [ReportingController, ComplianceController],
  providers: [PdfReportService, ComplianceService, PdfReportWeeklyCron],
  exports: [PdfReportService, ComplianceService],
})
export class ReportingModule {}
