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
import { ReceiptsModule } from '../receipts/receipts.module';
import { ContractsModule } from '../contracts/contracts.module';

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
    // PR3: ใบเสร็จของเงินที่เข้าทางลิงก์ชำระ — PaySolutionsService รับ ReceiptsService แบบ forwardRef
    forwardRef(() => ReceiptsModule),
    // Task 41: ContractPaymentService (ยอดปิดของ server ตอนสร้าง intent ปิดยอด + ลง JP4 ใน webhook) — forwardRef เพราะ ContractsModule →
    // ReceiptsModule → LineOaModule → ContractsModule และ PaymentsModule import ทั้งสองโมดูล
    forwardRef(() => ContractsModule),
  ],
  controllers: [PaySolutionsController],
  providers: [PaySolutionsService, LiffTokenGuard, PartialPaymentExpireCron],
  exports: [PaySolutionsService],
})
export class PaySolutionsModule {}
