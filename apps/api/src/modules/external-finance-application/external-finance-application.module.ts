import { Module, forwardRef } from '@nestjs/common';
import { RoomFinanceApplicationsController } from './room-finance-applications.controller';
import { FinanceApplicationsController } from './finance-applications.controller';
import { FinanceSharePublicController } from './finance-share-public.controller';
import { FinanceApplicationService } from './services/finance-application.service';
import { FinanceApplicationFilesService } from './services/finance-application-files.service';
import { FinanceApplicationNumberService } from './services/finance-application-number.service';
import { FinanceShareService } from './services/finance-share.service';
import { FinanceApplicationNotifyService } from './services/finance-application-notify.service';
import { LineOaModule } from '../line-oa/line-oa.module';
import { ChatbotFinanceModule } from '../chatbot-finance/chatbot-finance.module';
import { OcrModule } from '../ocr/ocr.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomerPiiModule } from '../customers/customer-pii.module';

@Module({
  imports: [LineOaModule, forwardRef(() => ChatbotFinanceModule), OcrModule, NotificationsModule, CustomerPiiModule],
  controllers: [RoomFinanceApplicationsController, FinanceApplicationsController, FinanceSharePublicController],
  providers: [
    FinanceApplicationService,
    FinanceApplicationFilesService,
    FinanceApplicationNumberService,
    FinanceShareService,
    FinanceApplicationNotifyService,
  ],
  exports: [FinanceApplicationService],
})
export class ExternalFinanceApplicationModule {}
