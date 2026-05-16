import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * D1.3.1.1 — DRAFT alerts.
 *
 * Scans for expense documents stuck in DRAFT longer than the configured
 * threshold and sends an in-app notification to the document creator
 * reminding them to either submit or delete the draft. Opt-in (default OFF)
 * so existing deploys don't suddenly start sending alerts.
 *
 * SystemConfig keys consumed:
 *   - `draft_alerts_enabled`           (default 'false') — kill switch
 *   - `draft_alert_threshold_days`     (default 7)       — days in DRAFT
 *                                                          before alert fires
 *
 * Dedup: the cron skips drafts that already received an alert today
 * (subject prefix + relatedId match in notification_logs).
 *
 * Implementation notes:
 *   - Reads SystemConfig via PrismaService (avoids SettingsModule DI dep,
 *     same pattern as PR #884 ExpenseDocumentsService.readBoolFlag).
 *   - Inserts NotificationLog directly (channel=IN_APP, status=SENT) rather
 *     than going through NotificationsService — IN_APP rows don't trigger
 *     external API calls, and the cron should remain isolated from
 *     compliance / retry-queue concerns.
 *   - Sentry capture on per-doc failure, batch continues on error.
 */
@Injectable()
export class DraftAlertsCron {
  private readonly logger = new Logger(DraftAlertsCron.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Daily at 09:00 Asia/Bangkok — start of business hours. */
  @Cron('0 9 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<{ enabled: boolean; alerted: number; skipped: number; failed: number }> {
    const enabled = await this.readBoolFlag('draft_alerts_enabled', false);
    if (!enabled) {
      // Default-off + opt-in. Silent skip so quiet deploys don't fill logs.
      this.logger.debug('[D1.3.1.1] DRAFT alerts disabled — skipping');
      return { enabled: false, alerted: 0, skipped: 0, failed: 0 };
    }

    const thresholdDays = await this.readNumberFlag('draft_alert_threshold_days', 7);
    const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);

    const stale = await this.prisma.expenseDocument.findMany({
      where: {
        status: 'DRAFT',
        createdAt: { lte: cutoff },
        deletedAt: null,
      },
      select: {
        id: true,
        number: true,
        createdById: true,
        documentType: true,
        createdAt: true,
        createdBy: { select: { email: true, name: true } },
      },
    });

    this.logger.log(
      `[D1.3.1.1] DRAFT alerts: ${stale.length} doc(s) stale ≥${thresholdDays}d`,
    );
    if (stale.length === 0) {
      return { enabled: true, alerted: 0, skipped: 0, failed: 0 };
    }

    let alerted = 0;
    let skipped = 0;
    let failed = 0;
    // Dedup window: skip if an alert for the same doc was already sent today.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    for (const doc of stale) {
      try {
        // Idempotency: skip if we already alerted today
        const alreadyAlerted = await this.prisma.notificationLog.findFirst({
          where: {
            relatedId: doc.id,
            subject: 'เอกสารฉบับร่างค้าง',
            createdAt: { gte: todayStart },
          },
          select: { id: true },
        });
        if (alreadyAlerted) {
          skipped++;
          continue;
        }

        const recipient = doc.createdBy?.email || doc.createdById;
        await this.prisma.notificationLog.create({
          data: {
            channel: 'IN_APP',
            recipient,
            subject: 'เอกสารฉบับร่างค้าง',
            message: `เอกสารฉบับร่าง #${doc.number} ค้าง ${thresholdDays}+ วัน — โปรดส่งหรือลบ`,
            status: 'SENT',
            relatedId: doc.id,
            category: 'STAFF',
            sentAt: new Date(),
          },
        });
        alerted++;
      } catch (err) {
        failed++;
        Sentry.captureException(err, {
          tags: { cron: 'draft-alerts' },
          extra: { docId: doc.id, docNumber: doc.number },
        });
        this.logger.error(
          `[D1.3.1.1] alert failed for ${doc.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    this.logger.log(
      `[D1.3.1.1] DRAFT alerts complete: alerted=${alerted} skipped=${skipped} failed=${failed}`,
    );
    return { enabled: true, alerted, skipped, failed };
  }

  /**
   * Reads a boolean-shaped SystemConfig row directly via PrismaService.
   * Matches the helper pattern in ExpenseDocumentsService.readBoolFlag
   * (PR #884) — avoids dragging the full SettingsModule into the cron just
   * to read one key. Swallows DB errors → returns fallback.
   */
  private async readBoolFlag(key: string, fallback: boolean): Promise<boolean> {
    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key, deletedAt: null },
        select: { value: true },
      });
      if (!row?.value) return fallback;
      const v = row.value.trim().toLowerCase();
      if (v === 'true' || v === '1') return true;
      if (v === 'false' || v === '0') return false;
      return fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Reads a numeric-shaped SystemConfig row. Coerces with Number(); falls
   * back when parse fails or value is non-positive (alert thresholds <1
   * day make no sense and would spam everyone).
   */
  private async readNumberFlag(key: string, fallback: number): Promise<number> {
    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key, deletedAt: null },
        select: { value: true },
      });
      if (!row?.value) return fallback;
      const n = Number(row.value);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    } catch {
      return fallback;
    }
  }
}
