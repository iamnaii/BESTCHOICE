import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractWorkflowService } from './contract-workflow.service';
import { ContractPaymentService } from './contract-payment.service';
import { ContractDocumentService } from './contract-document.service';
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

@Module({
  imports: [NotificationsModule, OcrModule, SettingsModule, JournalModule, ProductsModule, WarrantyModule],
  controllers: [ContractsController, ContractDocumentsController, DocumentsController],
  providers: [ContractsService, ContractWorkflowService, ContractPaymentService, ContractDocumentService, ContractDocumentsService, DocumentsService, GhostSaleCron],
  exports: [ContractsService, ContractWorkflowService, ContractPaymentService, ContractDocumentService, ContractDocumentsService, DocumentsService],
})
export class ContractsModule {}
