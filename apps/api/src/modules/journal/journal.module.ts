import { Module } from '@nestjs/common';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';
import { JournalAutoService } from './journal-auto.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ContractActivation1ATemplate } from './cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './cpa-templates/installment-accrual-2a.template';
import { InstallmentAccrualCron } from './cron/installment-accrual.cron';
import { PaymentReceipt2BTemplate } from './cpa-templates/payment-receipt-2b.template';
import { PaymentReceipt2BSplitTemplate } from './cpa-templates/payment-receipt-2b-split.template';
import { EarlyPayoffJP4Template } from './cpa-templates/early-payoff-jp4.template';

@Module({
  imports: [PrismaModule],
  controllers: [JournalController],
  providers: [
    JournalService,
    JournalAutoService,
    ContractActivation1ATemplate,
    InstallmentAccrual2ATemplate,
    InstallmentAccrualCron,
    PaymentReceipt2BTemplate,
    PaymentReceipt2BSplitTemplate,
    EarlyPayoffJP4Template,
  ],
  exports: [
    JournalService,
    JournalAutoService,
    ContractActivation1ATemplate,
    InstallmentAccrual2ATemplate,
    PaymentReceipt2BTemplate,
    PaymentReceipt2BSplitTemplate,
    EarlyPayoffJP4Template,
  ],
})
export class JournalModule {}
