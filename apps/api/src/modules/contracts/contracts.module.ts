import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractWorkflowService } from './contract-workflow.service';
import { ContractPaymentService } from './contract-payment.service';
import { ContractDocumentService } from './contract-document.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ContractsController],
  providers: [ContractsService, ContractWorkflowService, ContractPaymentService, ContractDocumentService],
  exports: [ContractsService, ContractWorkflowService, ContractPaymentService, ContractDocumentService],
})
export class ContractsModule {}
