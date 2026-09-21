import { Module } from '@nestjs/common';
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
import { CustomerTagsModule } from '../customer-tags/customer-tags.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { RepossessionsModule } from '../repossessions/repossessions.module';
import { DeviceReturnsController } from './device-returns.controller';
import { DeviceReturnsService } from './device-returns.service';
import { DeviceReturnNumberService } from './device-return-number.service';
import { DeviceReturnNotifyService } from './device-return-notify.service';
import { DeviceReturnPendingCron } from './device-return-pending.cron';

/**
 * ใบรับเครื่องคืน (spec 2026-09-20). ไม่มี forwardRef: ไม่มีโมดูลใด import โมดูลนี้นอกจาก AppModule
 * — RepossessionsModule (createInTx), ReceiptsModule (CreditNoteDeliveryService), NotificationsModule
 * (sendFromTemplate), CustomerTagsModule (recomputeForCustomer), CustomerJourneyModule (JourneyEntryWriter)
 * ล้วนเป็น import ขาเดียว. DeviceReturnPendingCron ถูกเพิ่มเข้า providers ใน Task 13.
 */
@Module({
  imports: [
    RepossessionsModule,
    ReceiptsModule,
    NotificationsModule,
    CustomerTagsModule,
    CustomerJourneyModule,
  ],
  controllers: [DeviceReturnsController],
  providers: [
    DeviceReturnsService,
    DeviceReturnNumberService,
    DeviceReturnNotifyService,
    DeviceReturnPendingCron,
  ],
  exports: [DeviceReturnsService],
})
export class DeviceReturnsModule {}
