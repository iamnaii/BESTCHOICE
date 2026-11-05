import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, DunningStage } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { loadLateFeeConfig } from '../../../utils/late-fee.util';
import { ConsecutiveMissedService } from '../consecutive-missed.service';
import { UNSETTLED_PAYMENT_STATUSES } from '../today-queue.predicate';

/** Dunning back to the start — the fields resetDunningStage clears (Step 1b clears pending too). */
const DUNNING_START = {
  dunningStage: 'NONE',
  dunningEscalatedAt: null,
  dunningLastActionAt: null,
} satisfies Prisma.ContractUpdateManyMutationInput;

/**
 * Cron-driven lifecycle mutations for the overdue/collections module.
 *
 * Extracted from OverdueService as part of the behaviour-preserving decompose.
 * Holds the two raw-SQL paths ($executeRaw bulk late-fee UPDATE + $queryRaw
 * consecutive-missed CTE — moved VERBATIM) and the three status-update
 * $transactions (ACTIVE→OVERDUE, OVERDUE→ACTIVE once caught up, OVERDUE→DEFAULT).
 * Owns the shared private getSystemUserIdOrThrow, whose only callers are these crons.
 *
 * Consumed by notifications/scheduler.service.ts (calculateLateFees,
 * updateContractStatuses, escalateDunningStages) via the OverdueService facade.
 */
export class OverdueLifecycleCronService {
  private readonly logger = new Logger(OverdueLifecycleCronService.name);

  constructor(
    private prisma: PrismaService,
    private consecutiveMissed: ConsecutiveMissedService,
  ) {}

