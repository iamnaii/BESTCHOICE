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

@Module({
  imports: [
    PrismaModule,
    LineOaModule,
    IntegrationsModule,
    forwardRef(() => ShopOrdersModule),
    ProductsModule,
    JournalModule,
    forwardRef(() => PaymentsModule),
  ],
  controllers: [PaySolutionsController],
  providers: [PaySolutionsService, LiffTokenGuard, PartialPaymentExpireCron],
  exports: [PaySolutionsService],
})
export class PaySolutionsModule {}
