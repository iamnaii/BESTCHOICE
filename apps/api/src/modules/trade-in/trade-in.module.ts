import { Module } from '@nestjs/common';
import { TradeInController } from './trade-in.controller';
import { TradeInService } from './trade-in.service';
import { TradeInVoucherService } from './services/voucher.service';
import { BuybackQuestionAdminService } from './services/buyback-question-admin.service';
import { OnlineAppraisalService } from './services/online-appraisal.service';
import { ContactsModule } from '../contacts/contacts.module';
import { CustomerPiiModule } from '../customers/customer-pii.module';
import { JournalModule } from '../journal/journal.module';
import { ShopBuybackModule } from '../shop-buyback/shop-buyback.module';

@Module({
  imports: [ContactsModule, CustomerPiiModule, JournalModule, ShopBuybackModule],
  controllers: [TradeInController],
  providers: [
    TradeInService,
    TradeInVoucherService,
    BuybackQuestionAdminService,
    OnlineAppraisalService,
  ],
  exports: [TradeInService],
})
export class TradeInModule {}
