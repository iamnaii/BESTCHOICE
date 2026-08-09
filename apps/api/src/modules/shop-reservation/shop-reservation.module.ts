import { Module } from '@nestjs/common';
import { ShopReservationController } from './shop-reservation.controller';
import { ShopReservationAdminController } from './shop-reservation.admin.controller';
import { ShopReservationService } from './shop-reservation.service';
import { ReservationCleanupCron } from './reservation-cleanup.cron';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, LineOaModule, AuthModule],
  controllers: [ShopReservationController, ShopReservationAdminController],
  providers: [ShopReservationService, ReservationCleanupCron],
  exports: [ShopReservationService],
})
export class ShopReservationModule {}
