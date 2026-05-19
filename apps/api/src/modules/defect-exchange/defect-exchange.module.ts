import { Module } from '@nestjs/common';
import { DefectExchangeController } from './defect-exchange.controller';
import { DefectExchangeService } from './defect-exchange.service';
import { JournalModule } from '../journal/journal.module';
import { RepairTicketsModule } from '../repair-tickets/repair-tickets.module';

@Module({
  imports: [JournalModule, RepairTicketsModule],
  controllers: [DefectExchangeController],
  providers: [DefectExchangeService],
  exports: [DefectExchangeService],
})
export class DefectExchangeModule {}
