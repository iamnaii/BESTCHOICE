import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { TestModeModule } from '../test-mode/test-mode.module';

@Module({
  imports: [NotificationsModule, TestModeModule],
  controllers: [KycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
