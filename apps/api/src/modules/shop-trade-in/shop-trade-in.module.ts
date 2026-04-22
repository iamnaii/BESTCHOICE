import { Module } from '@nestjs/common';
import { ShopTradeInController } from './shop-trade-in.controller';
import { ShopTradeInService } from './shop-trade-in.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';

// ShopBotDefenseModule is @Global — guard is available without importing.

@Module({
  imports: [PrismaModule, LineOaModule],
  controllers: [ShopTradeInController],
  providers: [ShopTradeInService],
  exports: [ShopTradeInService],
})
export class ShopTradeInModule {}
