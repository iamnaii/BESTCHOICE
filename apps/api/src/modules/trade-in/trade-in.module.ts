import { Module } from '@nestjs/common';
import { TradeInController } from './trade-in.controller';
import { TradeInService } from './trade-in.service';

@Module({
  controllers: [TradeInController],
  providers: [TradeInService],
  exports: [TradeInService],
})
export class TradeInModule {}
