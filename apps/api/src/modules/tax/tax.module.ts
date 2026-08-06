import { Module } from '@nestjs/common';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';
import { TaxPreviewService } from './services/tax-preview.service';
import { TaxReportService } from './services/tax-report.service';
import { TaxExportService } from './services/tax-export.service';
// Payroll round 2 (2026-08-06) — PayrollRemittanceTemplate (นำส่ง ปกส./ภ.ง.ด.1)
// is provided+exported by JournalModule.
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  controllers: [TaxController],
  providers: [TaxService, TaxPreviewService, TaxReportService, TaxExportService],
  exports: [TaxService],
})
export class TaxModule {}
