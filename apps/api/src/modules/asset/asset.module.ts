import { Module } from '@nestjs/common';
import { AssetController } from './asset.controller';
import { AssetTransferController } from './asset-transfer.controller';
import { AssetService } from './asset.service';
import { AssetTransferService } from './asset-transfer.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  controllers: [AssetController, AssetTransferController],
  providers: [AssetService, AssetTransferService],
  exports: [AssetService, AssetTransferService],
})
export class AssetModule {}
