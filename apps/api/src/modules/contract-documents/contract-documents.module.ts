import { Module } from '@nestjs/common';
import { ContractDocumentsController } from './contract-documents.controller';
import { ContractDocumentsService } from './contract-documents.service';

@Module({
  controllers: [ContractDocumentsController],
  providers: [ContractDocumentsService],
  exports: [ContractDocumentsService],
})
export class ContractDocumentsModule {}
