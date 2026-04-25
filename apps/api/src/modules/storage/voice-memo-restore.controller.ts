import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { VoiceMemoRestoreService } from './voice-memo-restore.service';

/**
 * VoiceMemoRestoreController (P3 Task 3 — real Glacier wired).
 *
 * Mounted under `/upload/restore-voice-memo/:callLogId`. The frontend
 * `VoiceMemoPlayback` component calls this when a memo is in GLACIER tier.
 * Heavy lifting lives in {@link VoiceMemoRestoreService} so the cron can
 * reuse the polling logic.
 *
 * TODO: prod ready when lifecycle deploy — verify Glacier transition
 *   policy is applied to the voice-memos prefix before declaring this
 *   end-to-end functional in production.
 */
@Controller('upload')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VoiceMemoRestoreController {
  constructor(private readonly restoreService: VoiceMemoRestoreService) {}

  @Post('restore-voice-memo/:callLogId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async requestRestore(
    @Param('callLogId') callLogId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.restoreService.requestRestore(callLogId, user.id);
  }
}
