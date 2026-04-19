import { Global, Module } from '@nestjs/common';
import { WebhookAnomalyService } from './webhook-anomaly.service';
import { WebhookAnomalyCron } from './webhook-anomaly.cron';

/**
 * Global because every webhook controller/guard needs access to
 * WebhookAnomalyService without importing a module chain.
 */
@Global()
@Module({
  providers: [WebhookAnomalyService, WebhookAnomalyCron],
  exports: [WebhookAnomalyService],
})
export class WebhookSecurityModule {}
