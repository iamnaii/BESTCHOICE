import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PaySolutionsController } from './paysolutions.controller';
import { PaySolutionsService } from './paysolutions.service';
import { PartialPaymentExpireCron } from './partial-payment-expire.cron';
import { LiffTokenGuard } from '../line-oa/guards/liff-token.guard';
import { ShopOrdersModule } from '../shop-orders/shop-orders.module';
import { ProductsModule } from '../products/products.module';
import { JournalModule } from '../journal/journal.module';
import { PaymentsModule } from '../payments/payments.module';
import { AccountingModule } from '../accounting/accounting.module';

// No forwardRef needed for AccountingModule: its own import chain (JournalModule,
// TaxModule, PeakModule, ConsecutiveMissedModule, ReceiptsModule — see
// accounting.module.ts) never imports PaySolutionsModule or PaymentsModule, so
// this edge is acyclic (verified 2026-07-30, fix/qr-ecl-release).
@Module({
  imports: [
    PrismaModule,
    LineOaModule,
    IntegrationsModule,
    forwardRef(() => ShopOrdersModule),
    ProductsModule,
    JournalModule,
    AccountingModule,
    forwardRef(() => PaymentsModule),
  ],
  controllers: [PaySolutionsController],
  providers: [PaySolutionsService, LiffTokenGuard, PartialPaymentExpireCron],
  exports: [PaySolutionsService],
})
export class PaySolutionsModule {}
