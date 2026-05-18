import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PdpaEncryptionService } from './pdpa-encryption.service';
import { SetStrictModeDto } from './dto/strict-mode.dto';
import { AuditService } from '../audit/audit.service';

interface AuthUser {
  id: string;
  role: 'OWNER' | 'BRANCH_MANAGER' | 'FINANCE_MANAGER' | 'ACCOUNTANT' | 'SALES' | string;
}

/**
 * Phase 3 SP4 — PDPA PII encryption admin endpoints.
 *
 *   GET  /pdpa/status                 — strict-mode flag + plaintext/encrypted counts
 *                                       (OWNER/FM/ACCOUNTANT — needed for compliance dashboard)
 *   PUT  /pdpa/strict-mode            — flip strict mode (OWNER only)
 *   POST /pdpa/backfill               — run backfill once (OWNER only; advisory-locked)
 *   GET  /pdpa/backfill/:id           — poll a specific run's progress
 *   GET  /pdpa/backfill-runs?limit=7  — recent run history
 *
 * Mounted at /pdpa-encryption to avoid colliding with the existing PDPA
 * consent/DSAR controller which already owns /pdpa/consent, /pdpa/dsar, etc.
 */
@ApiTags('PDPA Encryption')
@ApiBearerAuth('JWT')
@Controller('pdpa-encryption')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PdpaEncryptionController {
  constructor(
    private readonly service: PdpaEncryptionService,
    private readonly audit: AuditService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'PDPA strict-mode + backfill status' })
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async getStatus() {
    return this.service.getStatus();
  }

  @Put('strict-mode')
  @ApiOperation({ summary: 'Toggle PDPA strict mode (OWNER only)' })
  @Roles('OWNER')
  async setStrictMode(
    @Body() dto: SetStrictModeDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const before = await this.service.getStatus();
    const result = await this.service.setStrictMode(dto.enabled);
    // W6 — capture request IP + UA so PDPA audit trail is forensics-grade.
    await this.audit.log({
      userId: user?.id,
      action: 'PDPA_STRICT_MODE_TOGGLED',
      entity: 'system_config',
      entityId: 'PDPA_STRICT_MODE',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      oldValue: { strictMode: before.strictMode },
      newValue: { strictMode: result.strictMode },
    });
    return result;
  }

  @Post('backfill')
  @ApiOperation({ summary: 'Run PDPA PII backfill (OWNER only)' })
  @Roles('OWNER')
  async runBackfill(@CurrentUser() user: AuthUser, @Req() req: Request) {
    // W7 — the service writes the `PDPA_BACKFILL_RUN` AuditLog itself so
    // the CLI invocation path also gets one entry. We forward IP + UA so
    // the audit row records who initiated from where.
    return this.service.runBackfill({
      triggeredBy: 'manual',
      triggeredByUserId: user?.id ?? null,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('backfill/:id')
  @Roles('OWNER')
  async getRun(@Param('id') id: string) {
    return this.service.getRun(id);
  }

  @Get('backfill-runs')
  @Roles('OWNER')
  async getRecentRuns(@Query('limit') limitRaw?: string) {
    const parsed = limitRaw ? Number.parseInt(limitRaw, 10) : 7;
    const limit = Number.isFinite(parsed) && parsed > 0 && parsed <= 30 ? parsed : 7;
    return this.service.getRecentRuns(limit);
  }
}
