import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OffsiteBackupService } from './offsite-backup.service';
import { ToggleOffsiteBackupDto } from './dto/toggle-offsite-backup.dto';

/**
 * Phase 3 SP2 — Backup controller.
 *
 * Three endpoints:
 *   POST /backup/offsite-now      — manual trigger (OWNER)
 *   GET  /backup/offsite-status   — history + current enabled state (OWNER/FM/ACC)
 *   PUT  /backup/offsite-enabled  — flip toggle (OWNER)
 *
 * The status endpoint also returns metadata (destination bucket, retention
 * days) that the Settings UI shows alongside the run history.
 */
@ApiTags('Backup')
@ApiBearerAuth('JWT')
@Controller('backup')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BackupController {
  constructor(private readonly service: OffsiteBackupService) {}

  @Post('offsite-now')
  @Roles('OWNER')
  async triggerNow(@CurrentUser('id') userId: string) {
    const result = await this.service.run(userId || 'manual');
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
  async getStatus(@Query('limit') limitRaw?: string) {
    const parsed = limitRaw ? Number.parseInt(limitRaw, 10) : 7;
    const limit = Number.isFinite(parsed) && parsed > 0 && parsed <= 30 ? parsed : 7;
    const [runs, enabled] = await Promise.all([
      this.service.getRecentRuns(limit),
      this.service.isEnabled(),
    ]);
    return {
      enabled,
      destBucket: this.service.getDestBucket(),
      retentionDays: this.service.getRetentionDays(),
      sqlSourceBucket: this.service.getSqlSourceBucket(),
      runs,
    };
  }

  @Put('offsite-enabled')
  @Roles('OWNER')
  async setEnabled(@Body() dto: ToggleOffsiteBackupDto) {
    const enabled = await this.service.setEnabled(dto.enabled);
    return { enabled };
  }
}
