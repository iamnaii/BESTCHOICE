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
import { NotificationsModule } from '../notifications/notifications.module';
import { OcrModule } from '../ocr/ocr.module';
import { SettingsModule } from '../settings/settings.module';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [NotificationsModule, OcrModule, SettingsModule, JournalModule],
  controllers: [ContractsController, ContractDocumentsController, DocumentsController],
  providers: [ContractsService, ContractWorkflowService, ContractPaymentService, ContractDocumentService, ContractDocumentsService, DocumentsService],
  exports: [ContractsService, ContractWorkflowService, ContractPaymentService, ContractDocumentService, ContractDocumentsService, DocumentsService],
})
export class ContractsModule {}
