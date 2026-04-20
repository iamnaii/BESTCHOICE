import { Module } from '@nestjs/common';
import { ShopCatalogController } from './shop-catalog.controller';
import { ShopCatalogService } from './shop-catalog.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ShopBotDefenseModule } from '../shop-bot-defense/shop-bot-defense.module';

@Module({
  imports: [PrismaModule, ShopBotDefenseModule],
  controllers: [ShopCatalogController],
  providers: [ShopCatalogService],
  exports: [ShopCatalogService],
})
export class ShopCatalogModule {}
