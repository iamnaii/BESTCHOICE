import { Module } from '@nestjs/common';
import { ShopTrackingController } from './shop-tracking.controller';
import { ShopTrackingService } from './shop-tracking.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ShopTrackingController],
  providers: [ShopTrackingService],
  exports: [ShopTrackingService],
})
export class ShopTrackingModule {}
