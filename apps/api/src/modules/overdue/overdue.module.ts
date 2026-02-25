import { Module } from '@nestjs/common';
import { OverdueController } from './overdue.controller';
import { OverdueService } from './overdue.service';

@Module({
  controllers: [OverdueController],
  providers: [OverdueService],
  exports: [OverdueService],
})
export class OverdueModule {}
