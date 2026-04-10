import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ReceiptsModule } from '../receipts/receipts.module';
import { JournalModule } from '../journal/journal.module';
import { ProductsModule } from '../products/products.module';
import { LineOaModule } from '../line-oa/line-oa.module';

@Module({
  imports: [ReceiptsModule, JournalModule, ProductsModule, LineOaModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
