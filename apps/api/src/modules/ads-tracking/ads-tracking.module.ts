import { Module } from '@nestjs/common';
import { AdsTrackingController } from './ads-tracking.controller';
import { AdsTrackingService } from './ads-tracking.service';

@Module({
  controllers: [AdsTrackingController],
  providers: [AdsTrackingService],
  exports: [AdsTrackingService],
})
export class AdsTrackingModule {}
