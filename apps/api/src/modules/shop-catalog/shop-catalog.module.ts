import { Module } from '@nestjs/common';
import { ShopCatalogController } from './shop-catalog.controller';
import { ShopShareController } from './shop-share.controller';
import { ShopCatalogService } from './shop-catalog.service';
import { InstallmentPreviewService } from './installment-preview.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ShopBotDefenseModule } from '../shop-bot-defense/shop-bot-defense.module';

@Module({
  imports: [PrismaModule, ShopBotDefenseModule],
  controllers: [ShopCatalogController, ShopShareController],
  providers: [ShopCatalogService, InstallmentPreviewService],
  exports: [ShopCatalogService],
})
export class ShopCatalogModule {}
