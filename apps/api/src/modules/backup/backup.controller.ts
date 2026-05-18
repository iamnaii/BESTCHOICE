import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OffsiteBackupService, type RecentRun } from './offsite-backup.service';
import { ToggleOffsiteBackupDto } from './dto/toggle-offsite-backup.dto';
import { AuditService } from '../audit/audit.service';

/**
 * Authenticated request principal — populated by JwtStrategy onto req.user.
 */
interface AuthUser {
  id: string;
  role: 'OWNER' | 'BRANCH_MANAGER' | 'FINANCE_MANAGER' | 'ACCOUNTANT' | 'SALES' | string;
}

/**
 * Phase 3 SP2 — Backup controller.
 *
 * Three endpoints:
 *   POST /backup/offsite-now      — manual trigger (OWNER)
 *   GET  /backup/offsite-status   — history + current enabled state (OWNER/FM/ACC)
 *   PUT  /backup/offsite-enabled  — flip toggle (OWNER)
 *
 * The status endpoint also returns metadata (destination bucket, retention
 * days) that the Settings UI shows alongside the run history. W7 fix:
 * bucket names are masked for non-OWNER callers — FM/ACC don't need that
 * level of infrastructure detail and exposing it risks reconnaissance.
 */
@ApiTags('Backup')
@ApiBearerAuth('JWT')
@Controller('backup')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BackupController {
  constructor(
    private readonly service: OffsiteBackupService,
    private readonly audit: AuditService,
  ) {}

  @Post('offsite-now')
  @Roles('OWNER')
  async triggerNow(@CurrentUser() user: AuthUser) {
    const result = await this.service.run({
      triggeredBy: 'manual',
      triggeredByUserId: user?.id ?? null,
    });
    // C2 — explicit audit log so the hash-chained AuditLog table captures
    // who clicked "Run Now" (the OffsiteBackupRun FK is a convenience join,
    // not the legal audit trail).
    await this.audit.log({
      userId: user?.id,
      action: 'OFFSITE_BACKUP_RUN_NOW',
      entity: 'offsite_backup',
      entityId: result.id,
      newValue: {
        status: result.status,
        filesCount: result.filesCount,
        totalBytes: result.totalBytes,
        durationMs: result.durationMs,
      },
    });
    return {
      id: result.id,
      status: result.status,
      filesCount: result.filesCount,
      totalBytes: result.totalBytes,
      durationMs: result.durationMs,
      errorMessage: result.errorMessage ?? null,
    };
  }

  @Get('offsite-status')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async getStatus(@CurrentUser() user: AuthUser, @Query('limit') limitRaw?: string) {
    const parsed = limitRaw ? Number.parseInt(limitRaw, 10) : 7;
    const limit = Number.isFinite(parsed) && parsed > 0 && parsed <= 30 ? parsed : 7;
    const [runs, enabled] = await Promise.all([
      this.service.getRecentRuns(limit),
      this.service.isEnabled(),
    ]);
    const isOwner = user?.role === 'OWNER';
    return {
      enabled,
      // W7: only OWNER sees bucket names. FM/ACC need to see the audit
      // trail + status, not the infrastructure config.
      destBucket: isOwner ? this.service.getDestBucket() : null,
      retentionDays: this.service.getRetentionDays(),
      sqlSourceBucket: isOwner ? this.service.getSqlSourceBucket() : null,
      runs: runs.map((r: RecentRun) => ({
        ...r,
        destBucket: isOwner ? r.destBucket : null,
      })),
    };
  }

  @Put('offsite-enabled')
  @Roles('OWNER')
  async setEnabled(@Body() dto: ToggleOffsiteBackupDto) {
    const enabled = await this.service.setEnabled(dto.enabled);
    return { enabled };
  }
}
