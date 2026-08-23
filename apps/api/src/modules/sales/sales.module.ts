import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { InterCompanyModule } from '../inter-company/inter-company.module';
import { JournalModule } from '../journal/journal.module';
import { SaleVoidService } from './services/sale-void.service';

@Module({
  imports: [InterCompanyModule, JournalModule],
  controllers: [SalesController],
  providers: [SalesService, SaleVoidService],
  exports: [SalesService, SaleVoidService],
})
export class SalesModule {}
