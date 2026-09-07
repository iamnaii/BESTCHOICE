import { Global, Module } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import { AiUsageController } from './ai-usage.controller';
import { AiBudgetCron } from './ai-budget.cron';
import { AiTextService } from './ai-text.service';

/**
 * Global so services can inject AI usage tracking and text assistance without
 * a module import chain.
 */
@Global()
@Module({
  controllers: [AiUsageController],
  providers: [AiUsageService, AiBudgetCron, AiTextService],
  exports: [AiUsageService, AiTextService],
})
export class AiUsageModule {}
