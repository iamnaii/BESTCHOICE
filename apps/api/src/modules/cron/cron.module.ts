import { Module } from '@nestjs/common';
import { CronController } from './cron.controller';
import { CronService } from './cron.service';

@Module({
  controllers: [CronController],
  providers: [CronService],
  exports: [CronService],
})
export class CronModule {}
