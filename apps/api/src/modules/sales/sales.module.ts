import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { InterCompanyModule } from '../inter-company/inter-company.module';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [InterCompanyModule, JournalModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
