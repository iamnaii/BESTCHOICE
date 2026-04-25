import { Module } from '@nestjs/common';
import { OverdueController } from './overdue.controller';
import { OverdueService } from './overdue.service';
import { OverdueChatService } from './overdue-chat.service';
import { ContractLetterService } from './contract-letter.service';
import { DunningRuleService } from './dunning-rule.service';
import { DunningEngineService } from './dunning-engine.service';
import { MdmLockService } from './mdm-lock.service';
import { BrokenPromiseCron } from './crons/broken-promise.cron';
import { MdmAutoProposeCron } from './crons/mdm-auto-propose.cron';
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
    MdmLockService,
    BrokenPromiseCron,
    MdmAutoProposeCron,
  ],
  exports: [
    OverdueService,
    ContractLetterService,
    DunningRuleService,
    DunningEngineService,
    MdmLockService,
  ],
})
export class OverdueModule {}
