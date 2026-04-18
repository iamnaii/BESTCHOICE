import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
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
 * GET /api/health/detailed  — OWNER / FINANCE_MANAGER only. Returns per-check
 *                             messages (env var names, DB errors) that are
 *                             useful for ops but should not be public.
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
  @ApiOperation({
    summary: 'Public liveness probe',
    description: 'Returns 200 {status:"ok"} or 503 {status:"error"}. No internal details.',
  })
  async check(): Promise<PublicHealthResponse> {
    const timestamp = new Date().toISOString();
    const [dbCheck, storageCheck] = await Promise.all([
      this.checkDatabase(),
      this.checkStorage(),
    ]);

    const allOk = dbCheck.status === 'ok' && storageCheck.status === 'ok';
    const response: PublicHealthResponse = {
      status: allOk ? 'ok' : 'error',
      timestamp,
    };

    if (!allOk) {
      // Public callers get status only — never the message field.
      throw new ServiceUnavailableException(response);
    }
    return response;
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
      return {
        status: 'error',
        message: err instanceof Error ? err.message : 'database unreachable',
      };
    }
  }

  private checkStorage(): CheckResult {
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
