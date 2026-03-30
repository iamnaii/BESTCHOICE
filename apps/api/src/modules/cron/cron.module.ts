import { Module } from '@nestjs/common';
import { CronController } from './cron.controller';
import { CronService } from './cron.service';
import { OverdueModule } from '../overdue/overdue.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LineOaModule } from '../line-oa/line-oa.module';

@Module({
  imports: [OverdueModule, NotificationsModule, LineOaModule],
  controllers: [CronController],
  providers: [CronService],
})
export class CronModule {}
