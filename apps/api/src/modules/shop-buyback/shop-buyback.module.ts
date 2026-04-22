import { Module } from '@nestjs/common';
import { ShopBuybackController } from './shop-buyback.controller';
import { ShopBuybackService } from './shop-buyback.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';

// ShopBotDefenseModule is @Global — guard is available without importing.

@Module({
  imports: [PrismaModule, LineOaModule],
  controllers: [ShopBuybackController],
  providers: [ShopBuybackService],
  exports: [ShopBuybackService],
})
export class ShopBuybackModule {}
