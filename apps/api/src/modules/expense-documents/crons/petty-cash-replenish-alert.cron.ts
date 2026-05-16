import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationCategory } from '../../notifications/notification-category.enum';

/**
 * D1.1.5.4 — Petty Cash replenish alert cron.
 *
 * Daily at 09:00 Asia/Bangkok. Computes the running balance of the petty-cash
 * float as `petty_cash_limit − Σ(POSTED PETTY_CASH_REIMBURSEMENT.totalAmount
 * in current BKK calendar month)`. When the balance falls below the OWNER-
 * configured `petty_cash_replenish_threshold` (SystemConfig, default 5000
 * THB), all OWNER users receive an IN_APP notification:
 *
 *   "ยอดเงินสดย่อยต่ำกว่าเกณฑ์ (฿{threshold}) — โปรดเติมเงิน"
 *
 * Threshold semantics (Tracking note "Kill or wire" — owner picked WIRE IT):
 * - `petty_cash_replenish_threshold = 0`  → alert disabled entirely (kill switch
 *   without removing the cron / schema).
 * - Default 5000 THB, valid 0–50000 (clamp).
 *
 * One alert per cron tick — no per-doc spam. Cron is idempotent: re-running on
 * the same day with a still-low balance simply re-sends today's IN_APP, which
 * NotificationsService deduplicates by (userId, subject, day) via its own
 * compliance / frequency-cap path. We don't add an explicit dedupe key here to
 * keep the cron simple.
 *
 * Future enhancement: per-branch tracking when SHOP-side accounting lands
 * (Phase A.5). Today petty cash is a single FINANCE-level float.
 */
@Injectable()
export class PettyCashReplenishAlertCron {
  private readonly logger = new Logger(PettyCashReplenishAlertCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Daily at 09:00 BKK — runs after the working day starts so OWNERs see it during business hours. */
  @Cron('0 9 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<{ alertsSent: number; balance: number; threshold: number; limit: number }> {
    try {
      const { limit, threshold } = await this.readConfig();
      // threshold = 0 → owner explicitly disabled. Skip the read entirely.
      if (threshold <= 0) {
        this.logger.log('Petty Cash replenish alert disabled (threshold=0)');
        return { alertsSent: 0, balance: 0, threshold: 0, limit };
      }

      // Sum POSTED PETTY_CASH_REIMBURSEMENT docs in the current BKK month.
      const monthRange = this.getBkkMonthRange();
      const sum = await this.prisma.expenseDocument.aggregate({
        where: {
          documentType: 'PETTY_CASH_REIMBURSEMENT',
          status: 'POSTED',
          documentDate: { gte: monthRange.start, lte: monthRange.end },
          deletedAt: null,
        },
        _sum: { totalAmount: true },
      });
      // ROUND_HALF_UP for money math per CLAUDE.md rule.
      const spent = (sum._sum.totalAmount ?? new Prisma.Decimal(0)) as Prisma.Decimal;
      const balance = new Prisma.Decimal(limit)
        .minus(spent)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

      if (balance.gte(threshold)) {
        this.logger.log(
          `Petty Cash balance ${balance.toFixed(2)} ≥ threshold ${threshold} — no alert`,
        );
        return {
          alertsSent: 0,
          balance: balance.toNumber(),
          threshold,
          limit,
        };
      }

      // Balance < threshold → notify all active OWNERs.
      const owners = await this.prisma.user.findMany({
        where: { role: 'OWNER', isActive: true, deletedAt: null },
        select: { id: true, email: true, name: true },
      });
      if (owners.length === 0) {
        this.logger.warn(
          'Petty Cash balance below threshold but no active OWNERs found — alert skipped',
        );
        return {
          alertsSent: 0,
          balance: balance.toNumber(),
          threshold,
          limit,
        };
      }

      const subject = `เงินสดย่อยต่ำกว่าเกณฑ์ — คงเหลือ ฿${balance.toFixed(2)}`;
      const message =
        `ยอดเงินสดย่อยต่ำกว่าเกณฑ์ (฿${threshold.toLocaleString('en-US')}) — โปรดเติมเงิน\n` +
        `วงเงิน: ฿${limit.toLocaleString('en-US')}\n` +
        `ใช้ไปเดือนนี้: ฿${spent.toFixed(2)}\n` +
        `คงเหลือ: ฿${balance.toFixed(2)}`;

      let alertsSent = 0;
      for (const owner of owners) {
        try {
          await this.notifications.send({
            channel: 'IN_APP',
            recipient: owner.email,
            subject,
            message,
            category: NotificationCategory.STAFF,
          });
          alertsSent++;
        } catch (e) {
          this.logger.warn(
            `Petty Cash replenish alert failed for OWNER ${owner.email}: ${(e as Error).message}`,
          );
        }
      }

      this.logger.log(
        `Petty Cash replenish alert sent: ${alertsSent}/${owners.length} OWNER(s), ` +
          `balance=${balance.toFixed(2)} threshold=${threshold} limit=${limit}`,
      );
      return {
        alertsSent,
        balance: balance.toNumber(),
        threshold,
        limit,
      };
    } catch (err) {
      // Capture but never throw — cron failures shouldn't crash the scheduler.
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'petty-cash-replenish-alert' },
      });
      this.logger.error(
        `Petty Cash replenish alert cron failed: ${(err as Error).message}`,
      );
      return { alertsSent: 0, balance: 0, threshold: 0, limit: 0 };
    }
  }

  /**
   * Read SystemConfig keys + clamp the threshold to a sane range. Defaults
   * match the spec: limit 5000, threshold 5000. Threshold range 0–50000; out
   * of range silently clamps to the default 5000.
   */
  private async readConfig(): Promise<{ limit: number; threshold: number }> {
    const rows = await this.prisma.systemConfig.findMany({
      where: {
        key: { in: ['petty_cash_limit', 'petty_cash_replenish_threshold'] },
        deletedAt: null,
      },
      select: { key: true, value: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));

    const limitRaw = Number(byKey.get('petty_cash_limit') ?? '5000');
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 5000;

    const thresholdRaw = Number(byKey.get('petty_cash_replenish_threshold') ?? '5000');
    let threshold = Number.isFinite(thresholdRaw) ? thresholdRaw : 5000;
    if (threshold < 0) threshold = 5000; // negative invalid → clamp to default
    if (threshold > 50000) threshold = 50000; // upper guard

    return { limit, threshold };
  }

  /**
   * Compute the [start, end] BKK-month window. Asia/Bangkok = UTC+7 (no DST),
   * so the first instant of the month in UTC is the 1st 00:00 BKK - 7h.
   * Exposed via stub-friendly indirection so tests can override.
   */
  /* istanbul ignore next */
  protected now(): Date {
    return new Date();
  }

  private getBkkMonthRange(): { start: Date; end: Date } {
    const now = this.now();
    const bkk = now.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m] = bkk.split('-').map((n) => parseInt(n, 10));
    // First instant of the current BKK month (00:00 BKK = -7h UTC).
    const start = new Date(Date.UTC(y, m - 1, 1, -7, 0, 0, 0));
    // First instant of next BKK month — used as exclusive upper bound after
    // subtracting 1ms so it lands at the last addressable instant of the
    // current BKK month.
    const nextMonthStartUtc = new Date(Date.UTC(y, m, 1, -7, 0, 0, 0));
    const end = new Date(nextMonthStartUtc.getTime() - 1);
    return { start, end };
  }
}
