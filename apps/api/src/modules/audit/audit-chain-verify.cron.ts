import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { AuditService } from './audit.service';

/**
 * T2-C4 ext: nightly walk of the AuditLog Merkle chain. Any mismatch means
 * someone (or some process) tampered with a row after insert. Sentry fires
 * as `fatal` because this is an integrity incident, not a warning — it
 * should page the on-call.
 */
@Injectable()
export class AuditChainVerifyCron {
  private readonly logger = new Logger(AuditChainVerifyCron.name);

  constructor(private readonly audit: AuditService) {}

  @Cron('45 3 * * *', { timeZone: 'Asia/Bangkok' })
  async verify(): Promise<{ ok: boolean; rowsChecked: number }> {
    try {
      const result = await this.audit.verifyChain({ maxRows: 50_000 });
      if (!result.ok) {
        this.logger.error(
          `AuditLog chain broken at seq=${result.firstMismatchSeq} id=${result.firstMismatchId}`,
        );
        Sentry.captureMessage(
          `AuditLog Merkle chain mismatch — seq=${result.firstMismatchSeq} id=${result.firstMismatchId}`,
          {
            level: 'fatal',
            tags: { kind: 'audit-chain', cron: 'audit-chain-verify' },
            extra: {
              rowsChecked: result.rowsChecked,
              firstMismatchSeq: result.firstMismatchSeq?.toString() ?? null,
              firstMismatchId: result.firstMismatchId,
            },
          },
        );
      } else {
        this.logger.log(`AuditLog chain verified — ${result.rowsChecked} row(s) OK`);
      }
      return { ok: result.ok, rowsChecked: result.rowsChecked };
    } catch (err) {
      this.logger.error(`Audit chain verify failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'audit-chain-verify' },
      });
      return { ok: false, rowsChecked: 0 };
    }
  }
}
