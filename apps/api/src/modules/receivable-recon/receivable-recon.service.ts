import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CONTRACT_RECEIVABLE_TOLERANCE,
  isReceivableGapBreached,
  loadContractReceivableGaps,
  type ContractReceivableGap,
} from '../journal/contract-receivable-recon';

/**
 * Per-branch snapshot of the HP receivable reconciliation (T1-C4), written daily by
 * `ReceivableReconCron` (02:00 Asia/Bangkok) into `receivable_recon_logs`.
 *
 * **2026-10-30 (Task 16 — before the legacy back-office import of 1 Dec) the definition changed;
 * rows written before this date are not comparable with rows after it.** The old version summed
 * account 11-2102 (the allowance for doubtful accounts — a contra account, not the receivable)
 * over entries joined by `reference_type = 'CONTRACT'`, which no code writes (every automatic
 * entry is `'AUTO'`), so its journal side was always 0 and every branch with > ฿1,000 outstanding
 * "breached" nightly. It also counted only PENDING / PARTIALLY_PAID rows (overdue rows are
 * OVERDUE) and used a per-branch threshold max(0.1 %, ฿1,000) that hides a single bad contract.
 *
 * Now each branch row aggregates the per-contract calculator in
 * `journal/contract-receivable-recon.ts` (ledger 11-2101 + 11-2103 + 11-2105 by
 * `metadata.contractId` vs register Σ(amountDue − amountPaid) + fees/rounding inside amountPaid,
 * contracts ACTIVE / OVERDUE / DEFAULT only — TERMINATED is a known gap documented there):
 *   - `journalBalance` / `contractOutstanding` / `gap` = sums over the branch's contracts
 *   - `threshold` = the **per-contract** tolerance `CONTRACT_RECEIVABLE_TOLERANCE` (1.00 THB) —
 *     no longer a branch-level amount
 *   - `breached` = at least one contract of the branch is beyond that tolerance; the breaching
 *     contracts (id / number / gap — no personal data) go to the Sentry warning
 */
@Injectable()
export class ReceivableReconService {
  private readonly logger = new Logger(ReceivableReconService.name);
  static readonly RETENTION_DAYS = 90;
  /** สัญญาที่เกินเกณฑ์ที่ส่งไป Sentry ต่อรอบ */
  static readonly SENTRY_CONTRACT_LIMIT = 50;

  constructor(private readonly prisma: PrismaService) {}

  async reconcileBranches(): Promise<{
    rows: number;
    breached: Array<{ branchId: string; gap: number; contracts: number }>;
  }> {
    const gaps = await loadContractReceivableGaps(this.prisma);
    const byBranch = new Map<string, ContractReceivableGap[]>();
    for (const row of gaps) {
      // Contracts without a branch aren't allocatable here — the company-wide data-audit
      // check (`hp_receivable_reconciliation`) still covers them.
      if (!row.branchId) continue;
      const list = byBranch.get(row.branchId) ?? [];
      list.push(row);
      byBranch.set(row.branchId, list);
    }

    const runDate = this.todayDateOnly();
    const zero = new Prisma.Decimal(0);
    const threshold = new Prisma.Decimal(CONTRACT_RECEIVABLE_TOLERANCE);
    const breached: Array<{ branchId: string; gap: number; contracts: number }> = [];
    const breachedContracts: Array<{
      branchId: string;
      contractId: string;
      contractNumber: string;
      gap: string;
    }> = [];

    for (const [branchId, rows] of byBranch) {
      const journalBalance = rows.reduce((s, r) => s.plus(r.glReceivable), zero);
      const contractOutstanding = rows.reduce((s, r) => s.plus(r.registerOutstanding), zero);
      const gap = journalBalance.minus(contractOutstanding);
      const over = rows.filter(isReceivableGapBreached);
      const isBreached = over.length > 0;

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
        breached.push({ branchId, gap: gap.toNumber(), contracts: over.length });
        for (const r of over) {
          breachedContracts.push({
            branchId,
            contractId: r.contractId,
            contractNumber: r.contractNumber,
            gap: r.gap.toFixed(2),
          });
        }
      }
    }

    if (breached.length > 0) {
      this.logger.warn(
        `Receivable recon breaches: ${breached.length} branch(es), ${breachedContracts.length} contract(s) — ` +
          breached.map((b) => `${b.branchId}:${b.contracts}`).join(', '),
      );
      Sentry.captureMessage(
        `Receivable↔Payment reconciliation breach: ${breachedContracts.length} contract(s) in ${breached.length} branch(es)`,
        {
          level: 'warning',
          tags: { kind: 'cron-job', cron: 'receivable-recon' },
          extra: {
            breached,
            contracts: breachedContracts.slice(0, ReceivableReconService.SENTRY_CONTRACT_LIMIT),
            tolerancePerContract: threshold.toFixed(2),
            runDate,
          },
        },
      );
    }

    return { rows: byBranch.size, breached };
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
