import { Module } from '@nestjs/common';
import { LegalCaseController } from './legal-case.controller';
import { LegalCaseService } from './legal-case.service';

@Module({
  controllers: [LegalCaseController],
  providers: [LegalCaseService],
  exports: [LegalCaseService],
})
export class LegalCaseModule {}
