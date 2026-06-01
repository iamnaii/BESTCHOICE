import { Module } from '@nestjs/common';
import { TradeInController } from './trade-in.controller';
import { TradeInService } from './trade-in.service';
import { TradeInVoucherService } from './services/voucher.service';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [ContactsModule],
  controllers: [TradeInController],
  providers: [TradeInService, TradeInVoucherService],
  exports: [TradeInService],
})
export class TradeInModule {}
