import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Ghost-sale detection (T5-C5). Flags two fraud patterns:
 *
 *   1. Ghost contract: status=ACTIVE, age > 7 days, zero paid installments.
 *      If a real customer signed a contract, they almost always make at
 *      least the first payment within the first week. A week-old contract
 *      with no payments is either a data-entry error or a salesperson
 *      farming commission on fake customers.
 *
 *   2. Rapid void: a CANCELLED/VOIDED contract whose commission was accrued
 *      less than 30 days before the void. Commission paid, sale voided —
 *      classic wash-sale pattern.
 *
 * Runs daily 02:30 Asia/Bangkok — after the receivable recon cron at 02:00.
 */
@Injectable()
export class GhostSaleCron {
  private readonly logger = new Logger(GhostSaleCron.name);
  static readonly GHOST_THRESHOLD_DAYS = 7;
  static readonly RAPID_VOID_DAYS = 30;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('30 2 * * *', { timeZone: 'Asia/Bangkok' })
  async scan(): Promise<{ ghost: number; rapidVoid: number }> {
    try {
      const ghostCutoff = new Date(
        Date.now() - GhostSaleCron.GHOST_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
      );

      // Pattern 1: ACTIVE contracts with 0 paid installments, age > 7 days
      const ghostContracts = await this.prisma.contract.findMany({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          createdAt: { lt: ghostCutoff },
          payments: {
            none: {
              status: { in: ['PAID', 'PARTIALLY_PAID'] },
              deletedAt: null,
            },
          },
        },
        select: {
          id: true,
          contractNumber: true,
          branchId: true,
          salespersonId: true,
          createdAt: true,
        },
        take: 200,
      });

      // Pattern 2: Contracts soft-deleted within RAPID_VOID_DAYS of creation.
      // The system doesn't have a CANCELLED/VOIDED status — "void" here is
      // modelled as soft-delete via deletedAt. We flag when deletedAt -
      // createdAt < 30 days, i.e. the contract was rapidly killed after sale.
      const rapidVoidCutoff = new Date(
        Date.now() - GhostSaleCron.RAPID_VOID_DAYS * 24 * 60 * 60 * 1000,
      );
      const rapidVoids = await this.prisma.contract.findMany({
        where: {
          deletedAt: { gte: rapidVoidCutoff },
          createdAt: { gte: rapidVoidCutoff },
        },
        select: {
          id: true,
          contractNumber: true,
          branchId: true,
          salespersonId: true,
          createdAt: true,
          deletedAt: true,
        },
        take: 200,
      });

      if (ghostContracts.length > 0) {
        const byBranch = this.groupBy(ghostContracts, 'branchId');
        this.logger.warn(
          `Ghost sale cron flagged ${ghostContracts.length} contract(s)`,
        );
        Sentry.captureMessage(
          `Ghost sale detection: ${ghostContracts.length} ACTIVE contract(s) > 7d with 0 payments`,
          {
            level: 'warning',
            tags: { kind: 'cron-job', cron: 'ghost-sale' },
            extra: { count: ghostContracts.length, byBranch, contractIds: ghostContracts.slice(0, 50).map((c) => c.id) },
          },
        );
      }

      if (rapidVoids.length > 0) {
        const bySales = this.groupBy(rapidVoids, 'salespersonId');
        this.logger.warn(`Rapid void pattern: ${rapidVoids.length} in last ${GhostSaleCron.RAPID_VOID_DAYS}d`);
        Sentry.captureMessage(
          `Rapid void pattern: ${rapidVoids.length} contract(s) voided within ${GhostSaleCron.RAPID_VOID_DAYS}d of creation`,
          {
            level: 'warning',
            tags: { kind: 'cron-job', cron: 'ghost-sale' },
            extra: { count: rapidVoids.length, bySales },
          },
        );
      }

      return { ghost: ghostContracts.length, rapidVoid: rapidVoids.length };
    } catch (err) {
      this.logger.error(`Ghost sale cron failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'ghost-sale' } });
      return { ghost: 0, rapidVoid: 0 };
    }
  }

  private groupBy<T extends Record<string, unknown>>(
    rows: T[],
    key: keyof T,
  ): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows) {
      const k = String(r[key] ?? 'UNKNOWN');
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }
}
