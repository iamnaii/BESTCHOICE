import { Controller, Get, Header, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * /metrics — Prometheus scrape endpoint (T7-C12).
 *
 * Public (Prometheus scrapers don't send JWT) but gated by a shared-secret
 * header `X-Metrics-Token` matching `METRICS_SCRAPE_TOKEN` env. Without the
 * env set, endpoint returns 503 — prevents accidental exposure if the
 * scrape token isn't configured.
 *
 * Rate-limited via SkipThrottle so Prometheus's every-15s scrape doesn't
 * trip the global throttler.
 */
@Controller('metrics')
@SkipThrottle()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async scrape(@Headers('x-metrics-token') token?: string): Promise<string> {
    const expected = this.config.get<string>('METRICS_SCRAPE_TOKEN');
    if (!expected) {
      throw new HttpException(
        'metrics scrape not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!token || token !== expected) {
      throw new HttpException('forbidden', HttpStatus.FORBIDDEN);
    }
    return this.metrics.collect();
  }
}
