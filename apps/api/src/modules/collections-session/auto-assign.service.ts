import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AssignmentSource, ContractStatus, UserRole } from '@prisma/client';
import { bangkokStartOfDay } from '../../utils/date.util';

// Policy constants — business rules, not tuning knobs. Keep in code.
const RECENT_RELATIONSHIP_DAYS = 30;
const ESCALATION_DAYS = 90;
const ESCALATION_BROKEN_PROMISES = 2;

interface ContractInput {
  id: string;
  assignedToId: string | null;
  branchId: string;
  daysOverdue: number;
  brokenPromiseCount: number;
}

interface CollectorInput {
  id: string;
  collectionsActive: boolean;
  branchId: string | null;
}

interface AssignmentRow {
  date: Date;
  contractId: string;
  collectorId: string | null;
  source: AssignmentSource;
  escalationFlag: boolean;
  position: number;
}

@Injectable()
export class AutoAssignService {
  private readonly logger = new Logger(AutoAssignService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  async runForDate(date: Date): Promise<{ assigned: number; pool: number; escalation: number }> {
    const cfg = await this.settings.getCollectionsConfig();
    const dateOnly = bangkokStartOfDay(date);

    const baseContracts = await this.prisma.contract.findMany({
      where: {
        // NOTE: original code used ['OVERDUE', 'PENDING'] but ContractStatus
        // has no PENDING value — that filter element was a latent no-op. Kept
        // OVERDUE only to preserve actual matched-rows behavior.
        status: { in: [ContractStatus.OVERDUE] },
        deletedAt: null,
      },
      select: {
        id: true,
        assignedToId: true,
        branchId: true,
      },
    });

    const contractIds = baseContracts.map((c) => c.id);

    // daysOverdue: latest ContractDailySnapshot per contract (snapshot cron
    // runs 17:10 daily, so at 06:00 we use yesterday's snapshot — close
    // enough for escalation/branch/round-robin decisions).
    const snapshots =
      contractIds.length > 0
        ? await this.prisma.contractDailySnapshot.findMany({
            where: { contractId: { in: contractIds } },
            orderBy: { date: 'desc' },
            distinct: ['contractId'],
            select: { contractId: true, daysOverdue: true },
          })
        : [];
    const daysOverdueMap = new Map(snapshots.map((s) => [s.contractId, s.daysOverdue]));

    // brokenPromiseCount: AuditLog count of BROKEN_PROMISE actions per contract.
    const brokenAgg =
      contractIds.length > 0
        ? await this.prisma.auditLog.groupBy({
            by: ['entityId'],
            where: {
              entityId: { in: contractIds },
              entity: 'Contract',
              action: 'BROKEN_PROMISE',
            },
            _count: { _all: true },
          })
        : [];
    const brokenMap = new Map(brokenAgg.map((r) => [r.entityId, r._count._all]));

    const contracts: ContractInput[] = baseContracts.map((c) => ({
      id: c.id,
      assignedToId: c.assignedToId,
      branchId: c.branchId,
      daysOverdue: daysOverdueMap.get(c.id) ?? 0,
      brokenPromiseCount: brokenMap.get(c.id) ?? 0,
    }));

    const collectors = (await this.prisma.user.findMany({
      where: { role: UserRole.SALES, collectionsActive: true, deletedAt: null },
      select: { id: true, collectionsActive: true, branchId: true },
    })) as unknown as CollectorInput[];

    const recentAssignments = await this.prisma.dailyAssignment.findMany({
      where: {
        date: { gte: addDays(dateOnly, -RECENT_RELATIONSHIP_DAYS) },
        collectorId: { not: null },
      },
      select: { contractId: true, collectorId: true, date: true },
      orderBy: { date: 'desc' },
    });

    const recentByContract = new Map<string, string>();
    for (const a of recentAssignments) {
      if (!recentByContract.has(a.contractId)) recentByContract.set(a.contractId, a.collectorId!);
    }

    const collectorIds = new Set(collectors.map((c) => c.id));
    const collectorByBranch = new Map<string, CollectorInput[]>();
    for (const c of collectors) {
      if (c.branchId) {
        if (!collectorByBranch.has(c.branchId)) collectorByBranch.set(c.branchId, []);
        collectorByBranch.get(c.branchId)!.push(c);
      }
    }

    const workload = new Map<string, number>();
    for (const c of collectors) workload.set(c.id, 0);

    const rows: AssignmentRow[] = [];
    let escalationCount = 0;
    let rrIndex = 0;

    for (const contract of contracts) {
      const isEscalation =
        contract.daysOverdue >= ESCALATION_DAYS &&
        contract.brokenPromiseCount >= ESCALATION_BROKEN_PROMISES;

      if (isEscalation) {
        rows.push({
          date: dateOnly,
          contractId: contract.id,
          collectorId: null,
          source: AssignmentSource.AUTO_ROUNDROBIN,
          escalationFlag: true,
          position: rows.length,
        });
        escalationCount++;
        continue;
      }

      let collectorId: string | null = null;
      let source: AssignmentSource = AssignmentSource.AUTO_ROUNDROBIN;

      if (contract.assignedToId && collectorIds.has(contract.assignedToId)) {
        collectorId = contract.assignedToId;
        source = AssignmentSource.AUTO_RELATIONSHIP;
      } else if (
        recentByContract.has(contract.id) &&
        collectorIds.has(recentByContract.get(contract.id)!)
      ) {
        collectorId = recentByContract.get(contract.id)!;
        source = AssignmentSource.AUTO_RECENT;
      } else {
        const branchCollectors = collectorByBranch.get(contract.branchId) ?? [];
        if (branchCollectors.length > 0) {
          branchCollectors.sort((a, b) => (workload.get(a.id) ?? 0) - (workload.get(b.id) ?? 0));
          collectorId = branchCollectors[0].id;
          source = AssignmentSource.AUTO_BRANCH;
        } else if (collectors.length > 0) {
          collectorId = collectors[rrIndex % collectors.length].id;
          rrIndex++;
          source = AssignmentSource.AUTO_ROUNDROBIN;
        }
      }

      if (collectorId) {
        workload.set(collectorId, (workload.get(collectorId) ?? 0) + 1);
      }

      rows.push({
        date: dateOnly,
        contractId: contract.id,
        collectorId,
        source,
        escalationFlag: false,
        position: rows.length,
      });
    }

    // Cap enforcement: push overflow to pool
    for (const [cid, count] of workload.entries()) {
      if (count > cfg.dailyCap) {
        const overflow = count - cfg.dailyCap;
        let pushed = 0;
        for (let i = rows.length - 1; i >= 0 && pushed < overflow; i--) {
          if (rows[i].collectorId === cid && !rows[i].escalationFlag) {
            rows[i].collectorId = null;
            rows[i].source = AssignmentSource.AUTO_ROUNDROBIN;
            pushed++;
          }
        }
        workload.set(cid, cfg.dailyCap);
      }
    }

    // Floor top-up
    const pool = rows.filter((r) => r.collectorId === null && !r.escalationFlag);
    for (const cid of collectorIds) {
      const have = workload.get(cid) ?? 0;
      if (have < cfg.workloadFloor && pool.length > 0) {
        const need = cfg.workloadFloor - have;
        for (let i = 0; i < pool.length && i < need; i++) {
          pool[i].collectorId = cid;
          pool[i].source = AssignmentSource.AUTO_ROUNDROBIN;
          workload.set(cid, (workload.get(cid) ?? 0) + 1);
        }
        pool.splice(0, Math.min(need, pool.length));
      }
    }

    const poolCount = rows.filter((r) => r.collectorId === null).length - escalationCount;

    await this.prisma.$transaction(async (tx: any) => {
      await tx.dailyAssignment.deleteMany({
        where: { date: dateOnly, status: 'PENDING' },
      });
      if (rows.length > 0) {
        await tx.dailyAssignment.createMany({
          data: rows.map((r) => ({
            date: r.date,
            contractId: r.contractId,
            collectorId: r.collectorId,
            source: r.source,
            escalationFlag: r.escalationFlag,
            position: r.position,
          })),
        });
      }
    });

    this.logger.log(
      `Auto-assign ${dateOnly.toISOString().slice(0, 10)}: ${rows.length - poolCount - escalationCount} assigned, ${poolCount} pool, ${escalationCount} escalation`,
    );

    return {
      assigned: rows.length - poolCount - escalationCount,
      pool: poolCount,
      escalation: escalationCount,
    };
  }
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
