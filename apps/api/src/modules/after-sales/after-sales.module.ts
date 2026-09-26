import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RepairTicketsModule } from '../repair-tickets/repair-tickets.module';
import { DefectExchangeModule } from '../defect-exchange/defect-exchange.module';
import { ContractExchangeModule } from '../contract-exchange/contract-exchange.module';
import { QualityControlModule } from '../quality-control/quality-control.module'; // exports ProductPhotosService แล้ว
import { NotificationsModule } from '../notifications/notifications.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AfterSalesController } from './after-sales.controller';
import { AfterSalesService } from './after-sales.service';
import { AfterSalesDocNumberService } from './services/after-sales-doc-number.service';
import { AfterSalesLookupService } from './services/after-sales-lookup.service';
import { AfterSalesCaseService } from './services/after-sales-case.service';
import { AfterSalesQueryService } from './services/after-sales-query.service';
import { AfterSalesRepairService } from './services/after-sales-repair.service';
import { AfterSalesExchangeService } from './services/after-sales-exchange.service';
import { AfterSalesLineService } from './services/after-sales-line.service';
import { AfterSalesLineCron } from './crons/after-sales-line.cron';
import { AfterSalesDocumentService } from './services/after-sales-document.service';
import { AfterSalesPdfRenderer } from './documents/after-sales-pdf.renderer';

@Module({
  imports: [
    AuditModule,
    RepairTicketsModule,
    DefectExchangeModule,
    ContractExchangeModule,
    QualityControlModule,
    NotificationsModule,
    IntegrationsModule,
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
    AfterSalesLineService,
    AfterSalesLineCron,
    AfterSalesDocumentService,
    AfterSalesPdfRenderer,
  ],
  exports: [AfterSalesService, AfterSalesLineService],
})
export class AfterSalesModule {}
