import { Module } from '@nestjs/common';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';
import { JournalAutoService } from './journal-auto.service';
import { AccountRoleService } from './account-role.service';
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
import { DefectExchangeReversalTemplate } from './cpa-templates/defect-exchange-reversal.template';
import { ReceiptVoidReversalTemplate } from './cpa-templates/receipt-void-reversal.template';
import { DepreciationTemplate } from './cpa-templates/depreciation.template';
import { AssetDisposalTemplate } from './cpa-templates/asset-disposal.template';
import { AssetPurchaseTemplate } from './cpa-templates/asset-purchase.template';
import { AssetPurchaseReverseTemplate } from './cpa-templates/asset-purchase-reverse.template';
import { AssetInvoiceReceivedTemplate } from './cpa-templates/asset-invoice-received.template';
import { AssetDisposalReverseTemplate } from './cpa-templates/asset-disposal-reverse.template';
import { DepreciationReverseTemplate } from './cpa-templates/depreciation-reverse.template';
import { DepreciationCron } from './cron/depreciation.cron';
import { WhtAccrualTemplate } from './cpa-templates/wht-accrual.template';
import { WhtRemittanceTemplate } from './cpa-templates/wht-remittance.template';
import { ExpenseSameDayTemplate } from './cpa-templates/expense-same-day.template';
import { ExpenseAccrualTemplate } from './cpa-templates/expense-accrual.template';
import { CreditNoteTemplate } from './cpa-templates/credit-note.template';
import { PayrollTemplate } from './cpa-templates/payroll.template';
import { VendorSettlementTemplate } from './cpa-templates/vendor-settlement.template';
import { PettyCashTemplate } from './cpa-templates/petty-cash.template';
import { YearEndClosingTemplate } from './cpa-templates/year-end-closing.template';
// P3-SP5 — SHOP-side accounting
import { CompanyResolverService } from './company-resolver.service';
import { PairedJournalService } from './paired-journal.service';
import { ShopCashSaleTemplate } from './cpa-templates/shop-cash-sale.template';
import { ShopDownPaymentTemplate } from './cpa-templates/shop-down-payment.template';
import { ShopDownPaymentReversalTemplate } from './cpa-templates/shop-down-payment-reversal.template';
import { ShopFinanceReceiptTemplate } from './cpa-templates/shop-finance-receipt.template';
import { ShopTradeInTemplate } from './cpa-templates/shop-trade-in.template';
import { ShopExpenseTemplate } from './cpa-templates/shop-expense.template';
import { ShopInventoryTransferTemplate } from './cpa-templates/shop-inventory-transfer.template';

@Module({
  imports: [PrismaModule],
  controllers: [JournalController],
  providers: [
    JournalService,
    JournalAutoService,
    AccountRoleService,
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
    DefectExchangeReversalTemplate,
    ReceiptVoidReversalTemplate,
    DepreciationTemplate,
    AssetDisposalTemplate,
    AssetPurchaseTemplate,
    AssetPurchaseReverseTemplate,
    AssetInvoiceReceivedTemplate,
    AssetDisposalReverseTemplate,
    DepreciationReverseTemplate,
    DepreciationCron,
    WhtAccrualTemplate,
    WhtRemittanceTemplate,
    ExpenseSameDayTemplate,
    ExpenseAccrualTemplate,
    CreditNoteTemplate,
    PayrollTemplate,
    VendorSettlementTemplate,
    PettyCashTemplate,
    YearEndClosingTemplate,
    // P3-SP5 — SHOP-side accounting
    CompanyResolverService,
    PairedJournalService,
    ShopCashSaleTemplate,
    ShopDownPaymentTemplate,
    ShopDownPaymentReversalTemplate,
    ShopFinanceReceiptTemplate,
    ShopTradeInTemplate,
    ShopExpenseTemplate,
    ShopInventoryTransferTemplate,
  ],
  exports: [
    JournalService,
    JournalAutoService,
    AccountRoleService,
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
    DefectExchangeReversalTemplate,
    ReceiptVoidReversalTemplate,
    DepreciationTemplate,
    AssetDisposalTemplate,
    AssetPurchaseTemplate,
    AssetPurchaseReverseTemplate,
    AssetInvoiceReceivedTemplate,
    AssetDisposalReverseTemplate,
    DepreciationReverseTemplate,
    WhtAccrualTemplate,
    WhtRemittanceTemplate,
    ExpenseSameDayTemplate,
    ExpenseAccrualTemplate,
    CreditNoteTemplate,
    PayrollTemplate,
    VendorSettlementTemplate,
    PettyCashTemplate,
    YearEndClosingTemplate,
    // P3-SP5 — SHOP-side accounting
    CompanyResolverService,
    PairedJournalService,
    ShopCashSaleTemplate,
    ShopDownPaymentTemplate,
    ShopDownPaymentReversalTemplate,
    ShopFinanceReceiptTemplate,
    ShopTradeInTemplate,
    ShopExpenseTemplate,
    ShopInventoryTransferTemplate,
  ],
})
export class JournalModule {}
