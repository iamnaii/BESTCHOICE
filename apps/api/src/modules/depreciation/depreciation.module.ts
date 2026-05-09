import { Module } from '@nestjs/common';
import { DepreciationService } from './depreciation.service';
import { DepreciationController } from './depreciation.controller';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  controllers: [DepreciationController],
  providers: [DepreciationService],
  exports: [DepreciationService],
})
export class DepreciationModule {}
