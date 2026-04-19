import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import * as Sentry from '@sentry/nestjs';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

interface CheckResult {
  status: 'ok' | 'error';
  message?: string;
}

interface PublicHealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
}

interface DetailedHealthResponse extends PublicHealthResponse {
  checks: {
    database: CheckResult;
    storage: CheckResult;
  };
}

/**
 * HealthController
 *
 * GET /api/health           — public liveness probe (minimal response so we
 *                             don't leak which backends are deployed or why a
 *                             check failed).
 * GET /api/health/detailed  — OWNER / FINANCE_MANAGER only. Returns generic
 *                             per-check messages (no env var names, no raw
 *                             DB errors). Specific diagnostics — including
 *                             the list of missing env vars — are forwarded
 *                             to Sentry so ops can see them without leaking
 *                             integration topology to authenticated users
 *                             whose account might be compromised (T7-C3).
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Public liveness probe',
    description: 'Returns 200 {status:"ok"}. No dependency checks — use /health/detailed for that.',
  })
  check(): PublicHealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'FINANCE_MANAGER')
  @ApiBearerAuth('JWT')
  @Get('detailed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Detailed health check (auth required)',
    description: 'Full per-check messages. OWNER / FINANCE_MANAGER only.',
  })
  async checkDetailed(): Promise<DetailedHealthResponse> {
    const timestamp = new Date().toISOString();
    const [dbCheck, storageCheck] = await Promise.all([
      this.checkDatabase(),
      this.checkStorage(),
    ]);

    const allOk = dbCheck.status === 'ok' && storageCheck.status === 'ok';
    const response: DetailedHealthResponse = {
      status: allOk ? 'ok' : 'error',
      timestamp,
      checks: { database: dbCheck, storage: storageCheck },
    };

    if (!allOk) {
      // Use HttpException (not ServiceUnavailableException) so the full
      // response shape — including checks.*.message — is preserved in the
      // 503 body for ops debugging.
      throw new HttpException(response, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return response;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async checkDatabase(): Promise<CheckResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch (err) {
      // Do not surface raw DB error to the client — it can reveal driver,
      // schema, or network topology. Keep the message generic and forward
      // specifics to Sentry + server logs for ops (T7-C3).
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Health: database check failed — ${detail}`);
      Sentry.captureException(err instanceof Error ? err : new Error(detail), {
        tags: { healthCheck: 'database' },
      });
      return {
        status: 'error',
        message: 'Database unavailable',
      };
    }
  }

  private checkStorage(): CheckResult {
    const required = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET'];
    const missing = required.filter((key) => !this.configService.get<string>(key));
    if (missing.length > 0) {
      // Do NOT echo env var names in the HTTP response — this lets attackers
      // map which integrations are deployed (S3 vs GCS, etc). Forward the
      // specifics to Sentry + server logs for ops visibility only (T7-C3).
      this.logger.error(
        `Health: storage misconfigured — missing env vars: ${missing.join(', ')}`,
      );
      Sentry.captureMessage('Health: storage misconfigured', {
        level: 'error',
        tags: { healthCheck: 'storage' },
        extra: { missingEnvVars: missing },
      });
      return {
        status: 'error',
        message: 'Storage misconfigured',
      };
    }
    return { status: 'ok' };
  }
}
