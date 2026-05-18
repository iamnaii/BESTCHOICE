import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { JournalModule } from '../journal/journal.module';
import { AuthModule } from '../auth/auth.module';
import { SsoConfigModule } from '../sso-config/sso-config.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { ExpenseDocumentsController } from './expense-documents.controller';
import { ExpenseDocumentsService } from './expense-documents.service';
import { ExpenseTemplatesController } from './expense-templates.controller';
import { ExpenseTemplatesService } from './expense-templates.service';
import { TemplateCategoriesController } from './template-categories.controller';
import { TemplateCategoriesService } from './template-categories.service';
import { DocNumberService } from './services/doc-number.service';
import { StatusTransitionService } from './services/status-transition.service';
import { LineAggregatorService } from './services/line-aggregator.service';
import { JePreviewService } from './services/je-preview.service';
import { PettyCashService } from './services/petty-cash.service';
import { PayrollCustomService } from './services/payroll-custom.service';
import { ExpenseRecurringCron } from './crons/expense-recurring.cron';
import { PettyCashReplenishAlertCron } from './crons/petty-cash-replenish-alert.cron';
import { DraftAlertsCron } from './crons/draft-alerts.cron';
import { ApDueAlertsCron } from './crons/ap-due-alerts.cron';
import { PostPermissionGuard } from './post-permission.guard';
import { ReversePermissionGuard } from './reverse-permission.guard';

@Module({
  // NotificationsModule import is required so DraftAlertsCron + ApDueAlertsCron can
  // route IN_APP alerts through NotificationsService.send() (respects D1.3.1.4 master gate).
  imports: [
    PrismaModule,
    JournalModule,
    AuthModule,
    SsoConfigModule,
    NotificationsModule,
    SettingsModule,
  ],
  controllers: [
    ExpenseDocumentsController,
    ExpenseTemplatesController,
    TemplateCategoriesController,
  ],
  providers: [
    ExpenseDocumentsService,
    ExpenseTemplatesService,
    TemplateCategoriesService,
    DocNumberService,
    StatusTransitionService,
    LineAggregatorService,
    JePreviewService,
    PettyCashService,
    PayrollCustomService,
    ExpenseRecurringCron,
    PettyCashReplenishAlertCron,
    // D1.3.1.1 — DRAFT alerts cron (opt-in via SystemConfig `draft_alerts_enabled`)
    DraftAlertsCron,
    // D1.3.1.2 — AP-due alerts cron. Default OFF (opt-in) — see ap-due-alerts.cron.ts for rationale.
    ApDueAlertsCron,
    // D1.3.2.3 — dynamic post-permission guard for POST /expense-documents/:id/post
    PostPermissionGuard,
    // D1.3.2.4 — dynamic reverse-permission guard for POST /expense-documents/:id/void
    ReversePermissionGuard,
  ],
  exports: [ExpenseDocumentsService, ExpenseTemplatesService],
})
export class ExpenseDocumentsModule {}
