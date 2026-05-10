import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExpenseTemplatesService } from '../expense-templates.service';

@Injectable()
export class ExpenseRecurringCron {
  private readonly logger = new Logger(ExpenseRecurringCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templatesService: ExpenseTemplatesService,
  ) {}

  /** Daily at 08:00 Asia/Bangkok — auto-create DRAFT docs from recurring templates */
  @Cron('0 8 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<{ processed: number; failed: number; skipped: number }> {
    const now = new Date();
    // Compute "today" in Asia/Bangkok via Intl — server may run UTC, in which
    // case `now.getDate()` would be off by a day for a few hours each evening.
    const bkkParts = now.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [bkkY, bkkM, bkkD] = bkkParts.split('-').map((n) => parseInt(n, 10));
    const dayOfMonth = bkkD;
    // BKK = UTC+7 (no DST). Day spans [BKK 00:00 → BKK 23:59:59.999] which in
    // UTC is [-7:00..16:59:59.999] of the same calendar date, so we build the
    // window via UTC explicitly to avoid server-locale drift.
    const startOfDay = new Date(Date.UTC(bkkY, bkkM - 1, bkkD, -7, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(bkkY, bkkM - 1, bkkD, 16, 59, 59, 999));

    const templates = await this.prisma.expenseTemplate.findMany({
      where: { isRecurring: true, recurringDay: dayOfMonth, deletedAt: null },
    });
    this.logger.log(
      `Recurring cron: ${templates.length} template(s) due today (BKK day ${dayOfMonth})`,
    );

    if (templates.length === 0) return { processed: 0, failed: 0, skipped: 0 };

    // Resolve system user once
    const systemUser = await this.prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true, branchId: true, role: true },
    });
    if (!systemUser) {
      const msg = '[ExpenseRecurringCron] SYSTEM user not found — skipping run';
      this.logger.error(msg);
      Sentry.captureMessage(msg, { level: 'error', tags: { cron: 'expense-recurring' } });
      return { processed: 0, failed: 0, skipped: templates.length };
    }

    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const tpl of templates) {
      try {
        // Idempotency: skip if doc already exists for (branch, date, template)
        const existing = await this.prisma.expenseDocument.findFirst({
          where: {
            branchId: tpl.branchId,
            documentDate: { gte: startOfDay, lte: endOfDay },
            fromTemplateId: tpl.id,
            deletedAt: null,
          },
        });
        if (existing) {
          skipped++;
          continue;
        }

        // Use OWNER role for system context (cross-branch authoritative).
        // documentDate = BKK noon today so it falls cleanly in the BKK day.
        const bkkNoonToday = new Date(Date.UTC(bkkY, bkkM - 1, bkkD, 5, 0, 0, 0));
        await this.templatesService.instantiate(
          tpl.id,
          {
            id: systemUser.id,
            branchId: systemUser.branchId,
            role: 'OWNER',
          },
          { documentDate: bkkNoonToday },
        );
        processed++;
      } catch (e) {
        failed++;
        Sentry.captureException(e, {
          tags: { cron: 'expense-recurring' },
          extra: { templateId: tpl.id, templateName: tpl.name },
        });
        this.logger.error(
          `Recurring template instantiation failed for ${tpl.id}: ${(e as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Recurring cron complete: processed=${processed} failed=${failed} skipped=${skipped}`,
    );
    return { processed, failed, skipped };
  }
}
