import { Controller, Get, Header, Headers, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
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
 * T7-C9: Supports dual tokens for zero-downtime rotation:
 *   - METRICS_SCRAPE_TOKEN — new/active token
 *   - METRICS_SCRAPE_TOKEN_PREVIOUS — optional, last rotated-out token
 * Both accepted; matches against PREVIOUS log a warning so ops can see the
 * old caller is still in use and finish migrating scrapers. Comparisons use
 * `timingSafeEqual` to avoid timing side-channels.
 *
 * Rate-limited via SkipThrottle so Prometheus's every-15s scrape doesn't
 * trip the global throttler.
 */
@Controller('metrics')
@SkipThrottle()
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async scrape(@Headers('x-metrics-token') token?: string): Promise<string> {
    const expected = this.config.get<string>('METRICS_SCRAPE_TOKEN');
    const previous = this.config.get<string>('METRICS_SCRAPE_TOKEN_PREVIOUS');

    if (!expected) {
      throw new HttpException(
        'metrics scrape not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!token) {
      throw new HttpException('forbidden', HttpStatus.FORBIDDEN);
    }

    if (safeCompare(token, expected)) {
      return this.metrics.collect();
    }
    if (previous && safeCompare(token, previous)) {
      this.logger.warn(
        'metrics scrape authenticated via METRICS_SCRAPE_TOKEN_PREVIOUS — rotate the caller to the new token and remove PREVIOUS from env',
      );
      return this.metrics.collect();
    }

    throw new HttpException('forbidden', HttpStatus.FORBIDDEN);
  }
}

/**
 * Constant-time string compare. Short-circuits on length mismatch (the length
 * itself isn't secret; it's the same for all valid rotation pairs).
 */
function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
