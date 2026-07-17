import { Module } from '@nestjs/common';
import { TradeInController } from './trade-in.controller';
import { TradeInService } from './trade-in.service';
import { TradeInVoucherService } from './services/voucher.service';
import { BuybackQuestionAdminService } from './services/buyback-question-admin.service';
import { ContactsModule } from '../contacts/contacts.module';
import { CustomerPiiModule } from '../customers/customer-pii.module';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [ContactsModule, CustomerPiiModule, JournalModule],
  controllers: [TradeInController],
  providers: [TradeInService, TradeInVoucherService, BuybackQuestionAdminService],
  exports: [TradeInService],
})
export class TradeInModule {}
