import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { JournalModule } from '../journal/journal.module';
import { AuthModule } from '../auth/auth.module';
import { SsoConfigModule } from '../sso-config/sso-config.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExpenseDocumentsController } from './expense-documents.controller';
import { ExpenseDocumentsService } from './expense-documents.service';
import { ExpenseTemplatesController } from './expense-templates.controller';
import { ExpenseTemplatesService } from './expense-templates.service';
import { DocNumberService } from './services/doc-number.service';
import { StatusTransitionService } from './services/status-transition.service';
import { LineAggregatorService } from './services/line-aggregator.service';
import { JePreviewService } from './services/je-preview.service';
import { PettyCashService } from './services/petty-cash.service';
import { PayrollCustomService } from './services/payroll-custom.service';
import { ExpenseRecurringCron } from './crons/expense-recurring.cron';
import { ApDueAlertsCron } from './crons/ap-due-alerts.cron';

@Module({
  // NotificationsModule import is required so ApDueAlertsCron can route IN_APP
  // alerts through NotificationsService.send() (respects the D1.3.1.4 master gate).
  imports: [PrismaModule, JournalModule, AuthModule, SsoConfigModule, NotificationsModule],
  controllers: [ExpenseDocumentsController, ExpenseTemplatesController],
  providers: [
    ExpenseDocumentsService,
    ExpenseTemplatesService,
    DocNumberService,
    StatusTransitionService,
    LineAggregatorService,
    JePreviewService,
    PettyCashService,
    PayrollCustomService,
    ExpenseRecurringCron,
    // D1.3.1.2 — AP-due alerts cron. Default OFF (opt-in) — see ap-due-alerts.cron.ts for rationale.
    ApDueAlertsCron,
  ],
  exports: [ExpenseDocumentsService, ExpenseTemplatesService],
})
export class ExpenseDocumentsModule {}
