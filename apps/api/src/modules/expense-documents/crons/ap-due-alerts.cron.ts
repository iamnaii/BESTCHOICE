import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationCategory } from '../../notifications/notification-category.enum';

/**
 * D1.3.1.2 — Accounts-Payable due alerts.
 *
 * Scans for POSTED expense documents that are still unpaid (paidAt IS NULL)
 * and have not been cleared by an active VENDOR_SETTLEMENT, alerting the
 * doc's approver (or creator as a fallback) via in-app notification.
 *
 * SystemConfig keys consumed:
 *   - `ap_due_alerts_enabled` (default 'false') — kill switch. **Default OFF**
 *     until ExpenseDocument has a real `dueDate` column (currently uses
 *     documentDate proxy which would otherwise spam alerts for every POSTED
 *     doc 3+ days old, regardless of actual vendor credit terms).
 *   - `ap_due_days_before`    (default 3)       — alert when doc has been
 *                                                 POSTED but unpaid for this
 *                                                 many days
 *
 * Implementation note on "due date":
 *   ExpenseDocument has no explicit `dueDate` column — credit terms live on
 *   Supplier, not propagated onto the doc at posting time. So the cron
 *   approximates the warning by counting days since `documentDate`. The
 *   default 3-day window means "remind me about anything that's been
 *   POSTED + unpaid for 3+ days" (per accountant's verbal spec: a vendor
 *   bill posted Monday should ping by Thursday if untouched).
 *
 * Delivery: routes through `NotificationsService.send()` so the D1.3.1.4
 * IN_APP master gate (`in_app_notifications_enabled`) and ComplianceService
 * dedup paths apply. Direct `prisma.notificationLog.create` is intentionally
 * avoided — it would bypass the kill switch.
 *
 * Outer try/catch + Sentry capture on full-tick failure (e.g. findMany
 * outage); inner per-doc try/catch isolates one bad row from poisoning the
 * batch.
 *
 * Schedule: 09:03 BKK — staggered behind draft-alerts (09:01) and the
 * existing 09:00 jobs to avoid thundering-herd on the worker.
 */
@Injectable()
export class ApDueAlertsCron {
  private readonly logger = new Logger(ApDueAlertsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Daily at 09:03 Asia/Bangkok — staggered to avoid the 09:00 thundering herd. */
  @Cron('3 9 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<{ enabled: boolean; alerted: number; skipped: number; failed: number }> {
    try {
      // Default OFF until ExpenseDocument has a real dueDate column (currently uses documentDate proxy)
      const enabled = await this.readBoolFlag('ap_due_alerts_enabled', false);
      if (!enabled) {
        this.logger.debug('[D1.3.1.2] AP-due alerts disabled — skipping');
        return { enabled: false, alerted: 0, skipped: 0, failed: 0 };
      }

      const daysBefore = await this.readNumberFlag('ap_due_days_before', 3);
      // Anything POSTED >= daysBefore ago is the alert window
      const cutoff = new Date(Date.now() - daysBefore * 24 * 60 * 60 * 1000);

      // Approach: POSTED + unpaid (paidAt null) + not cleared by any active
      // settlement. We filter at SQL level via the absence of any non-VOIDED
      // settlement line pointing at this doc.
      const candidates = await this.prisma.expenseDocument.findMany({
        where: {
          status: 'POSTED',
          paidAt: null,
          documentDate: { lte: cutoff },
          deletedAt: null,
          // Exclude docs already cleared by a non-voided VENDOR_SETTLEMENT.
          // VOIDED settlements re-open the AP per the existing service flow.
          settlementsClearingThis: {
            none: {
              settlement: {
                document: {
                  status: { not: 'VOIDED' },
                  deletedAt: null,
                },
              },
            },
          },
        },
        select: {
          id: true,
          number: true,
          documentType: true,
          documentDate: true,
          totalAmount: true,
          vendorName: true,
          approvedById: true,
          createdById: true,
          approvedBy: { select: { email: true, name: true } },
          createdBy: { select: { email: true, name: true } },
        },
      });

      this.logger.log(
        `[D1.3.1.2] AP-due alerts: ${candidates.length} doc(s) POSTED & unpaid ≥${daysBefore}d`,
      );
      if (candidates.length === 0) {
        return { enabled: true, alerted: 0, skipped: 0, failed: 0 };
      }

      let alerted = 0;
      let skipped = 0;
      let failed = 0;

      for (const doc of candidates) {
        try {
          // Prefer approver (the person who can act); fall back to creator.
          const recipientUser = doc.approvedBy ?? doc.createdBy ?? null;
          const recipient = recipientUser?.email
            ?? doc.approvedById
            ?? doc.createdById
            ?? '';
          const vendor = doc.vendorName ?? 'เจ้าหนี้';
          const amount = Number(doc.totalAmount).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          const message =
            `เอกสาร #${doc.number} (${vendor}) ครบกำหนดชำระ — ` +
            `ยอดคงค้าง ${amount} บาท · บันทึกเมื่อ ${doc.documentDate
              .toISOString()
              .slice(0, 10)} · กรุณาเตรียมการชำระ`;

          // Route through NotificationsService so the IN_APP master gate
          // (#949) + ComplianceService dedup applies. SKIPPED is normal when
          // the gate is OFF — count it but don't error.
          const result = await this.notifications.send({
            channel: 'IN_APP',
            recipient,
            subject: 'แจ้งครบกำหนดชำระเจ้าหนี้',
            message,
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
            tags: { cron: 'ap-due-alerts', docId: doc.id },
            extra: { docNumber: doc.number },
          });
          this.logger.error(
            `[D1.3.1.2] alert failed for ${doc.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      this.logger.log(
        `[D1.3.1.2] AP-due alerts complete: alerted=${alerted} skipped=${skipped} failed=${failed}`,
      );
      return { enabled: true, alerted, skipped, failed };
    } catch (outerErr) {
      // Outer guard: a findMany outage or DB hiccup must not crash the
      // scheduler — capture and exit gracefully so subsequent ticks retry.
      Sentry.captureException(outerErr, {
        tags: { cron: 'ap-due-alerts', scope: 'tick' },
      });
      this.logger.error(
        `[D1.3.1.2] Cron tick failed: ${outerErr instanceof Error ? outerErr.message : outerErr}`,
      );
      return { enabled: false, alerted: 0, skipped: 0, failed: 0 };
    }
  }

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

  private async readNumberFlag(key: string, fallback: number): Promise<number> {
    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key, deletedAt: null },
        select: { value: true },
      });
      if (!row?.value) return fallback;
      const n = Number(row.value);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    } catch {
      return fallback;
    }
  }
}
