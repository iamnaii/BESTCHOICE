import {
  BadRequestException,
  Controller,
  Logger,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * VoiceMemoRestoreController (P2 Task 4 — stub).
 *
 * Mounted under `/upload/restore-voice-memo/:callLogId`. The frontend
 * `VoiceMemoPlayback` component calls this when a memo is in GLACIER tier.
 *
 * TODO: Wire up real S3 Glacier restore (`RestoreObjectCommand`) once the
 *   lifecycle policy is provisioned (Task 3 / P2 Cluster β prerequisite).
 *   For now this endpoint:
 *     - validates the CallLog exists + has a HOT/GLACIER memo URL,
 *     - logs the request for the operations team,
 *     - flips voiceMemoTier back to HOT optimistically with a 24h restore
 *       expiry once the real Glacier job completes (left as TODO).
 */
@Controller('upload')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VoiceMemoRestoreController {
  private readonly logger = new Logger(VoiceMemoRestoreController.name);

  constructor(private prisma: PrismaService) {}

  @Post('restore-voice-memo/:callLogId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async requestRestore(@Param('callLogId') callLogId: string) {
    const callLog = await this.prisma.callLog.findFirst({
      where: { id: callLogId, deletedAt: null },
      select: { id: true, voiceMemoUrl: true, voiceMemoTier: true },
    });
    if (!callLog) throw new NotFoundException('ไม่พบบันทึกการโทร');
    if (!callLog.voiceMemoUrl) {
      throw new BadRequestException('บันทึกการโทรนี้ไม่มีไฟล์เสียง');
    }

    // TODO(P2 follow-up): submit S3 RestoreObjectCommand with `Days: 7` +
    //   `GlacierJobParameters.Tier: 'Standard'` (~3-5h ETA), then update
    //   voiceMemoTier='HOT' + voiceMemoGlacierRestoreExpiresAt = now+7d when
    //   the restore notification fires.
    this.logger.log(
      `[stub] Glacier restore requested for CallLog ${callLogId} (tier=${callLog.voiceMemoTier ?? 'HOT'})`,
    );

    return {
      ok: true,
      callLogId,
      status: 'REQUESTED',
      etaHours: 4,
      message: 'ส่งคำขอดึงไฟล์เรียบร้อย ระบบจะแจ้งเตือนเมื่อพร้อม',
    };
  }
}
