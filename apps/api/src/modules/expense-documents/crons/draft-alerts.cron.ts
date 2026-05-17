import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationCategory } from '../../notifications/notification-category.enum';

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
 * Delivery: routes through `NotificationsService.send()` so the D1.3.1.4
 * IN_APP master gate (`in_app_notifications_enabled`) and ComplianceService
 * dedup apply. Direct `prisma.notificationLog.create` is intentionally
 * avoided — it would bypass the kill switch.
 *
 * Outer try/catch + Sentry capture on full-tick failure (e.g. findMany
 * outage); inner per-doc try/catch isolates one bad row from poisoning the
 * batch.
 *
 * Schedule: 09:01 BKK — staggered ahead of ap-due-alerts (09:03) and
 * petty-cash-replenish-alert (09:05) to avoid thundering herd at 09:00.
 */
@Injectable()
export class DraftAlertsCron {
  private readonly logger = new Logger(DraftAlertsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Daily at 09:01 Asia/Bangkok — staggered to avoid the 09:00 thundering herd. */
  @Cron('1 9 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<{ enabled: boolean; alerted: number; skipped: number; failed: number }> {
    try {
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

      for (const doc of stale) {
        try {
          const recipient = doc.createdBy?.email || doc.createdById;
          // Route through NotificationsService so the IN_APP master gate
          // (#949) + ComplianceService dedup applies. SKIPPED is normal when
          // the gate is OFF — count it but don't error.
          const result = await this.notifications.send({
            channel: 'IN_APP',
            recipient,
            subject: 'เอกสารฉบับร่างค้าง',
            message: `เอกสารฉบับร่าง #${doc.number} ค้าง ${thresholdDays}+ วัน — โปรดส่งหรือลบ`,
            relatedId: doc.id,
            category: NotificationCategory.STAFF,
          });
          if (result.status === 'SENT') {
            alerted++;
          } else {
            skipped++;
          }
        } catch (err) {
          failed++;
          Sentry.captureException(err, {
            tags: { cron: 'draft-alerts', docId: doc.id },
            extra: { docNumber: doc.number },
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
    } catch (outerErr) {
      // Outer guard: a findMany outage or DB hiccup must not crash the
      // scheduler — capture and exit gracefully so subsequent ticks retry.
      Sentry.captureException(outerErr, {
        tags: { cron: 'draft-alerts', scope: 'tick' },
      });
      this.logger.error(
        `[D1.3.1.1] Cron tick failed: ${outerErr instanceof Error ? outerErr.message : outerErr}`,
      );
      return { enabled: false, alerted: 0, skipped: 0, failed: 0 };
    }
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
