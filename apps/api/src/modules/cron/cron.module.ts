import { Module } from '@nestjs/common';
import { CronController } from './cron.controller';
import { OverdueModule } from '../overdue/overdue.module';

@Module({
  imports: [OverdueModule],
  controllers: [CronController],
})
export class CronModule {}
