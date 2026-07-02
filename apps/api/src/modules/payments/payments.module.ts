import { Module, forwardRef } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
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
  controllers: [PaymentsController],
  providers: [PaymentsService, RescheduleCollectService],
  exports: [PaymentsService, RescheduleCollectService],
})
export class PaymentsModule {}
