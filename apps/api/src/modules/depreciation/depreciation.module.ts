import { Module } from '@nestjs/common';
import { DepreciationService } from './depreciation.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  providers: [DepreciationService],
  exports: [DepreciationService],
})
export class DepreciationModule {}
