import { Module } from '@nestjs/common';
import { CommissionController } from './commission.controller';
import { CommissionService } from './commission.service';
import { CommissionClawbackCron } from './commission-clawback.cron';

@Module({
  controllers: [CommissionController],
  providers: [CommissionService, CommissionClawbackCron],
  exports: [CommissionService],
})
export class CommissionModule {}
