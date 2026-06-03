import { Module } from '@nestjs/common';
import { AssetController } from './asset.controller';
import { AssetTransferController } from './asset-transfer.controller';
import { AssetJournalController } from './asset-journal.controller';
import { AssetReportsController } from './asset-reports.controller';
import { AssetService } from './asset.service';
import { AssetTransferService } from './asset-transfer.service';
import { AssetJournalService } from './asset-journal.service';
import { AssetReportsService } from './asset-reports.service';
import { AssetReceiptPdfService } from './services/asset-receipt-pdf.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  // CRITICAL ordering: AssetJournalController MUST be registered before
  // AssetController. AssetController has `@Get(':id')` which path-to-regexp
  // matches /assets/journal with id='journal' — without this ordering,
  // findOne('journal') throws NotFoundException → 404 and the JV page is
  // permanently broken. NestJS uses Express's first-match routing so the
  // more-specific 'assets/journal' must be added to the router first.
  controllers: [
    AssetJournalController,
    AssetController,
    AssetTransferController,
    AssetReportsController,
  ],
  providers: [
    AssetService,
    AssetTransferService,
    AssetJournalService,
    AssetReportsService,
    AssetReceiptPdfService,
  ],
  exports: [
    AssetService,
    AssetTransferService,
    AssetJournalService,
    AssetReportsService,
  ],
})
export class AssetModule {}
