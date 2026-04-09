import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

interface CheckResult {
  status: 'ok' | 'error';
  message?: string;
}

interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  checks: {
    database: CheckResult;
    storage: CheckResult;
  };
}

/**
 * HealthController — liveness / readiness probe for Cloud Run & load balancers.
 *
 * GET /api/health
 *   - Public (no auth required) — suitable as a Cloud Run liveness probe.
 *   - Returns 200 { status: 'ok', ... } when all checks pass.
 *   - Returns 503 { status: 'error', ... } when any check fails.
 *   - Excluded from global ResponseInterceptor envelope via the raw response shape
 *     (NestJS does NOT wrap 503 exceptions, and we throw ServiceUnavailableException
 *     only on failure, so the happy-path 200 is still wrapped — callers should read
 *     `data.status` or check HTTP status code, not the envelope `success` field).
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check — database + storage', description: 'Public liveness probe' })
  async check(): Promise<HealthResponse> {
    const timestamp = new Date().toISOString();

    const [dbCheck, storageCheck] = await Promise.all([
      this.checkDatabase(),
      this.checkStorage(),
    ]);

    const allOk = dbCheck.status === 'ok' && storageCheck.status === 'ok';

    const response: HealthResponse = {
      status: allOk ? 'ok' : 'error',
      timestamp,
      checks: {
        database: dbCheck,
        storage: storageCheck,
      },
    };

    if (!allOk) {
      // Throw so NestJS returns HTTP 503; the exception body carries our JSON
      throw new ServiceUnavailableException(response);
    }

    return response;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async checkDatabase(): Promise<CheckResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch (err) {
      return {
        status: 'error',
        message: err instanceof Error ? err.message : 'database unreachable',
      };
    }
  }

  private checkStorage(): CheckResult {
    // We verify that the four required S3 env vars are present and non-empty.
    // A missing var means no uploads will work, which is treated as unhealthy.
    // We avoid making a live HeadBucket call here to keep latency minimal and
    // avoid coupling the probe to network I/O that could flap independently.
    const required = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET'];
    const missing = required.filter((key) => !this.configService.get<string>(key));

    if (missing.length > 0) {
      return {
        status: 'error',
        message: `missing env vars: ${missing.join(', ')}`,
      };
    }

    return { status: 'ok' };
  }
}
