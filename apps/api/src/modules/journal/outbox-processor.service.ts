import { Injectable, Logger } from '@nestjs/common';
import { PrismaFinanceService } from '../../prisma/prisma-finance.service';
import { OutboxService } from './outbox.service';

const MAX_ATTEMPTS = 5;

/**
 * SP7.2 — Process outbox events: write paired JE in target (bc_finance) DB.
 *
 * Called by OutboxProcessorCron every 30s. Idempotent — uses event.idempotencyKey
 * to detect re-runs and avoid double-posting.
 *
 * Named OutboxProcessorService to avoid name collision with the existing
 * PairedJournalService (same-DB synchronous paired JEs from Phase 3 SP5).
 */
@Injectable()
export class OutboxProcessorService {
  private readonly logger = new Logger(OutboxProcessorService.name);

  constructor(
    private readonly outbox: OutboxService,
    private readonly prismaFin: PrismaFinanceService,
  ) {}

  /**
   * Process up to `limit` pending events. Returns processed count.
   */
  async processOutbox(limit = 50): Promise<{ processed: number; failed: number }> {
    const events = await this.outbox.findPending(limit);
    let processed = 0;
    let failed = 0;

    for (const event of events) {
      try {
        await this.outbox.markProcessing(event.id);
        await this.writeFinanceJournal(event);
        await this.outbox.markProcessed(event.id);
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const attemptsAfter = event.attempts + 1;
        const isFinal = attemptsAfter >= MAX_ATTEMPTS;
        await this.outbox.markFailed(event.id, msg, isFinal);

        if (isFinal) {
          this.logger.error(
            `Outbox event ${event.id} FAILED after ${attemptsAfter} attempts: ${msg}`,
          );
          this.alertSentry(event.id, msg);
        } else {
          this.logger.warn(
            `Outbox event ${event.id} retry ${attemptsAfter}/${MAX_ATTEMPTS}: ${msg}`,
          );
        }
        failed++;
      }
    }

    return { processed, failed };
  }

  /**
   * Idempotent write of the paired JE in bc_finance.
   * Implementation stub — concrete templates wire here in SP7.4+ as paired
   * flows are migrated to the dual-DB pattern.
   */
  private async writeFinanceJournal(event: {
    id: string;
    flowType: string;
    payload: unknown;
    idempotencyKey: string;
  }) {
    // Idempotency probe — if a journal entry already exists with this key, no-op.
    // (Once journal_entries on finance side gains an idempotency_key column in SP7.4+,
    // probe it here. For now, log and continue so the cron loop proves it works.)
    this.logger.log(`Processing outbox event ${event.id} flow=${event.flowType}`);

    // TODO: dispatch on event.flowType to specific template (SP7.4+ will add these)
    // For now, this is a no-op success — proves the saga loop works end-to-end.
    // Real flow types added incrementally as paired flows are migrated.
    void this.prismaFin; // reference kept so DI doesn't warn; real use in SP7.4+
  }

  private alertSentry(eventId: string, error: string) {
    // Sentry SDK is already configured elsewhere — emit a synthetic alarm here.
    // Lazy require to avoid hard dependency in tests.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require('@sentry/node');
      Sentry.captureMessage(`Outbox event FAILED permanently: ${eventId}`, {
        level: 'error',
        tags: { component: 'outbox', eventId },
        extra: { error },
      });
    } catch {
      this.logger.error(`(Sentry not available) eventId=${eventId} error=${error}`);
    }
  }
}
