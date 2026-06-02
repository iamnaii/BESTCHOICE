import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractWorkflowService } from './contract-workflow.service';
import { ContractPaymentService } from './contract-payment.service';
import { ContractDocumentService } from './contract-document.service';
import { ContractSnapshotService } from './contract-snapshot.service';
import { ContractDocumentsController } from './contract-documents.controller';
import { ContractDocumentsService } from './contract-documents.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { GhostSaleCron } from './crons/ghost-sale.cron';
import { NotificationsModule } from '../notifications/notifications.module';
import { OcrModule } from '../ocr/ocr.module';
import { SettingsModule } from '../settings/settings.module';
import { JournalModule } from '../journal/journal.module';
import { ProductsModule } from '../products/products.module';
import { WarrantyModule } from '../warranty/warranty.module';
import { ContractExchangeModule } from '../contract-exchange/contract-exchange.module';
import { TestModeModule } from '../test-mode/test-mode.module';

@Module({
  imports: [
    NotificationsModule,
    OcrModule,
    SettingsModule,
    JournalModule,
    ProductsModule,
    WarrantyModule,
    // SP2 sign-then-activate: ContractWorkflowService.activate() branches to
    // ContractExchangeService.finalizeAfterActivation() when the contract
    // being activated has exchangedFromContractId. No circular dep because
    // ContractExchangeModule only depends on Prisma + Audit (global) + Journal.
    ContractExchangeModule,
    // Test-mode bypass: skips the contract-side credit-check gates when the
    // OWNER toggle is on. TestModeModule depends only on global Prisma → no
    // circular dependency with ContractsModule.
    TestModeModule,
  ],
  controllers: [ContractsController, ContractDocumentsController, DocumentsController],
  providers: [ContractsService, ContractWorkflowService, ContractPaymentService, ContractDocumentService, ContractSnapshotService, ContractDocumentsService, DocumentsService, GhostSaleCron],
  exports: [ContractsService, ContractWorkflowService, ContractPaymentService, ContractDocumentService, ContractSnapshotService, ContractDocumentsService, DocumentsService],
})
export class ContractsModule {}
