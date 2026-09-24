import { Module, forwardRef } from '@nestjs/common';
import { RoomFinanceApplicationsController } from './room-finance-applications.controller';
import { FinanceApplicationsController } from './finance-applications.controller';
import { FinanceApplicationService } from './services/finance-application.service';
import { FinanceApplicationNumberService } from './services/finance-application-number.service';
import { LineOaModule } from '../line-oa/line-oa.module';
import { ChatbotFinanceModule } from '../chatbot-finance/chatbot-finance.module';
import { OcrModule } from '../ocr/ocr.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomerPiiModule } from '../customers/customer-pii.module';

@Module({
  imports: [LineOaModule, forwardRef(() => ChatbotFinanceModule), OcrModule, NotificationsModule, CustomerPiiModule],
  controllers: [RoomFinanceApplicationsController, FinanceApplicationsController],
  providers: [FinanceApplicationService, FinanceApplicationNumberService],
  exports: [FinanceApplicationService],
})
export class ExternalFinanceApplicationModule {}
