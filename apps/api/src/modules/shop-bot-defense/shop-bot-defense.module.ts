import { Global, Module } from '@nestjs/common';
import { ShopBotDefenseService } from './shop-bot-defense.service';
import { ShopBotDefenseGuard } from './shop-bot-defense.guard';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [ShopBotDefenseService, ShopBotDefenseGuard],
  exports: [ShopBotDefenseService, ShopBotDefenseGuard],
})
export class ShopBotDefenseModule {}
