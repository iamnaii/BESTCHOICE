import { Module } from '@nestjs/common';
import { OverdueController } from './overdue.controller';
import { OverdueService } from './overdue.service';
import { OverdueChatService } from './overdue-chat.service';
import { ContractLetterService } from './contract-letter.service';
import { DunningRuleService } from './dunning-rule.service';
import { DunningEngineService } from './dunning-engine.service';
import { DunningRuleResolverService } from './dunning-rule-resolver.service';
import { NextBestActionService } from './next-best-action.service';
import { MdmLockService } from './mdm-lock.service';
import { OverdueQueueService } from './queue.service';
import { OverdueKpiService } from './kpi.service';
import { MyTodayKpiService } from './my-today-kpi.service';
import { OverdueTimelineService } from './timeline.service';
import { OverdueBulkService } from './bulk.service';
import { DunningRetryService } from './dunning-retry.service';
import { OverdueAnalyticsService } from './analytics.service';
import { AnalyticsAgingService } from './analytics-aging.service';
import { AnalyticsLeaderboardService } from './analytics-leaderboard.service';
import { AnalyticsRecoveryService } from './analytics-recovery.service';
import { StuckContractsService } from './stuck-contracts.service';
import { OwnerAlertHelper } from './owner-alert.helper';
import { BrokenPromiseCron } from './crons/broken-promise.cron';
import { MdmAutoProposeCron } from './crons/mdm-auto-propose.cron';
import { LetterAutoGenerateCron } from './crons/letter-auto-generate.cron';
import { ContractSnapshotCron } from './contract-snapshot.cron';
import { BrokenPromiseReminderCron } from './broken-promise-reminder.cron';
import { ContractSnoozeService } from './snooze.service';
import { CustomerInsightsService } from './customer-insights.service';
import { AutoBalanceService } from './auto-balance.service';
import { ChatEngineModule } from '../chat-engine/chat-engine.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LineOaModule } from '../line-oa/line-oa.module';

@Module({
  imports: [ChatEngineModule, NotificationsModule, LineOaModule],
  controllers: [OverdueController],
  providers: [
    OverdueService,
    OverdueChatService,
    ContractLetterService,
    DunningRuleService,
    DunningEngineService,
    DunningRuleResolverService,
    NextBestActionService,
    MdmLockService,
    OverdueQueueService,
    OverdueKpiService,
    MyTodayKpiService,
    OverdueTimelineService,
    OverdueBulkService,
    DunningRetryService,
    OverdueAnalyticsService,
    AnalyticsAgingService,
    AnalyticsLeaderboardService,
    AnalyticsRecoveryService,
    StuckContractsService,
    OwnerAlertHelper,
    BrokenPromiseCron,
    MdmAutoProposeCron,
    LetterAutoGenerateCron,
    ContractSnapshotCron,
    BrokenPromiseReminderCron,
    ContractSnoozeService,
    CustomerInsightsService,
    AutoBalanceService,
  ],
  exports: [
    CustomerInsightsService,
    OverdueService,
    ContractLetterService,
    DunningRuleService,
    DunningEngineService,
    MdmLockService,
    OverdueQueueService,
    OverdueKpiService,
    OverdueTimelineService,
    OverdueBulkService,
    OverdueAnalyticsService,
    AnalyticsAgingService,
    AnalyticsLeaderboardService,
    AnalyticsRecoveryService,
    StuckContractsService,
  ],
})
export class OverdueModule {}
