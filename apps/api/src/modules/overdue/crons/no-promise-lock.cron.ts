import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { MdmLockService } from '../mdm-lock.service';

/**
 * No-promise-lock cron — auto-locks contracts where collections attempts
 * have failed to produce any active promise-to-pay.
 *
 * Trigger condition: the last 2 call logs for a contract are both
 * "no-contact" results (NO_ANSWER or UNREACHABLE), AND the contract
 * has no currently active/open promise (result='PROMISED' with no
 * terminal state set).
 *
 * Runs hourly. Idempotent via the `deviceLocked: false` filter in the
 * candidate query — already-locked contracts are skipped at the DB level.
 *
 * The "no active promise" filter uses the same callLogs.none approach
 * as the broader collections query layer so it stays consistent.
 */

const NO_CONTACT_RESULTS = ['NO_ANSWER', 'UNREACHABLE'];

// COMMENT: UI currently maps the "ติดต่อไม่ได้" (UNREACHABLE) outcome to result='NO_ANSWER'
// for legacy compatibility (ContactLogDialog line 211). The fine-grained channel is stored in
// callResult='UNREACHABLE'. This cron therefore checks BOTH result AND callResult so that
// genuine UNREACHABLE attempts are caught whether the UI stored them as 'NO_ANSWER' (result)
// or 'UNREACHABLE' (callResult). This avoids the UNREACHABLE branch being dead code for UI calls.
function isNoContact(cl: { result: string; callResult: string | null }): boolean {
  return (
    NO_CONTACT_RESULTS.includes(cl.result) ||
    (cl.callResult !== null && NO_CONTACT_RESULTS.includes(cl.callResult))
  );
}

@Injectable()
export class NoPromiseLockCron {
  private readonly logger = new Logger(NoPromiseLockCron.name);

  constructor(
    private prisma: PrismaService,
    private mdm: MdmLockService,
  ) {}

  @Cron('0 * * * *', { timeZone: 'Asia/Bangkok' })
  async handleHourly(): Promise<void> {
    try {
      // Find unlocked overdue/default contracts with no active open promise
      const candidates = await this.prisma.contract.findMany({
        where: {
          deletedAt: null,
          deviceLocked: false,
          status: { in: ['OVERDUE', 'DEFAULT'] },
          callLogs: {
            none: {
              deletedAt: null,
              result: 'PROMISED',
              brokenAt: null,
              supersededAt: null,
              keptAt: null,
              canceledAt: null,
            },
          },
        },
        select: { id: true, deviceLocked: true },
      });

      if (candidates.length === 0) {
        this.logger.log('no-promise-lock: no candidates');
        return;
      }

      const systemUserId = await this.getSystemUserId();
      let locked = 0;

      for (const c of candidates) {
        try {
          const last2 = await this.prisma.callLog.findMany({
            where: { contractId: c.id, deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 2,
            select: { id: true, result: true, callResult: true, createdAt: true },
          });

          if (last2.length === 2 && last2.every(isNoContact)) {
            await this.mdm.autoLock(c.id, 'NO_PROMISE_2_NO_CONTACT', systemUserId);
            locked++;
          }
        } catch (err) {
          this.logger.error(`no-promise-lock failed for contract ${c.id}: ${(err as Error).message}`);
          Sentry.captureException(err, {
            tags: { cron: 'no-promise-lock' },
            extra: { contractId: c.id },
          });
        }
      }

      this.logger.log(`no-promise-lock: locked ${locked}/${candidates.length} contract(s)`);
      Sentry.captureMessage(`no-promise-lock cron locked ${locked} contract(s)`, {
        level: 'info',
        tags: { kind: 'cron-job', cron: 'no-promise-lock' },
        extra: { candidates: candidates.length, locked },
      });
    } catch (err) {
      this.logger.error(`no-promise-lock cron failed: ${(err as Error).message}`);
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'no-promise-lock' } });
    }
  }

  /**
   * Resolve the SYSTEM user UUID — same pattern as MdmLockService.getSystemUserIdOrThrow()
   * and broken-promise.cron (isSystemUser: true).
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
