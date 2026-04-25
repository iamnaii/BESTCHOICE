import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/node';
import { VoiceMemoRestoreService } from './voice-memo-restore.service';

/**
 * P3 Task 3 — hourly poll over CallLog.voiceMemoTier='RESTORE_IN_PROGRESS'
 * to detect Glacier restores that have completed (S3 returns x-amz-restore
 * `ongoing-request="false"` once the copy is staged).
 *
 * Runs every hour at :15 in Asia/Bangkok so we don't collide with the
 * top-of-hour cron crowd. Sentry-wrapped per the v3 hardening pattern.
 */
@Injectable()
export class VoiceMemoRestorePollCron {
  private readonly logger = new Logger(VoiceMemoRestorePollCron.name);

  constructor(private readonly restoreService: VoiceMemoRestoreService) {}

  @Cron('15 * * * *', { timeZone: 'Asia/Bangkok' })
  async tick() {
    try {
      const result = await this.restoreService.pollPendingRestores();
      if (result.checked > 0) {
        this.logger.log(
          `Voice memo restore poll: checked=${result.checked} completed=${result.completed}`,
        );
      }
    } catch (err) {
      this.logger.error('voice-memo-restore-poll cron failed', err as any);
      Sentry.captureException(err);
    }
  }
}
