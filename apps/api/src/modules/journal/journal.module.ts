import { Module } from '@nestjs/common';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';
import { JournalAutoService } from './journal-auto.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ContractActivation1ATemplate } from './cpa-templates/contract-activation-1a.template';

@Module({
  imports: [PrismaModule],
  controllers: [JournalController],
  providers: [JournalService, JournalAutoService, ContractActivation1ATemplate],
  exports: [JournalService, JournalAutoService, ContractActivation1ATemplate],
})
export class JournalModule {}
