import { Module, forwardRef } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ReceiptsModule } from '../receipts/receipts.module';
import { JournalModule } from '../journal/journal.module';
import { ProductsModule } from '../products/products.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { MdmModule } from '../mdm/mdm.module';
import { OverdueModule } from '../overdue/overdue.module';
import { PaySolutionsModule } from '../paysolutions/paysolutions.module';
import { InstallmentsModule } from '../installments/installments.module';

@Module({
  imports: [
    ReceiptsModule,
    JournalModule,
    ProductsModule,
    LineOaModule,
    MdmModule,
    InstallmentsModule,
    forwardRef(() => OverdueModule),
    forwardRef(() => PaySolutionsModule),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
