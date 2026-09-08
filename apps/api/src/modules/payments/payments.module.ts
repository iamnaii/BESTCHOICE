import { Module, forwardRef } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentApprovalController } from './payment-approval.controller';
import { ContractsModule } from '../contracts/contracts.module';
import { PaymentsApprovalSettingsController } from './payments-approval-settings.controller';
import { PaymentApprovalSettingsService } from './services/payment-approval-settings.service';
import { PaymentsService } from './payments.service';
import { RescheduleCollectService } from './services/reschedule-collect.service';
import { ReceiptsModule } from '../receipts/receipts.module';
import { JournalModule } from '../journal/journal.module';
import { ProductsModule } from '../products/products.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { MdmModule } from '../mdm/mdm.module';
import { OverdueModule } from '../overdue/overdue.module';
import { PaySolutionsModule } from '../paysolutions/paysolutions.module';
import { InstallmentsModule } from '../installments/installments.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [
    forwardRef(() => ContractsModule),
    ReceiptsModule,
    JournalModule,
    ProductsModule,
    LineOaModule,
    MdmModule,
    InstallmentsModule,
    AccountingModule,
    forwardRef(() => OverdueModule),
    forwardRef(() => PaySolutionsModule),
  ],
  controllers: [PaymentsApprovalSettingsController, PaymentApprovalController, PaymentsController],
  providers: [PaymentsService, RescheduleCollectService, PaymentApprovalSettingsService],
  exports: [PaymentsService, RescheduleCollectService],
})
export class PaymentsModule {}