  private async getSystemUserIdOrThrow(): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!user) {
      // H1: ServiceUnavailableException → 503 not 500, so ops alerting
      // correctly identifies this as a config/seed issue rather than a crash.
      throw new ServiceUnavailableException(
        'SYSTEM user not found — seed collections-foundation must run first',
      );
    }
    return user.id;
  }

  /**
   * Calculate late fees for all overdue payments (cron job)
   * Uses a single SQL UPDATE for efficiency instead of N+1 queries.
   *
   * Flat-bracket formula (CPA ยืนยันขั้นบันไดถาวร 2026-08-01 — the only formula
   * in the system; the `late_fee_mode='PER_DAY'` config-switchable path that
   * briefly lived alongside this was removed the same day):
   *   CASE WHEN days >= tier2MinDays THEN tier2Amount WHEN days >= 1 THEN tier1Amount ELSE 0 END
   *
   * Byte-identical to the pre-D2 flat-bracket implementation (rollback parity).
   */
  async calculateLateFees() {
    const now = new Date();

    // Load the late-fee bracket config keys in one pass
    const cfg = await loadLateFeeConfig(this.prisma);

    const daysExpr = Prisma.sql`FLOOR(EXTRACT(EPOCH FROM (${now}::timestamp - "due_date")) / 86400)::int`;

    const feeExpr = Prisma.sql`CASE
        WHEN ${daysExpr} >= ${cfg.tier2MinDays} THEN ${cfg.tier2Amount}
        WHEN ${daysExpr} >= 1 THEN ${cfg.tier1Amount}
        ELSE 0 END`;

    const result = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "payments"
      SET
        "late_fee" = ${feeExpr},
        "status" = 'OVERDUE'
      WHERE "status" IN ('PENDING', 'PARTIALLY_PAID', 'OVERDUE')
        AND "due_date" < ${now}
        AND "late_fee_waived" = false
        -- Skip installments whose base is already settled (amount_paid >= amount_due).
        -- Those only have a (frozen) late fee outstanding; recomputing it from the
        -- days-overdue formula would resurrect/overwrite the fee AND wrongly flip a
        -- PARTIALLY_PAID row back to OVERDUE after the customer paid the principal.
        AND "amount_paid" < "amount_due"
        -- Once any payment is received, the cumulative fee is frozen for this
        -- installment, including zero. Staff may explicitly add a fee later.
        AND "amount_paid" <= 0
        AND "contract_id" IN (
          SELECT "id" FROM "contracts"
          WHERE "status" IN ('ACTIVE', 'OVERDUE', 'DEFAULT')
            AND "deleted_at" IS NULL
        )
    `);

    this.logger.log(`Late fees calculated: ${result} payments updated`);
    return { updated: result, timestamp: now };
  }

  /**
   * Update contract statuses based on overdue rules (cron job)
   * Uses bulk updates and batched transactions for efficiency
   */
  async updateContractStatuses() {
    const now = new Date();

    const systemUserId = await this.getSystemUserIdOrThrow();

    // Read overdue threshold from config
    const overdueConfig = await this.prisma.systemConfig.findUnique({
      where: { key: 'overdue_days_threshold' },
    });
    // Floored at 0: a negative value would put thresholdDate in the FUTURE, so Step 1
    // would flip contracts whose unpaid installment is not even due yet — which Step 1b
    // (dueDate < now) would then restore in the same run, every night.
    const overdueDays = Math.max(0, overdueConfig ? Number(overdueConfig.value) : 7);

    // Step 1: ACTIVE → OVERDUE (payments overdue > threshold days)
    // C3 fix: encode all filter conditions in flipWhere so that updateMany
    // re-evaluates them atomically on the DB side. A PaySolutions webhook
    // arriving between our findMany snapshot and the updateMany will therefore
    // exclude the now-paid contract automatically — no stale read-then-write race.
    const thresholdDate = new Date(now.getTime() - overdueDays * 24 * 60 * 60 * 1000);

    // T3-C11: Contracts promised-to-pay in last 24h are spared from auto-flip.
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const promisedContractIds: string[] = (
      await this.prisma.callLog.findMany({
        where: { result: 'PROMISED', calledAt: { gte: yesterday } },
        select: { contractId: true },
        distinct: ['contractId'],
      })
    ).map((r) => r.contractId);

    const flipWhere: Prisma.ContractWhereInput = {
      status: 'ACTIVE',
      deletedAt: null,
      id: promisedContractIds.length > 0 ? { notIn: promisedContractIds } : undefined,
      OR: [{ blockAutoEscalation: null }, { blockAutoEscalation: { lt: now } }],
      payments: {
        some: {
          // Same set Step 1b reads — shared constant so the two steps cannot drift
          // apart (drift = a contract eligible for both = flip-flop every night).
          status: { in: UNSETTLED_PAYMENT_STATUSES },
          dueDate: { lt: thresholdDate },
        },
      },
    };

    // Snapshot IDs before the flip so we can write audit logs. It is acceptable
    // if a few of these IDs drop out by the time updateMany runs (someone paid
    // in the intervening milliseconds) — updateMany re-evaluates the where clause
    // atomically and will exclude them. The extra audit-log row for a contract
    // that was not actually flipped is harmless; reconciliation catches it.
    const toFlip = await this.prisma.contract.findMany({
      where: flipWhere,
      select: { id: true },
    });

    // C3 fix: wrap updateMany + auditLog.createMany in a single $transaction so
    // the status flip and its audit trail land atomically. If the audit insert
    // fails (DB pressure etc), the status flip rolls back — no silent drift
    // between contract state and audit record.
    const txOps: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.contract.updateMany({
        where: flipWhere,
        data: { status: 'OVERDUE' },
      }),
    ];
    if (toFlip.length > 0) {
      txOps.push(
        this.prisma.auditLog.createMany({
          data: toFlip.map((c) => ({
            userId: systemUserId,
            action: 'STATUS_CHANGE',
            entity: 'contract',
            entityId: c.id,
            newValue: {
              from: 'ACTIVE',
              to: 'OVERDUE',
              reason: `Payment overdue > ${overdueDays} days`,
            },
            ipAddress: 'system-cron',
          })),
        }),
      );
    }
    const [flipResult] = (await this.prisma.$transaction(txOps)) as [
      Prisma.BatchPayload,
      ...unknown[],
    ];

    const overdueUpdated = flipResult.count;
    const activeIds = toFlip.map((c) => c.id);

    // Step 1b: OVERDUE → ACTIVE once the customer has caught up (owner decision
    // 2026-11-05). Before this step nothing ever moved a contract back, so a fully
    // caught-up contract stayed OVERDUE forever and the overdue reports/dashboards
    // that filter contracts by status OVERDUE/DEFAULT over-counted it.
    //
    // Caught up = NO installment that has already fallen due (dueDate < now) is
    // unsettled. "Unsettled" is the same UNSETTLED_PAYMENT_STATUSES set Step 1
    // flips on (PENDING / OVERDUE / PARTIALLY_PAID — a base-paid row that still
    // owes a late fee stays PARTIALLY_PAID and so still blocks). Like Step 1,
    // payment rows are NOT filtered by deletedAt. Together with `now` > thresholdDate
    // this makes "eligible here" ⇒ "not eligible for Step 1" by construction, so a
    // contract can never flip OVERDUE→ACTIVE→OVERDUE (or ACTIVE→OVERDUE→ACTIVE) in
    // one run, nor flip-flop across nights:
    //   - a contract Step 1 just flipped owns an unsettled row due before
    //     thresholdDate (< now) → excluded here;
    //   - an unpaid installment already past due but still inside the threshold
    //     keeps the contract OVERDUE (no flapping while the customer is late);
    //   - a contract restored here is ACTIVE, so Step 2's streak scan
    //     (statuses: ['OVERDUE']) never sees it — and its streak is 0 anyway.
    // DEFAULT is deliberately NOT restored — leaving DEFAULT stays a manual staff
    // action. The manual hold (blockAutoEscalation) and recent PROMISED call logs
    // guard ESCALATION only and do not apply to a contract that owes nothing past due.
    //
    // Side effects: status + one STATUS_CHANGE audit row per restored contract from
    // the system user (like Step 1), and dunning goes back to the start (owner
    // decision 2026-11-05): dunningStage NONE + escalation timestamps cleared (the
    // fields resetDunningStage clears) + any escalation still waiting for approval
    // dropped (pendingDunningStage/Since) — so the LIFF page stops showing a dunning
    // label and a contract that falls behind again escalates from REMINDER like a
    // fresh one. History (dunning_actions, audit rows, notification logs) is kept.
    // The audit row records the stage / pending stage that were reset. The 08:05
    // customer notice (CollectionsNotifierService.sendOvernightCollectionsNotices)
    // only reads STATUS_CHANGE rows whose `to` is OVERDUE/DEFAULT, so this sends nothing.
    const recoverWhere: Prisma.ContractWhereInput = {
      status: 'OVERDUE',
      deletedAt: null,
      payments: {
        none: {
          status: { in: UNSETTLED_PAYMENT_STATUSES },
          dueDate: { lt: now },
        },
      },
    };
    const candidates = await this.prisma.contract.findMany({
      where: recoverWhere,
      select: { id: true, dunningStage: true, pendingDunningStage: true },
    });
    let recoveredIds: string[] = [];
    if (candidates.length > 0) {
      const before = new Map(candidates.map((c) => [c.id, c]));
      recoveredIds = await this.prisma.$transaction(
        async (tx) => {
          // The full predicate rides on the update (atomic re-evaluation, like Step 1):
          // a receipt void that re-opens a past-due installment after the snapshot
          // excludes that contract on the DB side. updateManyAndReturn tells us which
          // rows actually changed, so audit rows are written for exactly those.
          const restored = await tx.contract.updateManyAndReturn({
            where: { ...recoverWhere, id: { in: [...before.keys()] } },
            data: {
              status: 'ACTIVE',
              ...DUNNING_START,
              pendingDunningStage: null,
              pendingDunningSince: null,
            },
            select: { id: true },
          });
          if (restored.length > 0) {
            await tx.auditLog.createMany({
              data: restored.map(({ id }) => ({
                userId: systemUserId,
                action: 'STATUS_CHANGE',
                entity: 'contract',
                entityId: id,
                newValue: {
                  from: 'OVERDUE',
                  to: 'ACTIVE',
                  reason: 'No unsettled installment past its due date (caught up)',
                  dunningReset: {
                    previousStage: before.get(id)?.dunningStage ?? null,
                    previousPendingStage: before.get(id)?.pendingDunningStage ?? null,
                  },
                },
                ipAddress: 'system-cron',
              })),
            });
          }
          return restored.map((r) => r.id);
        },
        // Prisma's 5s interactive default would abort the whole nightly run (Step 2 skipped)
        // on a large catch-up batch; one updateMany + one createMany stays well inside 30s.
        { timeout: 30_000 },
      );
      if (recoveredIds.length !== candidates.length) {
        this.logger.warn(
          `OVERDUE→ACTIVE: ${candidates.length - recoveredIds.length} contract(s) changed between snapshot and update and were not restored`,
        );
      }
    }
    const recoveredUpdated = recoveredIds.length;

    // Step 2: OVERDUE → DEFAULT (2+ consecutive missed payments).
    // Streak derivation lives in ConsecutiveMissedService (single source of truth) — งวดนับเป็นพลาดหลังสิ้นวันครบกำหนด
    // ตามปฏิทินไทย (Task 30 รอบ 5 · เจ้าของ 01/11): งวดที่ครบกำหนดวันนี้ยังไม่ทำให้สัญญาเป็น DEFAULT ในรอบ 00:30 ของวันนั้น
    const streaks = await this.consecutiveMissed.getStreaks({ statuses: ['OVERDUE'] }, now);
    const defaultCandidates: { id: string; consecutive: number }[] = [...streaks.entries()]
      .filter(([, consecutive]) => consecutive >= 2)
      .map(([id, consecutive]) => ({ id, consecutive }));

    let defaultUpdated = 0;
    const defaultIds = defaultCandidates.map((c) => c.id);

    if (defaultIds.length > 0) {
      const txOps: Prisma.PrismaPromise<unknown>[] = [
        this.prisma.contract.updateMany({
          where: { id: { in: defaultIds } },
          data: { status: 'DEFAULT' },
        }),
        this.prisma.auditLog.createMany({
          data: defaultCandidates.map((c) => ({
            userId: systemUserId,
            action: 'STATUS_CHANGE',
            entity: 'contract',
            entityId: c.id,
            newValue: {
              from: 'OVERDUE',
              to: 'DEFAULT',
              reason: `${c.consecutive} consecutive missed payments`,
            },
            ipAddress: 'system-cron',
          })),
        }),
      ];
      await this.prisma.$transaction(txOps);
      defaultUpdated = defaultIds.length;
    }

    this.logger.log(
      `Contract status update: ${overdueUpdated} overdue, ${recoveredUpdated} back to active, ${defaultUpdated} default`,
    );
    return {
      overdueUpdated,
      recoveredUpdated,
      defaultUpdated,
      overdueIds: activeIds,
      recoveredIds,
      defaultIds,
      timestamp: now,
    };
  }

  /**
   * Dunning workflow: auto-escalate contracts through dunning stages
   * Based on oldest overdue payment days:
   *   NONE → REMINDER (1-7 days overdue)
   *   REMINDER → NOTICE (8-30 days)
   *   NOTICE → FINAL_WARNING (31-60 days)
   *   FINAL_WARNING → LEGAL_ACTION (>60 days)
   *
   * Returns list of contracts that were escalated (for notification dispatch).
   */
  async escalateDunningStages() {
    const now = new Date();

    // Dunning thresholds (days overdue → target stage)
    const stages: { minDays: number; stage: DunningStage }[] = [
      { minDays: 61, stage: 'LEGAL_ACTION' },
      { minDays: 31, stage: 'FINAL_WARNING' },
      { minDays: 8, stage: 'NOTICE' },
      { minDays: 1, stage: 'REMINDER' },
    ];

    // Find overdue/default contracts in batches to prevent unbounded memory usage
    const BATCH_SIZE = 500;
    let contracts: {
      id: string;
      contractNumber: string;
      dunningStage: DunningStage;
      payments: { dueDate: Date }[];
    }[] = [];
    let skip = 0;
    let hasMore = true;
    while (hasMore) {
      const batch = await this.prisma.contract.findMany({
        where: {
          status: { in: ['OVERDUE', 'DEFAULT'] },
          deletedAt: null,
        },
        select: {
          id: true,
          contractNumber: true,
          dunningStage: true,
          payments: {
            where: {
              status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
              dueDate: { lt: now },
            },
            orderBy: { dueDate: 'asc' },
            take: 1,
            select: { dueDate: true },
          },
        },
        take: BATCH_SIZE,
        skip,
      });
      contracts = contracts.concat(batch as typeof contracts);
      if (batch.length < BATCH_SIZE) {
        hasMore = false;
        break;
      }
      skip += BATCH_SIZE;
    }

    const escalated: {
      contractId: string;
      contractNumber: string;
      from: DunningStage;
      to: DunningStage;
      daysOverdue: number;
    }[] = [];

    const systemUserId = await this.getSystemUserIdOrThrow();

    for (const contract of contracts) {
      if (contract.payments.length === 0) continue;

      const oldestDue = contract.payments[0].dueDate;
      const daysOverdue = Math.floor((now.getTime() - oldestDue.getTime()) / (1000 * 60 * 60 * 24));

      // Determine target stage
      let targetStage: DunningStage = 'NONE';
      for (const { minDays, stage } of stages) {
        if (daysOverdue >= minDays) {
          targetStage = stage;
          break;
        }
      }

      // Only escalate (never de-escalate)
      const stageOrder: DunningStage[] = [
        'NONE',
        'REMINDER',
        'NOTICE',
        'FINAL_WARNING',
        'LEGAL_ACTION',
      ];
      const currentIdx = stageOrder.indexOf(contract.dunningStage);
      const targetIdx = stageOrder.indexOf(targetStage);

      if (targetIdx > currentIdx) {
        // T4-C2: FINAL_WARNING and LEGAL_ACTION messages carry legal +
        // PDPA risk if fired auto on a disputed debt. Park them as pending
        // and wait for a human OWNER/FM to approve.
        const requiresApproval = targetStage === 'FINAL_WARNING' || targetStage === 'LEGAL_ACTION';

        if (requiresApproval) {
          await this.prisma.contract.update({
            where: { id: contract.id },
            data: {
              pendingDunningStage: targetStage,
              pendingDunningSince: now,
            },
          });
          await this.prisma.auditLog.create({
            data: {
              userId: systemUserId,
              action: 'DUNNING_ESCALATION_PENDING',
              entity: 'contract',
              entityId: contract.id,
              oldValue: { dunningStage: contract.dunningStage },
              newValue: { pendingDunningStage: targetStage, daysOverdue },
              ipAddress: 'system-cron',
            },
          });
          continue; // no stage flip, no customer notification this round
        }

        await this.prisma.contract.update({
          where: { id: contract.id },
          data: {
            dunningStage: targetStage,
            dunningEscalatedAt: now,
            dunningLastActionAt: now,
          },
        });

        await this.prisma.auditLog.create({
          data: {
            userId: systemUserId,
            action: 'DUNNING_ESCALATION',
            entity: 'contract',
            entityId: contract.id,
            oldValue: { dunningStage: contract.dunningStage },
            newValue: { dunningStage: targetStage, daysOverdue },
            ipAddress: 'system-cron',
          },
        });

        escalated.push({
          contractId: contract.id,
          contractNumber: contract.contractNumber,
          from: contract.dunningStage,
          to: targetStage,
          daysOverdue,
        });
      }
    }

    this.logger.log(`Dunning escalation: ${escalated.length} contracts escalated`);
    return { escalated, timestamp: now };
  }

  /**
   * Reset dunning stage when a contract is no longer overdue
   * (e.g., after a payment brings it back to ACTIVE)
   */
  async resetDunningStage(contractId: string) {
    return this.prisma.contract.update({
      where: { id: contractId },
      data: { ...DUNNING_START },
    });
  }
}
