import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
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
    // M5 fix: aggregate read + slot/CallLog/Contract/AuditLog writes all run inside one
    //         Serializable transaction so a payment arriving between read and write
    //         cannot race the kept/broken decision.
    // H4 fix: when one slot breaks, cascade-mark every later unresolved slot brokenAt
    //         too (cron filters out broken parent CallLogs, so unresolved children
    //         would otherwise be orphaned in pending forever).
    // N2 fix: targets are cumulative through each slot — slot N is kept iff payments
    //         within window cover slot1+...+slotN, not just slotN alone. Per-slot
    //         paidAmount stored is the slot's own contribution.
    type BrokenSlot = { id: string; slotIndex: number };

    const brokenSlot: BrokenSlot | null = await this.prisma.$transaction(
      async (tx): Promise<BrokenSlot | null> => {
        let cumulativeTarget = 0;
        let stillPending = false;
        let broken: BrokenSlot | null = null;

        for (const slot of p.slots) {
          const slotAmount = slot.settlementAmount.toNumber();
          cumulativeTarget += slotAmount;

          if (slot.keptAt || slot.brokenAt) continue;

          if (broken) {
            // Cascade-mark remaining unresolved slots broken — parent CallLog
            // is broken, so they would otherwise be orphaned in pending forever.
            await tx.promiseSlot.update({
              where: { id: slot.id },
              data: { brokenAt: now, lockedAt: now },
            });
            continue;
          }

          if (slot.settlementDate.getTime() >= cutoff.getTime()) {
            stillPending = true;
            continue;
          }

          const windowEnd = new Date(slot.settlementDate.getTime() + GRACE_DAYS * 86400 * 1000);
          const cycleStart = p.cycleStartedAt ?? p.createdAt;
          const sum = await tx.payment.aggregate({
            where: {
              contractId: p.contractId,
              deletedAt: null,
              OR: [
                { paidAt: { not: null, gte: cycleStart, lte: windowEnd } },
                { paidDate: { not: null, gte: cycleStart, lte: windowEnd } },
              ],
            },
            _sum: { amountPaid: true },
          });
          const paid = sum._sum.amountPaid?.toNumber() ?? 0;

          if (paid >= cumulativeTarget) {
            await tx.promiseSlot.update({
              where: { id: slot.id },
              data: { keptAt: now, paidAmount: slotAmount as unknown as never },
            });
          } else {
            broken = { id: slot.id, slotIndex: slot.slotIndex };
            await tx.promiseSlot.update({
              where: { id: slot.id },
              data: { brokenAt: now, lockedAt: now, paidAmount: paid as unknown as never },
            });
          }
        }

        if (broken) {
          await tx.callLog.update({ where: { id: p.id }, data: { brokenAt: now } });
          await tx.auditLog.create({
            data: {
              action: 'BROKEN_PROMISE',
              entity: 'contract',
              entityId: p.contractId,
              userId: systemUserId,
              newValue: {
                callLogId: p.id,
                slotIndex: broken.slotIndex,
                reason: 'SLOT_BROKEN_PAST_GRACE',
              },
            },
          });
        } else if (!stillPending) {
          await tx.callLog.update({ where: { id: p.id }, data: { keptAt: now } });
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

        return broken;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (brokenSlot) {
      try {
        await this.mdm.autoLock(
          p.contractId,
          `SLOT_BROKEN:slot${brokenSlot.slotIndex}`,
          systemUserId,
        );
      } catch (err) {
        this.logger.error(
          `MDM autoLock failed for contract ${p.contractId}: ${(err as Error).message}`,
        );
        Sentry.captureException(err, {
          tags: { cron: 'promise-resolution', step: 'mdm-autolock' },
          extra: {
            contractId: p.contractId,
            callLogId: p.id,
            slotIndex: brokenSlot.slotIndex,
          },
        });
        // Promise is already marked broken in DB — alert ops via Sentry to lock manually.
      }
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
