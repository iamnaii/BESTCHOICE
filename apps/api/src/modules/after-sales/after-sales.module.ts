import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RepairTicketsModule } from '../repair-tickets/repair-tickets.module';
import { DefectExchangeModule } from '../defect-exchange/defect-exchange.module';
import { ContractExchangeModule } from '../contract-exchange/contract-exchange.module';
import { QualityControlModule } from '../quality-control/quality-control.module'; // exports ProductPhotosService แล้ว
import { AfterSalesController } from './after-sales.controller';
import { AfterSalesService } from './after-sales.service';
import { AfterSalesDocNumberService } from './services/after-sales-doc-number.service';
import { AfterSalesLookupService } from './services/after-sales-lookup.service';
import { AfterSalesCaseService } from './services/after-sales-case.service';
import { AfterSalesQueryService } from './services/after-sales-query.service';
import { AfterSalesRepairService } from './services/after-sales-repair.service';
import { AfterSalesExchangeService } from './services/after-sales-exchange.service';

@Module({
  imports: [
    AuditModule,
    RepairTicketsModule,
    DefectExchangeModule,
    ContractExchangeModule,
    QualityControlModule,
  ],
  controllers: [AfterSalesController],
  providers: [
    AfterSalesService,
    AfterSalesDocNumberService,
    AfterSalesLookupService,
    AfterSalesCaseService,
    AfterSalesQueryService,
    AfterSalesRepairService,
    AfterSalesExchangeService,
  ],
  exports: [AfterSalesService],
})
export class AfterSalesModule {}
