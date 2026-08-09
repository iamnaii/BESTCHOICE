import { Module } from '@nestjs/common';
import { ShopReservationController } from './shop-reservation.controller';
import { ShopReservationService } from './shop-reservation.service';
import { ReservationCleanupCron } from './reservation-cleanup.cron';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';

@Module({
  imports: [PrismaModule, LineOaModule],
  controllers: [ShopReservationController],
  providers: [ShopReservationService, ReservationCleanupCron],
  exports: [ShopReservationService],
})
export class ShopReservationModule {}
