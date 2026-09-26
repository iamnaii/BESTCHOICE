import { Module, forwardRef } from '@nestjs/common';
import { RoomFinanceApplicationsController } from './room-finance-applications.controller';
import { FinanceApplicationsController } from './finance-applications.controller';
import { FinanceSharePublicController } from './finance-share-public.controller';
import { GfinPrecheckSettingsController } from './gfin-precheck-settings.controller';
import { FinanceApplicationService } from './services/finance-application.service';
import { FinanceApplicationFilesService } from './services/finance-application-files.service';
import { FinanceApplicationNumberService } from './services/finance-application-number.service';
import { FinanceShareService } from './services/finance-share.service';
import { FinanceApplicationNotifyService } from './services/finance-application-notify.service';
import { GfinLineGroupService } from './services/gfin-line-group.service';
import { FinanceApplicationPurgeCron } from './crons/finance-application-purge.cron';
import { LineOaModule } from '../line-oa/line-oa.module';
import { ChatbotFinanceModule } from '../chatbot-finance/chatbot-finance.module';
import { OcrModule } from '../ocr/ocr.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomerPiiModule } from '../customers/customer-pii.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  // CustomersModule — CustomersService.update สำหรับ PATCH :id/customer-fields (กติกาเขียนเบอร์ชุดเดียวกับหน้าลูกค้า)
  //   ไม่มีโมดูลไหน import โมดูลนี้กลับ (มีแค่ app.module) จึงไม่มีวงจร
  imports: [LineOaModule, forwardRef(() => ChatbotFinanceModule), OcrModule, NotificationsModule, CustomerPiiModule, CustomersModule],
  controllers: [RoomFinanceApplicationsController, FinanceApplicationsController, FinanceSharePublicController, GfinPrecheckSettingsController],
  providers: [
    FinanceApplicationService,
    FinanceApplicationFilesService,
    FinanceApplicationNumberService,
    FinanceShareService,
    FinanceApplicationNotifyService,
    FinanceApplicationPurgeCron,
    GfinLineGroupService,
  ],
  exports: [FinanceApplicationService, GfinLineGroupService],
})
export class ExternalFinanceApplicationModule {}
