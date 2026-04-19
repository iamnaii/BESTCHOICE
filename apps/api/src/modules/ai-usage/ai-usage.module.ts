import { Global, Module } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import { AiUsageController } from './ai-usage.controller';
import { AiBudgetCron } from './ai-budget.cron';

/**
 * Global so any service that calls Claude can inject AiUsageService without
 * a module import chain.
 */
@Global()
@Module({
  controllers: [AiUsageController],
  providers: [AiUsageService, AiBudgetCron],
  exports: [AiUsageService],
})
export class AiUsageModule {}
