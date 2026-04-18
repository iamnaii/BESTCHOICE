import { Module } from '@nestjs/common';
import { DefectExchangeController } from './defect-exchange.controller';
import { DefectExchangeService } from './defect-exchange.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  controllers: [DefectExchangeController],
  providers: [DefectExchangeService],
  exports: [DefectExchangeService],
})
export class DefectExchangeModule {}
