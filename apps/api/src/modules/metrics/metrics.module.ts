import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';

/**
 * Global so any service that wants to increment a counter can inject
 * MetricsService without a module import chain.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
