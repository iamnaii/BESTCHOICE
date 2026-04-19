import { Global, Module } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import { AiBudgetCron } from './ai-budget.cron';

/**
 * Global so any service that calls Claude can inject AiUsageService without
 * a module import chain.
 */
@Global()
@Module({
  providers: [AiUsageService, AiBudgetCron],
  exports: [AiUsageService],
})
export class AiUsageModule {}
