import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from './storage.service';

/**
 * P3 Task 3 — wires the P2 voice-memo restore stub up to a real Glacier
 * (or GCS Coldline) request.
 *
 * Behaviour by storage backend:
 *
 *   - **S3-compatible**: submit `RestoreObjectCommand` with `Days: 7` +
 *     `GlacierJobParameters.Tier: 'Standard'` (~3-5h ETA), flip
 *     `voiceMemoTier='RESTORE_IN_PROGRESS'`, set
 *     `voiceMemoGlacierRestoreExpiresAt = now + 7 days`. A separate hourly
 *     cron (`voice-memo-restore-poll.cron.ts`) polls HeadObject and flips
 *     the tier back to HOT + sends the operator notification when done.
 *
 *   - **GCS**: setStorageClass('STANDARD') is synchronous — flip tier
 *     straight to HOT and clear the expiry. No polling needed.
 *
 *   - **none** (dev): just flip the DB tier so the UI behaves the same.
 *
 * NOTE: prod-ready only after the lifecycle policy is deployed (transitions
 * voice memos to GLACIER after N days). Until then GLACIER memos are
 * theoretical and `requestGlacierRestore` is a no-op safety net.
 * TODO(prod): verify lifecycle deploy + remove this comment.
 */
const RESTORE_DAYS = 7;
const RESTORE_EXPIRY_MS = RESTORE_DAYS * 24 * 60 * 60 * 1000;

export interface RestoreRequestResult {
  callLogId: string;
  status: 'ALREADY_HOT' | 'REQUESTED' | 'RESTORED';
  etaHours: number;
  message: string;
}

@Injectable()
export class VoiceMemoRestoreService {
  private readonly logger = new Logger(VoiceMemoRestoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async requestRestore(
    callLogId: string,
    actorId: string,
  ): Promise<RestoreRequestResult> {
    const callLog = await this.prisma.callLog.findFirst({
      where: { id: callLogId, deletedAt: null },
      select: { id: true, voiceMemoUrl: true, voiceMemoTier: true },
    });
    if (!callLog) throw new NotFoundException('ไม่พบบันทึกการโทร');
    if (!callLog.voiceMemoUrl) {
      throw new BadRequestException('บันทึกการโทรนี้ไม่มีไฟล์เสียง');
    }

    if (callLog.voiceMemoTier === 'HOT') {
      return {
        callLogId,
        status: 'ALREADY_HOT',
        etaHours: 0,
        message: 'ไฟล์พร้อมเล่นอยู่แล้ว',
      };
    }

    const backend = (this.storage as any).backend as 'gcs' | 's3' | 'none';

    // GCS path: setStorageClass is synchronous — flip straight to HOT
    if (backend === 'gcs') {
      await this.storage.restoreToStandardClass(callLog.voiceMemoUrl);
      await this.prisma.callLog.update({
        where: { id: callLogId },
        data: {
          voiceMemoTier: 'HOT',
          voiceMemoGlacierRestoreExpiresAt: null,
        },
      });
      this.logger.log(
        `[GCS] CallLog ${callLogId} restored to STANDARD by user ${actorId}`,
      );
      return {
        callLogId,
        status: 'RESTORED',
        etaHours: 0,
        message: 'พร้อมเล่นแล้ว',
      };
    }

    // S3 path: async restore — flip to RESTORE_IN_PROGRESS + set expiry
    if (backend === 's3') {
      await this.storage.requestGlacierRestore(
        callLog.voiceMemoUrl,
        RESTORE_DAYS,
      );
      this.logger.log(
        `[S3] Glacier restore requested for CallLog ${callLogId} by user ${actorId}`,
      );
    } else {
      // backend === 'none' — dev/local; mimic the in-progress state for UI
      this.logger.warn(
        `[stub] Storage not configured — pretending to request Glacier restore for ${callLogId}`,
      );
    }

    const expiresAt = new Date(Date.now() + RESTORE_EXPIRY_MS);
    await this.prisma.callLog.update({
      where: { id: callLogId },
      data: {
        voiceMemoTier: 'RESTORE_IN_PROGRESS',
        voiceMemoGlacierRestoreExpiresAt: expiresAt,
      },
    });

    return {
      callLogId,
      status: 'REQUESTED',
      etaHours: 4,
      message: 'ส่งคำขอดึงไฟล์เรียบร้อย ระบบจะแจ้งเตือนเมื่อพร้อม',
    };
  }

  /**
   * Cron tick — poll HeadObject for every memo currently flagged as
   * `RESTORE_IN_PROGRESS`. When the restore completes, flip the tier back
   * to HOT, set the 7-day expiry timer, and notify the operator who
   * recorded the call so they can play it back.
   */
  async pollPendingRestores(): Promise<{ checked: number; completed: number }> {
    const pending = await this.prisma.callLog.findMany({
      where: {
        deletedAt: null,
        voiceMemoTier: 'RESTORE_IN_PROGRESS',
        voiceMemoUrl: { not: null },
      },
      select: {
        id: true,
        callerId: true,
        voiceMemoUrl: true,
        voiceMemoTier: true,
      },
    });

    let completed = 0;
    for (const cl of pending) {
      if (!cl.voiceMemoUrl) continue;
      try {
        const done = await this.storage.isRestoreComplete(cl.voiceMemoUrl);
        if (!done) continue;
        await this.prisma.callLog.update({
          where: { id: cl.id },
          data: {
            voiceMemoTier: 'HOT',
            voiceMemoGlacierRestoreExpiresAt: new Date(
              Date.now() + RESTORE_EXPIRY_MS,
            ),
          },
        });
        if (cl.callerId) {
          await this.prisma.notificationLog.create({
            data: {
              channel: 'IN_APP',
              recipient: cl.callerId,
              subject: 'voice-memo-restore-complete',
              message: `ไฟล์เสียงพร้อมเล่นแล้ว (CallLog ${cl.id})`,
              status: 'SENT',
              sentAt: new Date(),
              relatedId: cl.id,
            },
          });
        }
        completed += 1;
      } catch (err) {
        this.logger.warn(
          `Failed to poll restore status for CallLog ${cl.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return { checked: pending.length, completed };
  }
}
