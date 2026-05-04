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
import { RepossessionJP5Template } from './cpa-templates/repossession-jp5.template';
import { RescheduleJP6Template } from './cpa-templates/reschedule-jp6.template';
import { VendorClearanceTemplate } from './cpa-templates/vendor-clearance.template';
import { Vat60dayMandatoryTemplate } from './cpa-templates/vat-60day-mandatory.template';
import { Vat60dayReversalTemplate } from './cpa-templates/vat-60day-reversal.template';
import { Vat60dayCron } from './cron/vat-60day.cron';

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
    RepossessionJP5Template,
    RescheduleJP6Template,
    VendorClearanceTemplate,
    Vat60dayMandatoryTemplate,
    Vat60dayReversalTemplate,
    Vat60dayCron,
  ],
  exports: [
    JournalService,
    JournalAutoService,
    ContractActivation1ATemplate,
    InstallmentAccrual2ATemplate,
    PaymentReceipt2BTemplate,
    PaymentReceipt2BSplitTemplate,
    EarlyPayoffJP4Template,
    RepossessionJP5Template,
    RescheduleJP6Template,
    VendorClearanceTemplate,
    Vat60dayMandatoryTemplate,
    Vat60dayReversalTemplate,
  ],
})
export class JournalModule {}
