import { Module } from '@nestjs/common';
import { AssetController } from './asset.controller';
import { AssetTransferController } from './asset-transfer.controller';
import { AssetJournalController } from './asset-journal.controller';
import { AssetReportsController } from './asset-reports.controller';
import { AssetService } from './asset.service';
import { AssetTransferService } from './asset-transfer.service';
import { AssetJournalService } from './asset-journal.service';
import { AssetReportsService } from './asset-reports.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  controllers: [
    AssetController,
    AssetTransferController,
    AssetJournalController,
    AssetReportsController,
  ],
  providers: [
    AssetService,
    AssetTransferService,
    AssetJournalService,
    AssetReportsService,
  ],
  exports: [
    AssetService,
    AssetTransferService,
    AssetJournalService,
    AssetReportsService,
  ],
})
export class AssetModule {}
