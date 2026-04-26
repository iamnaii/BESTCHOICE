import { Module } from '@nestjs/common';
import { RepossessionsController } from './repossessions.controller';
import { RepossessionsService } from './repossessions.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  controllers: [RepossessionsController],
  providers: [RepossessionsService],
  exports: [RepossessionsService],
})
export class RepossessionsModule {}
