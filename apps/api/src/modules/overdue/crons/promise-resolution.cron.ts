import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { MdmLockService } from '../mdm-lock.service';

/**
 * Promise-resolution cron — evaluates open PromiseSlot entries once per hour.
 *
 * For each active CallLog (result='PROMISED', nothing closed yet) it checks
 * every slot whose settlementDate is past the grace window:
 *
 *   - paidAmount in window >= settlementAmount → slot KEPT (keptAt = now)
 *   - otherwise → slot BROKEN (brokenAt = now), CallLog flagged broken,
 *     AuditLog 'BROKEN_PROMISE' written, MDM auto-lock triggered.
 *
 * When the final slot of a CallLog is kept → CallLog.keptAt set,
 * Contract.keptPromiseCount incremented.
 *
 * Replaces the legacy broken-promise.cron which had no per-slot accounting
 * and no kept-promise tracking.
 */

const GRACE_DAYS = 1;

@Injectable()
export class PromiseResolutionCron {
  private readonly logger = new Logger(PromiseResolutionCron.name);

  constructor(
    private prisma: PrismaService,
    private mdm: MdmLockService,
  ) {}

  @Cron('0 * * * *', { timeZone: 'Asia/Bangkok' })
  async handleHourly(): Promise<void> {
    try {
      const now = new Date();
      const cutoff = new Date(now.getTime() - GRACE_DAYS * 86400 * 1000);

      // Find all active promises that have at least one slot past the grace period
      // and not yet resolved (keptAt/brokenAt both null).
      const promises = await this.prisma.callLog.findMany({
        where: {
          deletedAt: null,
          result: 'PROMISED',
          brokenAt: null,
          supersededAt: null,
          keptAt: null,
          canceledAt: null,
          slots: { some: { settlementDate: { lt: cutoff }, keptAt: null, brokenAt: null } },
        },
        include: { slots: { orderBy: { slotIndex: 'asc' } } },
      });

      const systemUserId = await this.getSystemUserId();
      let resolved = 0;

      for (const p of promises) {
        try {
          await this.resolvePromise(p, now, cutoff, systemUserId);
          resolved++;
        } catch (err) {
          this.logger.error(`failed to resolve promise ${p.id}: ${(err as Error).message}`);
          Sentry.captureException(err, {
            tags: { cron: 'promise-resolution' },
            extra: { callLogId: p.id, contractId: p.contractId },
          });
        }
      }

      this.logger.log(`promise-resolution: resolved ${resolved}/${promises.length} promise(s)`);
      Sentry.captureMessage(`promise-resolution cron processed ${promises.length} promise(s)`, {
        level: 'info',
        tags: { kind: 'cron-job', cron: 'promise-resolution' },
        extra: { total: promises.length, resolved },
      });
    } catch (err) {
      this.logger.error(`promise-resolution cron failed: ${(err as Error).message}`);
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'promise-resolution' } });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async resolvePromise(p: any, now: Date, cutoff: Date, systemUserId: string) {
    // C3 fix: collect slot-level decisions OUTSIDE the DB transaction (payment aggregation
    // is read-only, keeping the transaction short), then wrap all writes in a single
    // $transaction so slot state, CallLog, Contract, and AuditLog are atomically consistent.
    // mdm.autoLock makes external API calls and is intentionally kept OUTSIDE the transaction
    // (same pattern as PaymentService: DB first, side effects after commit).

    let allSlotsResolved = true;
    let brokenSlot: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    // Collect per-slot decisions (paid amount, kept/broken) before opening the transaction.
    const slotDecisions: Array<{
      slot: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      kept: boolean;
      paid: number;
    }> = [];

    for (const slot of p.slots) {
      // Already resolved — skip
      if (slot.keptAt || slot.brokenAt) continue;

      // Not yet past grace — still pending, so promise overall not fully resolved
      if (slot.settlementDate.getTime() >= cutoff.getTime()) {
        allSlotsResolved = false;
        continue;
      }

      // The "paid window" ends at settlementDate + GRACE_DAYS — this ensures we
      // count payments made up to and including the grace period end.
      const windowEnd = new Date(slot.settlementDate.getTime() + GRACE_DAYS * 86400 * 1000);

      // C1 fix: filter by OR(paidAt/paidDate) so manual payments (which set paidDate,
      // not paidAt) are counted alongside PaySolutions webhook payments (which set paidAt).
      const sum = await this.prisma.payment.aggregate({
        where: {
          contractId: p.contractId,
          deletedAt: null,
          OR: [
            { paidAt: { not: null, lte: windowEnd } },
            { paidDate: { not: null, lte: windowEnd } },
          ],
        },
        _sum: { amountPaid: true },
      });

      const paid = sum._sum.amountPaid?.toNumber() ?? 0;
      const target = slot.settlementAmount.toNumber();
      const kept = paid >= target;

      slotDecisions.push({ slot, kept, paid });

      if (!kept) {
        brokenSlot = slot;
        allSlotsResolved = false;
        break; // stop on first broken slot
      }
    }

    // C3 fix: wrap all DB writes in a single transaction for atomicity.
    await this.prisma.$transaction(async (tx) => {
      for (const { slot, kept, paid } of slotDecisions) {
        if (kept) {
          await tx.promiseSlot.update({
            where: { id: slot.id },
            data: { keptAt: now, paidAmount: paid as unknown as never },
          });
        } else {
          await tx.promiseSlot.update({
            where: { id: slot.id },
            data: { brokenAt: now, lockedAt: now, paidAmount: paid as unknown as never },
          });
        }
      }

      if (brokenSlot) {
        await tx.callLog.update({
          where: { id: p.id },
          data: { brokenAt: now },
        });
        await tx.auditLog.create({
          data: {
            action: 'BROKEN_PROMISE',
            entity: 'contract',
            entityId: p.contractId,
            userId: systemUserId,
            newValue: {
              callLogId: p.id,
              slotIndex: brokenSlot.slotIndex,
              reason: 'SLOT_BROKEN_PAST_GRACE',
            },
          },
        });
      } else if (allSlotsResolved && slotDecisions.length > 0) {
        // All slots kept — mark the promise kept and credit keptPromiseCount
        await tx.callLog.update({
          where: { id: p.id },
          data: { keptAt: now },
        });
        await tx.contract.update({
          where: { id: p.contractId },
          data: { keptPromiseCount: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            action: 'KEPT_PROMISE',
            entity: 'contract',
            entityId: p.contractId,
            userId: systemUserId,
            newValue: { callLogId: p.id },
          },
        });
      }
      // else: some slots are still future-dated — nothing to do yet
    });

    // MDM side-effect AFTER transaction commits — external API call must not hold the DB tx open.
    if (brokenSlot) {
      await this.mdm.autoLock(
        p.contractId,
        `SLOT_BROKEN:slot${brokenSlot.slotIndex}`,
        systemUserId,
      );
    }
  }

  /**
   * Resolve the SYSTEM user UUID. Uses the same isSystemUser flag used
   * by MdmLockService.getSystemUserIdOrThrow() and broken-promise.cron.
   */
  private async getSystemUserId(): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!user) {
      throw new ServiceUnavailableException(
        'SYSTEM user not found — seed collections-foundation must run first',
      );
    }
    return user.id;
  }
}
