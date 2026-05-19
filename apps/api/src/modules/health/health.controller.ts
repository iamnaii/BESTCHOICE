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
import { PrismaFinanceService } from '../../prisma/prisma-finance.service';
import { ConfigService } from '@nestjs/config';

interface CheckResult {
  status: 'ok' | 'error';
  message?: string;
}

interface DbProbeResult {
  db: string;
  status: 'ok' | 'error' | 'skipped';
  latency_ms?: number;
  error?: string;
  message?: string;
}

interface PublicHealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
}

interface DetailedHealthResponse extends PublicHealthResponse {
  checks: {
    databases: DbProbeResult[];
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
    private readonly prismaFin: PrismaFinanceService,
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
    const [dbProbes, storageCheck] = await Promise.all([
      this.checkDatabases(),
      this.checkStorage(),
    ]);

    // 'skipped' counts as OK (e.g. bc_finance not yet provisioned)
    const allOk = dbProbes.every((p) => p.status === 'ok' || p.status === 'skipped') && storageCheck.status === 'ok';
    const response: DetailedHealthResponse = {
      status: allOk ? 'ok' : 'error',
      timestamp,
      checks: { databases: dbProbes, storage: storageCheck },
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

  /**
   * SP7.8 — Probe both Prisma clients.
   * Returns an array of DbProbeResult (one per DB) without leaking raw driver
   * errors to the caller — specifics go to Sentry + server logs (T7-C3).
   */
  private async checkDatabases(): Promise<DbProbeResult[]> {
    return Promise.all([
      this.pingDb(this.prisma, 'shop'),
      this.pingFinanceDb(),
    ]);
  }

  /**
   * SP7.1 hotfix — bc_finance is optional until provisioned.
   * When PrismaFinanceService.isEnabled = false, return 'skipped' instead of
   * probing (which would throw because $connect() was never called).
   */
  private async pingFinanceDb(): Promise<DbProbeResult> {
    if (!this.prismaFin.isEnabled) {
      return {
        db: 'finance',
        status: 'skipped',
        message: 'DATABASE_URL_FINANCE not set — bc_finance not yet provisioned (SP7.1)',
      };
    }
    return this.pingDb(this.prismaFin, 'finance');
  }

  private async pingDb(
    client: { $queryRaw: (...args: unknown[]) => Promise<unknown> },
    label: string,
  ): Promise<DbProbeResult> {
    const start = Date.now();
    try {
      await client.$queryRaw`SELECT 1`;
      return { db: label, status: 'ok', latency_ms: Date.now() - start };
    } catch (err) {
      // Do not surface raw DB error to the client — it can reveal driver,
      // schema, or network topology. Keep the message generic and forward
      // specifics to Sentry + server logs for ops (T7-C3).
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Health: database '${label}' check failed — ${detail}`);
      Sentry.captureException(err instanceof Error ? err : new Error(detail), {
        tags: { healthCheck: 'database', db: label },
      });
      return { db: label, status: 'error', error: 'Database unavailable' };
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
