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
import { BadDebtProvisionTemplate } from './cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from './cpa-templates/bad-debt-writeoff.template';
import { EclStageReverseTemplate } from './cpa-templates/ecl-stage-reverse.template';
import { ExpenseTemplate } from './cpa-templates/expense.template';
import { ExpenseReverseTemplate } from './cpa-templates/expense-reverse.template';
import { ExpenseClearanceTemplate } from './cpa-templates/expense-clearance.template';
import { DefectExchangeReversalTemplate } from './cpa-templates/defect-exchange-reversal.template';
import { ReceiptVoidReversalTemplate } from './cpa-templates/receipt-void-reversal.template';
import { DepreciationTemplate } from './cpa-templates/depreciation.template';
import { AssetDisposalTemplate } from './cpa-templates/asset-disposal.template';
import { AssetPurchaseTemplate } from './cpa-templates/asset-purchase.template';
import { AssetPurchaseReverseTemplate } from './cpa-templates/asset-purchase-reverse.template';
import { AssetDisposalReverseTemplate } from './cpa-templates/asset-disposal-reverse.template';
import { DepreciationReverseTemplate } from './cpa-templates/depreciation-reverse.template';
import { DepreciationCron } from './cron/depreciation.cron';
import { WhtAccrualTemplate } from './cpa-templates/wht-accrual.template';
import { WhtRemittanceTemplate } from './cpa-templates/wht-remittance.template';

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
    BadDebtProvisionTemplate,
    BadDebtWriteOffTemplate,
    EclStageReverseTemplate,
    ExpenseTemplate,
    ExpenseReverseTemplate,
    ExpenseClearanceTemplate,
    DefectExchangeReversalTemplate,
    ReceiptVoidReversalTemplate,
    DepreciationTemplate,
    AssetDisposalTemplate,
    AssetPurchaseTemplate,
    AssetPurchaseReverseTemplate,
    AssetDisposalReverseTemplate,
    DepreciationReverseTemplate,
    DepreciationCron,
    WhtAccrualTemplate,
    WhtRemittanceTemplate,
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
    BadDebtProvisionTemplate,
    BadDebtWriteOffTemplate,
    EclStageReverseTemplate,
    ExpenseTemplate,
    ExpenseReverseTemplate,
    ExpenseClearanceTemplate,
    DefectExchangeReversalTemplate,
    ReceiptVoidReversalTemplate,
    DepreciationTemplate,
    AssetDisposalTemplate,
    AssetPurchaseTemplate,
    AssetPurchaseReverseTemplate,
    AssetDisposalReverseTemplate,
    DepreciationReverseTemplate,
    WhtAccrualTemplate,
    WhtRemittanceTemplate,
  ],
})
export class JournalModule {}
