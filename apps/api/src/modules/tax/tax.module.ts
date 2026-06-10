import { Module } from '@nestjs/common';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';
import { TaxPreviewService } from './services/tax-preview.service';
import { TaxReportService } from './services/tax-report.service';
import { TaxExportService } from './services/tax-export.service';

@Module({
  controllers: [TaxController],
  providers: [TaxService, TaxPreviewService, TaxReportService, TaxExportService],
  exports: [TaxService],
})
export class TaxModule {}
