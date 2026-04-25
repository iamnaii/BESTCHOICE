import { Module } from '@nestjs/common';
import { ReportingController } from './reporting.controller';
import { PdfReportService } from './pdf-report.service';
import { PdfReportWeeklyCron } from './pdf-report-weekly.cron';
import { OverdueModule } from '../overdue/overdue.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [OverdueModule, EmailModule],
  controllers: [ReportingController],
  providers: [PdfReportService, PdfReportWeeklyCron],
  exports: [PdfReportService],
})
export class ReportingModule {}
