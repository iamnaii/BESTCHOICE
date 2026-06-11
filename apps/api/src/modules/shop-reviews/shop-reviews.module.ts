import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ShopBotDefenseModule } from '../shop-bot-defense/shop-bot-defense.module';
import { ShopReviewsService } from './shop-reviews.service';
import { ShopReviewsController } from './shop-reviews.controller';
import { ShopReviewsAdminController } from './shop-reviews.admin.controller';

@Module({
  imports: [PrismaModule, AuthModule, ShopBotDefenseModule],
  controllers: [ShopReviewsController, ShopReviewsAdminController],
  providers: [ShopReviewsService],
  exports: [ShopReviewsService],
})
export class ShopReviewsModule {}
