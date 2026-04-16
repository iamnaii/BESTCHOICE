import { Module } from '@nestjs/common';
import { AdsTrackingController } from './ads-tracking.controller';
import { AdsTrackingService } from './ads-tracking.service';
import { FacebookAdsSyncService } from './facebook-ads-sync.service';

@Module({
  controllers: [AdsTrackingController],
  providers: [AdsTrackingService, FacebookAdsSyncService],
  exports: [AdsTrackingService],
})
export class AdsTrackingModule {}
