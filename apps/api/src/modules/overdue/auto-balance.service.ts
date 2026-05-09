import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * P3 Task 2 — server-side auto-balance with exclusion rules.
 *
 * Distributes overdue contracts round-robin across all eligible collectors
 * (SALES / BRANCH_MANAGER / FINANCE_MANAGER / OWNER) while skipping cases
 * the OWNER almost certainly does NOT want re-shuffled:
 *
 *   1. status = LEGAL — already handed to legal team, do not move
 *   2. snooze active for the *previous* assignee — they explicitly parked
 *      it for later, moving it would erase that intent
 *   3. assignedAt within last 24h — collector just took the case; moving
 *      it again would thrash and erase context they just built
 *
 * Exclusions are mutually exclusive and tallied once each (LEGAL > snooze
 * > recent) so the UI preview ("rebalance N (ยกเว้น snooze X / LEGAL Y /
 * เพิ่งย้าย Z)") matches what the execute step will actually do.
 */
const COLLECTOR_ROLES = ['SALES', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'OWNER'];
const RECENT_ASSIGN_WINDOW_MS = 24 * 60 * 60 * 1000;

interface CandidateContract {
  id: string;
  status: string;
  assignedToId: string | null;
  assignedAt: Date | null;
}

export interface AutoBalancePreview {
  totalContracts: number;
  eligibleCount: number;
  excludedLegal: number;
  excludedSnooze: number;
  excludedRecentlyAssigned: number;
  collectorCount: number;
}

export interface AutoBalanceResult extends AutoBalancePreview {
  assigned: number;
}

@Injectable()
export class AutoBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Snapshot what auto-balance WOULD do (no writes). Drives UI preview. */
  async preview(): Promise<AutoBalancePreview> {
    const { contracts, collectors, classification } = await this.classify();
    return {
      totalContracts: contracts.length,
      eligibleCount: classification.eligible.length,
      excludedLegal: classification.excludedLegal,
      excludedSnooze: classification.excludedSnooze,
      excludedRecentlyAssigned: classification.excludedRecentlyAssigned,
      collectorCount: collectors.length,
    };
  }

  /** Apply round-robin to eligible contracts only. Returns counts. */
  async execute(actorId: string): Promise<AutoBalanceResult> {
    const { contracts, collectors, classification } = await this.classify();

    if (collectors.length === 0) {
      throw new BadRequestException('ไม่พบพนักงานสำหรับกระจายงาน');
    }

    const now = new Date();
    let assigned = 0;
    // Sequential to keep audit logs ordered + avoid clobbering each other.
    for (let i = 0; i < classification.eligible.length; i += 1) {
      const c = classification.eligible[i];
      const target = collectors[i % collectors.length];
      // Skip no-op writes (already on the same collector by chance).
      if (c.assignedToId === target.id) continue;
      await this.prisma.contract.update({
        where: { id: c.id },
        data: { assignedToId: target.id, assignedAt: now },
      });
      assigned += 1;
    }

    if (assigned > 0) {
      await this.prisma.auditLog.createMany({
        data: classification.eligible.slice(0, assigned).map((c) => ({
          userId: actorId,
          action: 'AUTO_BALANCE',
          entity: 'contract',
          entityId: c.id,
          newValue: { source: 'auto-balance', timestamp: now.toISOString() },
        })),
      });
    }

    return {
      assigned,
      totalContracts: contracts.length,
      eligibleCount: classification.eligible.length,
      excludedLegal: classification.excludedLegal,
      excludedSnooze: classification.excludedSnooze,
      excludedRecentlyAssigned: classification.excludedRecentlyAssigned,
      collectorCount: collectors.length,
    };
  }

  /**
   * Pull the candidate set + active snoozes, then bucket each contract
   * into LEGAL > snooze-protected > recently-assigned > eligible.
   * Single-pass evaluation so totals always sum to totalContracts.
   */
  private async classify(): Promise<{
    contracts: CandidateContract[];
    collectors: { id: string; name: string }[];
    classification: {
      eligible: CandidateContract[];
      excludedLegal: number;
      excludedSnooze: number;
      excludedRecentlyAssigned: number;
    };
  }> {
    const now = new Date();
    const recentCutoff = new Date(now.getTime() - RECENT_ASSIGN_WINDOW_MS);

    // Pull all overdue / active / legal contracts that are candidates for
    // workload redistribution. Mirrors the OWNER WorkloadGrid query
    // (queue tab=ALL) but only the fields we need for classification.
    const contracts = (await this.prisma.contract.findMany({
      where: {
        deletedAt: null,
        status: { in: ['OVERDUE', 'DEFAULT', 'TERMINATED', 'ACTIVE'] },
      },
      select: {
        id: true,
        status: true,
        assignedToId: true,
        assignedAt: true,
      },
    })) as CandidateContract[];

    const collectors = (
      await this.prisma.user.findMany({
        where: {
          role: { in: COLLECTOR_ROLES as any },
          isActive: true,
          deletedAt: null,
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    ).map((u: any) => ({ id: u.id, name: u.name }));

    // Pre-fetch active snoozes for the (contract, prevAssignee) pairs we
    // could possibly exclude on. Build a Set<contractId> for O(1) lookup.
    const candidateAssigneePairs = contracts
      .filter((c) => c.assignedToId)
      .map((c) => ({ contractId: c.id, userId: c.assignedToId as string }));

    let snoozedSet = new Set<string>();
    if (candidateAssigneePairs.length > 0) {
      const snoozes = await this.prisma.contractSnooze.findMany({
        where: {
          deletedAt: null,
          snoozedUntil: { gt: now },
          OR: candidateAssigneePairs.map((p) => ({
            contractId: p.contractId,
            userId: p.userId,
          })),
        },
        select: { contractId: true, userId: true },
      });
      // Defensive double-check: only count when userId matches the
      // *previous* assignee on the same contract. Protects against any
      // mock or future query loosening that returns extra rows.
      const prevAssigneeByContract = new Map(
        candidateAssigneePairs.map((p) => [p.contractId, p.userId]),
      );
      snoozedSet = new Set(
        snoozes
          .filter(
            (s: any) => prevAssigneeByContract.get(s.contractId) === s.userId,
          )
          .map((s: any) => s.contractId),
      );
    }

    const eligible: CandidateContract[] = [];
    let excludedLegal = 0;
    let excludedSnooze = 0;
    let excludedRecentlyAssigned = 0;

    for (const c of contracts) {
      // Order matters: each contract counted once. LEGAL is sticky regardless
      // of recent activity; snooze beats recent (both are "operator intent").
      if (c.status === 'TERMINATED') {
        excludedLegal += 1;
        continue;
      }
      if (snoozedSet.has(c.id)) {
        excludedSnooze += 1;
        continue;
      }
      if (c.assignedAt && c.assignedAt > recentCutoff) {
        excludedRecentlyAssigned += 1;
        continue;
      }
      eligible.push(c);
    }

    return {
      contracts,
      collectors,
      classification: {
        eligible,
        excludedLegal,
        excludedSnooze,
        excludedRecentlyAssigned,
      },
    };
  }
}
