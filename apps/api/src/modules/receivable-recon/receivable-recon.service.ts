import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Per-branch reconciliation between the journal "HP Receivable" balance
 * (account 11-2102) and the aggregated Payment outstanding for active
 * contracts. Built for T1-C4 — the existing data-audit check is company-wide,
 * which hides which branch is drifting.
 *
 * Threshold policy: branch considered "breached" when
 *   |gap| > max(outstanding × 0.001, 1000฿)
 * — 0.1% for large branches, minimum ฿1,000 for small ones. Mirrors the
 * existing data-audit.service.ts convention.
 */
@Injectable()
export class ReceivableReconService {
  private readonly logger = new Logger(ReceivableReconService.name);
  static readonly MIN_THRESHOLD_BAHT = 1000;
  static readonly THRESHOLD_PCT = 0.001;
  static readonly RETENTION_DAYS = 90;

  constructor(private readonly prisma: PrismaService) {}

  async reconcileBranches(): Promise<{
    rows: number;
    breached: Array<{ branchId: string; gap: number }>;
  }> {
    // Journal side: SUM(debit - credit) per branch for HP Receivable account.
    // Only include journal entries whose referenced Contract has a branchId —
    // orphan MANUAL journal lines without a contract aren't allocatable to
    // a branch and end up in the data-audit's company-wide check, not here.
    const journalRows = await this.prisma.$queryRaw<
      Array<{ branch_id: string; balance: Prisma.Decimal }>
    >`
      SELECT c.branch_id, COALESCE(SUM(jl.debit - jl.credit), 0)::decimal AS balance
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      JOIN contracts c ON c.id = je.reference_id AND je.reference_type = 'CONTRACT'
      WHERE jl.account_code = '11-2102'
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND jl.deleted_at IS NULL
        AND c.branch_id IS NOT NULL
      GROUP BY c.branch_id
    `;

    const paymentRows = await this.prisma.$queryRaw<
      Array<{ branch_id: string; outstanding: Prisma.Decimal }>
    >`
      SELECT c.branch_id, COALESCE(SUM(p.amount_due - p.amount_paid), 0)::decimal AS outstanding
      FROM payments p
      JOIN contracts c ON c.id = p.contract_id
      WHERE p.deleted_at IS NULL
        AND c.deleted_at IS NULL
        AND c.status IN ('ACTIVE', 'OVERDUE', 'DEFAULT')
        AND p.status IN ('PENDING', 'PARTIALLY_PAID')
        AND c.branch_id IS NOT NULL
      GROUP BY c.branch_id
    `;

    const journalMap = new Map<string, Prisma.Decimal>();
    for (const r of journalRows) journalMap.set(r.branch_id, new Prisma.Decimal(r.balance));
    const paymentMap = new Map<string, Prisma.Decimal>();
    for (const r of paymentRows) paymentMap.set(r.branch_id, new Prisma.Decimal(r.outstanding));

    const allBranchIds = new Set<string>([...journalMap.keys(), ...paymentMap.keys()]);

    const runDate = this.todayDateOnly();
    const breached: Array<{ branchId: string; gap: number }> = [];

    for (const branchId of allBranchIds) {
      const journalBalance = journalMap.get(branchId) ?? new Prisma.Decimal(0);
      const contractOutstanding = paymentMap.get(branchId) ?? new Prisma.Decimal(0);
      const gap = journalBalance.minus(contractOutstanding);
      const threshold = Prisma.Decimal.max(
        contractOutstanding.mul(ReceivableReconService.THRESHOLD_PCT),
        new Prisma.Decimal(ReceivableReconService.MIN_THRESHOLD_BAHT),
      );
      const isBreached = gap.abs().gt(threshold);

      await this.prisma.receivableReconLog.upsert({
        where: { runDate_branchId: { runDate, branchId } },
        update: {
          journalBalance,
          contractOutstanding,
          gap,
          threshold,
          breached: isBreached,
        },
        create: {
          runDate,
          branchId,
          journalBalance,
          contractOutstanding,
          gap,
          threshold,
          breached: isBreached,
        },
      });

      if (isBreached) {
        breached.push({ branchId, gap: gap.toNumber() });
      }
    }

    if (breached.length > 0) {
      this.logger.warn(
        `Receivable recon breaches: ${breached.length} branch(es) — ` +
          breached.map((b) => `${b.branchId}:${b.gap.toFixed(2)}`).join(', '),
      );
      Sentry.captureMessage(
        `Receivable↔Payment reconciliation breach: ${breached.length} branch(es)`,
        {
          level: 'warning',
          tags: { kind: 'cron-job', cron: 'receivable-recon' },
          extra: { breached, runDate },
        },
      );
    }

    return { rows: allBranchIds.size, breached };
  }

  async purgeOldLogs(): Promise<{ deleted: number }> {
    const cutoff = new Date(
      Date.now() - ReceivableReconService.RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const result = await this.prisma.receivableReconLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return { deleted: result.count };
  }

  private todayDateOnly(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
