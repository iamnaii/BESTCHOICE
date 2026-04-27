import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCallLogDto } from './dto/create-call-log.dto';
import { Prisma, DunningStage } from '@prisma/client';
import { BUSINESS_RULES } from '../../utils/config.util';
import { DunningEngineService } from './dunning-engine.service';
import { OverdueKpiService } from './kpi.service';
import { PromiseService } from './promise.service';

@Injectable()
export class OverdueService {
  private readonly logger = new Logger(OverdueService.name);

  constructor(
    private prisma: PrismaService,
    private dunningEngine: DunningEngineService,
    private kpiService: OverdueKpiService,
    private promiseService: PromiseService,
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
   * Get all overdue/default contracts with filters and pagination
   */
  async findOverdueContracts(filters: {
    branchId?: string;
    status?: string;
    search?: string;
    userRole: string;
    userBranchId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.ContractWhereInput = {
      status: { in: ['OVERDUE', 'DEFAULT'] },
      deletedAt: null,
    };

    // Branch-level access control
    if (filters.userRole === 'SALES' || filters.userRole === 'BRANCH_MANAGER') {
      if (filters.userBranchId) {
        where.branchId = filters.userBranchId;
      }
    } else if (filters.branchId) {
      where.branchId = filters.branchId;
    }

    if (filters.status && ['OVERDUE', 'DEFAULT'].includes(filters.status)) {
      where.status = filters.status as 'OVERDUE' | 'DEFAULT';
    }

    if (filters.search) {
      where.OR = [
        { contractNumber: { contains: filters.search, mode: 'insensitive' } },
        { customer: { name: { contains: filters.search, mode: 'insensitive' } } },
        { customer: { phone: { contains: filters.search } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true, lineId: true } },
          product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true } },
          branch: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true } },
          payments: {
            where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] } },
            orderBy: { installmentNo: 'asc' },
          },
          callLogs: {
            orderBy: { calledAt: 'desc' },
            take: 3,
            include: { caller: { select: { id: true, name: true } } },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.contract.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get overdue summary statistics
   */
  async getOverdueSummary(userRole: string, userBranchId?: string) {
    const branchFilter: Prisma.ContractWhereInput =
      (userRole === 'SALES' || userRole === 'BRANCH_MANAGER') && userBranchId
        ? { branchId: userBranchId }
        : {};

    const [overdueCount, defaultCount, totalOverdueAmount] = await Promise.all([
      this.prisma.contract.count({
        where: { status: 'OVERDUE', deletedAt: null, ...branchFilter },
      }),
      this.prisma.contract.count({
        where: { status: 'DEFAULT', deletedAt: null, ...branchFilter },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
          dueDate: { lt: new Date() },
          contract: { status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null, ...branchFilter },
        },
        _sum: { amountDue: true, amountPaid: true, lateFee: true },
      }),
    ]);

    const amountDue = new Prisma.Decimal(totalOverdueAmount._sum.amountDue ?? 0);
    const amountPaid = new Prisma.Decimal(totalOverdueAmount._sum.amountPaid ?? 0);
    const lateFees = new Prisma.Decimal(totalOverdueAmount._sum.lateFee ?? 0);

    return {
      overdueCount,
      defaultCount,
      totalOverdueAmount: amountDue.sub(amountPaid).toNumber(),
      totalLateFees: lateFees.toNumber(),
    };
  }

  /**
   * Get contract detail with full call log timeline
   */
  async getContractTimeline(contractId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      include: {
        customer: true,
        product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true } },
        branch: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
        callLogs: {
          orderBy: { calledAt: 'desc' },
          include: { caller: { select: { id: true, name: true } } },
        },
      },
    });

    if (!contract) throw new NotFoundException('ไม่พบสัญญา');
    return contract;
  }

  /**
   * Create a call log entry with audit trail
   */
  async createCallLog(dto: CreateCallLogDto, callerId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: dto.contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const callLog = await this.prisma.callLog.create({
      data: {
        contractId: dto.contractId,
        callerId,
        calledAt: new Date(dto.calledAt),
        result: dto.result,
        notes: dto.notes,
      },
      include: {
        caller: { select: { id: true, name: true } },
        contract: {
          select: { contractNumber: true, customer: { select: { name: true } } },
        },
      },
    });

    // Audit log for call
    await this.prisma.auditLog.create({
      data: {
        userId: callerId,
        action: 'CREATE_CALL_LOG',
        entity: 'call_log',
        entityId: callLog.id,
        newValue: {
          contractId: dto.contractId,
          contractNumber: contract.contractNumber,
          result: dto.result,
          calledAt: dto.calledAt,
        },
        ipAddress: '',
      },
    });

    return callLog;
  }

  /**
   * Get call logs for a contract
   */
  async getCallLogs(contractId: string, page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);
    const where = { contractId };
    const [data, total] = await Promise.all([
      this.prisma.callLog.findMany({
        where,
        orderBy: { calledAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
        include: {
          caller: { select: { id: true, name: true } },
        },
      }),
      this.prisma.callLog.count({ where }),
    ]);
    return { data, total, page, limit: safeLimit };
  }

  /**
   * Calculate late fees for all overdue payments (cron job)
   * Uses a single SQL UPDATE for efficiency instead of N+1 queries
   */
  async calculateLateFees() {
    const now = new Date();

    // Get late fee config
    const [lateFeeConfig, lateFeeCapConfig] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'late_fee_per_day' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'late_fee_cap' } }),
    ]);

    const lateFeePerDay = lateFeeConfig ? Number(lateFeeConfig.value) : BUSINESS_RULES.LATE_FEE_PER_DAY;
    const lateFeeCap = lateFeeCapConfig ? Number(lateFeeCapConfig.value) : BUSINESS_RULES.LATE_FEE_CAP;
    const lateFeeCapPct = BUSINESS_RULES.LATE_FEE_CAP_PCT;

    // Single bulk UPDATE: calculate late fees and set status in one query
    // Use EXTRACT(EPOCH) / 86400 to get total days (not just the day component of the interval)
    // Skip payments with late_fee_waived flag to preserve manually adjusted fees
    // Cap = min(fixed_cap, amount_due * pct_cap) per Thai law (max 5% of installment)
    const result = await this.prisma.$executeRaw`
      UPDATE "payments"
      SET
        "late_fee" = ROUND(LEAST(
          GREATEST(FLOOR(EXTRACT(EPOCH FROM (${now}::timestamp - "due_date")) / 86400)::int, 0) * ${lateFeePerDay},
          ${lateFeeCap},
          "amount_due" * ${lateFeeCapPct}
        )::numeric, 2),
        "status" = 'OVERDUE'
      WHERE "status" IN ('PENDING', 'PARTIALLY_PAID', 'OVERDUE')
        AND "due_date" < ${now}
        AND "late_fee_waived" = false
        AND "contract_id" IN (
          SELECT "id" FROM "contracts"
          WHERE "status" IN ('ACTIVE', 'OVERDUE', 'DEFAULT')
            AND "deleted_at" IS NULL
        )
    `;

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
    const overdueDays = overdueConfig ? Number(overdueConfig.value) : 7;

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
      OR: [
        { blockAutoEscalation: null },
        { blockAutoEscalation: { lt: now } },
      ],
      payments: {
        some: {
          status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
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
            newValue: { from: 'ACTIVE', to: 'OVERDUE', reason: `Payment overdue > ${overdueDays} days` },
            ipAddress: 'system-cron',
          })),
        }),
      );
    }
    const [flipResult] = await this.prisma.$transaction(txOps) as [
      Prisma.BatchPayload,
      ...unknown[],
    ];

    const overdueUpdated = flipResult.count;
    const activeIds = toFlip.map((c) => c.id);

    // Step 2: OVERDUE → DEFAULT (2+ consecutive missed payments)
    // Use raw SQL to find contracts with consecutive missed payments
    const defaultCandidates: { id: string; consecutive: number }[] = await this.prisma.$queryRaw`
      WITH payment_streaks AS (
        SELECT
          p."contract_id",
          p."installment_no",
          p."status",
          p."due_date",
          ROW_NUMBER() OVER (PARTITION BY p."contract_id" ORDER BY p."installment_no") -
          ROW_NUMBER() OVER (PARTITION BY p."contract_id",
            CASE WHEN p."status" IN ('PENDING', 'OVERDUE', 'PARTIALLY_PAID') AND p."due_date" < ${now}
                 THEN 1 ELSE 0 END
            ORDER BY p."installment_no") AS grp
        FROM "payments" p
        JOIN "contracts" c ON c."id" = p."contract_id"
        WHERE c."status" = 'OVERDUE' AND c."deleted_at" IS NULL
      ),
      max_consecutive AS (
        SELECT
          "contract_id" AS id,
          MAX(cnt) AS consecutive
        FROM (
          SELECT "contract_id", grp, COUNT(*) AS cnt
          FROM payment_streaks
          WHERE "status" IN ('PENDING', 'OVERDUE', 'PARTIALLY_PAID')
            AND "due_date" < ${now}
          GROUP BY "contract_id", grp
        ) sub
        GROUP BY "contract_id"
      )
      SELECT id, consecutive::int FROM max_consecutive WHERE consecutive >= 2
    `;

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
            newValue: { from: 'OVERDUE', to: 'DEFAULT', reason: `${c.consecutive} consecutive missed payments` },
            ipAddress: 'system-cron',
          })),
        }),
      ];
      await this.prisma.$transaction(txOps);
      defaultUpdated = defaultIds.length;
    }

    this.logger.log(`Contract status update: ${overdueUpdated} overdue, ${defaultUpdated} default`);
    return { overdueUpdated, defaultUpdated, overdueIds: activeIds, defaultIds, timestamp: now };
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
    let contracts: { id: string; contractNumber: string; dunningStage: DunningStage; payments: { dueDate: Date }[] }[] = [];
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
      if (batch.length < BATCH_SIZE) { hasMore = false; break; }
      skip += BATCH_SIZE;
    }

    const escalated: { contractId: string; contractNumber: string; from: DunningStage; to: DunningStage; daysOverdue: number }[] = [];

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
      const stageOrder: DunningStage[] = ['NONE', 'REMINDER', 'NOTICE', 'FINAL_WARNING', 'LEGAL_ACTION'];
      const currentIdx = stageOrder.indexOf(contract.dunningStage);
      const targetIdx = stageOrder.indexOf(targetStage);

      if (targetIdx > currentIdx) {
        // T4-C2: FINAL_WARNING and LEGAL_ACTION messages carry legal +
        // PDPA risk if fired auto on a disputed debt. Park them as pending
        // and wait for a human OWNER/FM to approve.
        const requiresApproval =
          targetStage === 'FINAL_WARNING' || targetStage === 'LEGAL_ACTION';

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
   * T4-C2: approve the auto-escalator's proposal to flip a contract into
   * FINAL_WARNING or LEGAL_ACTION. Restricted to OWNER/FINANCE_MANAGER since
   * the downstream message is legally sensitive. Returns the updated contract
   * so the caller can dispatch the actual notification.
   */
  async approveDunningEscalation(contractId: string, userId: string, userRole: string) {
    const allowed = ['OWNER', 'FINANCE_MANAGER'];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException(
        `สิทธิ์อนุมัติ dunning escalation เฉพาะ ${allowed.join(' / ')}`,
      );
    }

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: {
        id: true,
        contractNumber: true,
        dunningStage: true,
        pendingDunningStage: true,
      },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');
    if (!contract.pendingDunningStage) {
      throw new BadRequestException('สัญญานี้ไม่มี dunning escalation รออนุมัติ');
    }

    const now = new Date();
    const target = contract.pendingDunningStage;

    const [updated] = await this.prisma.$transaction([
      this.prisma.contract.update({
        where: { id: contractId },
        data: {
          dunningStage: target,
          dunningEscalatedAt: now,
          dunningLastActionAt: now,
          pendingDunningStage: null,
          pendingDunningSince: null,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'DUNNING_ESCALATION_APPROVED',
          entity: 'contract',
          entityId: contractId,
          oldValue: { dunningStage: contract.dunningStage, pendingDunningStage: target },
          newValue: { dunningStage: target },
        },
      }),
    ]);

    return updated;
  }

  async rejectDunningEscalation(
    contractId: string,
    userId: string,
    userRole: string,
    reason: string,
  ) {
    const allowed = ['OWNER', 'FINANCE_MANAGER'];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException(
        `สิทธิ์ปฏิเสธ dunning escalation เฉพาะ ${allowed.join(' / ')}`,
      );
    }
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('ต้องระบุเหตุผลการปฏิเสธ (≥ 5 ตัวอักษร)');
    }

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true, pendingDunningStage: true, dunningStage: true },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');
    if (!contract.pendingDunningStage) {
      throw new BadRequestException('สัญญานี้ไม่มี dunning escalation รออนุมัติ');
    }

    await this.prisma.$transaction([
      this.prisma.contract.update({
        where: { id: contractId },
        data: { pendingDunningStage: null, pendingDunningSince: null },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'DUNNING_ESCALATION_REJECTED',
          entity: 'contract',
          entityId: contractId,
          oldValue: { pendingDunningStage: contract.pendingDunningStage },
          newValue: { rejectedReason: reason.trim() },
        },
      }),
    ]);
    return { success: true };
  }

  async getPendingEscalations() {
    return this.prisma.contract.findMany({
      where: {
        pendingDunningStage: { not: null },
        deletedAt: null,
      },
      select: {
        id: true,
        contractNumber: true,
        dunningStage: true,
        pendingDunningStage: true,
        pendingDunningSince: true,
        customer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { pendingDunningSince: 'asc' },
      take: 200,
    });
  }

  /**
   * Get collection pipeline statistics grouped by dunning stage
   * Used for dashboard widget
   */
  async getCollectionPipelineStats(userRole?: string, userBranchId?: string) {
    const branchFilter: Prisma.ContractWhereInput =
      (userRole === 'SALES' || userRole === 'BRANCH_MANAGER') && userBranchId
        ? { branchId: userBranchId }
        : {};

    const grouped = await this.prisma.contract.groupBy({
      by: ['dunningStage'],
      where: {
        status: { in: ['OVERDUE', 'DEFAULT'] },
        deletedAt: null,
        ...branchFilter,
      },
      _count: { _all: true },
      _sum: { financedAmount: true },
    });

    const stages = ['NONE', 'REMINDER', 'NOTICE', 'FINAL_WARNING', 'LEGAL_ACTION'] as const;
    const stageLabels: Record<string, string> = {
      NONE: 'เพิ่งค้างชำระ',
      REMINDER: 'แจ้งเตือน (1-7 วัน)',
      NOTICE: 'แจ้งค้างชำระ (8-30 วัน)',
      FINAL_WARNING: 'เตือนครั้งสุดท้าย (31-60 วัน)',
      LEGAL_ACTION: 'ดำเนินคดี (>60 วัน)',
    };

    const result = stages.map((stage) => {
      const found = grouped.find((g) => g.dunningStage === stage);
      return {
        stage,
        label: stageLabels[stage],
        count: found?._count._all ?? 0,
        totalAmount: new Prisma.Decimal(found?._sum?.financedAmount ?? 0).toNumber(),
      };
    });

    const totalContracts = result.reduce((sum, s) => sum + s.count, 0);
    const totalAmount = result.reduce((sum, s) => sum + s.totalAmount, 0);

    return { stages: result, totalContracts, totalAmount };
  }

  /**
   * T3-C11: Place a manual hold on auto-escalation for a contract. Blocks
   * the overdue cron from flipping status/stages while a human is actively
   * working the customer. Default hold is 48h from now.
   *
   * Roles: OWNER / FINANCE_MANAGER / BRANCH_MANAGER — anyone below that has
   * no business overriding collections automation.
   */
  async holdAutoEscalation(
    contractId: string,
    userId: string,
    userRole: string,
    hoursFromNow = 48,
  ) {
    const allowed = ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException(
        `สิทธิ์กด hold escalation เฉพาะ ${allowed.join(' / ')}`,
      );
    }
    if (!Number.isFinite(hoursFromNow) || hoursFromNow <= 0 || hoursFromNow > 168) {
      throw new BadRequestException('ระยะเวลา hold ต้องอยู่ระหว่าง 1 ถึง 168 ชั่วโมง');
    }

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true, contractNumber: true, blockAutoEscalation: true },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const now = new Date();
    const until = new Date(now.getTime() + hoursFromNow * 60 * 60 * 1000);

    const [updated] = await this.prisma.$transaction([
      this.prisma.contract.update({
        where: { id: contractId },
        data: { blockAutoEscalation: until },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'HOLD_AUTO_ESCALATION',
          entity: 'contract',
          entityId: contractId,
          oldValue: { blockAutoEscalation: contract.blockAutoEscalation },
          newValue: { blockAutoEscalation: until, hoursFromNow },
        },
      }),
    ]);

    return { ...updated, holdUntil: until };
  }

  /**
   * Assign a collections agent to a contract
   */
  async assignCollector(contractId: string, assignedToId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    return this.prisma.contract.update({
      where: { id: contractId },
      data: { assignedToId, assignedAt: new Date() },
    });
  }

  /**
   * Record a settlement/promise-to-pay from a call.
   *
   * Rules:
   *  - settlementDate ต้อง > วันนี้ (จะ promise ย้อนหลังไม่ได้ — ป้องกันการกรอก
   *    วันเก่าเพื่อเบนความสนใจจาก aging bucket)
   *  - settlementDate ห่างจาก now เกิน 30 วัน → reject (นัดไกลเกินไป =
   *    staff พยายามยืดเวลาลูกหนี้)
   */
  async recordSettlement(
    contractId: string,
    callerId: string,
    dto: { settlementDate: string; settlementNotes: string; notes?: string },
  ) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const now = new Date();
    const promised = new Date(dto.settlementDate);
    const maxDays = 30;
    const maxDate = new Date(now.getTime() + maxDays * 24 * 60 * 60 * 1000);

    if (isNaN(promised.getTime())) {
      throw new BadRequestException('วันนัดชำระไม่ถูกต้อง');
    }
    if (promised.getTime() <= now.getTime()) {
      throw new BadRequestException('วันนัดชำระต้องเป็นวันในอนาคต');
    }
    if (promised.getTime() > maxDate.getTime()) {
      throw new BadRequestException(
        `วันนัดชำระห่างจากวันนี้เกิน ${maxDays} วัน — กรุณาติดต่อหัวหน้างาน`,
      );
    }

    return this.prisma.callLog.create({
      data: {
        contractId,
        callerId,
        calledAt: now,
        result: 'PROMISED',
        notes: dto.notes,
        settlementDate: promised,
        settlementNotes: dto.settlementNotes,
      },
    });
  }

  /**
   * Read the collections_v2_enabled feature flag from SystemConfig.
   * Returns false when the key is absent or set to anything other than 'true'.
   */
  async getCollectionsFlag(): Promise<boolean> {
    const cfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'collections_v2_enabled' },
    });
    return cfg?.value === 'true';
  }

  /**
   * Reset dunning stage when a contract is no longer overdue
   * (e.g., after a payment brings it back to ACTIVE)
   */
  async resetDunningStage(contractId: string) {
    return this.prisma.contract.update({
      where: { id: contractId },
      data: {
        dunningStage: 'NONE',
        dunningEscalatedAt: null,
        dunningLastActionAt: null,
      },
    });
  }

  /**
   * Log a contact attempt — creates a CallLog and updates lastContactDate
   * on the Contract. Optionally updates collectionNotes.
   *
   * Per-result side effects:
   *  - NO_ANSWER     → increment noAnswerCount, fire CALL_NO_ANSWER event trigger
   *  - ANSWERED      → reset noAnswerCount
   *  - PROMISED      → reset noAnswerCount, fire CALL_ANSWERED_PROMISE event trigger
   *  - REFUSED       → reset noAnswerCount, fire CALL_REFUSED event trigger
   *  - WRONG_NUMBER  → set needsSkipTracing=true
   *  - OTHER         → no side effects
   *
   * Event trigger fires AFTER the DB transaction commits — failure is non-fatal.
   */
  async logContact(
    contractId: string,
    callerId: string,
    dto: {
      result: string;
      notes?: string;
      collectionNotes?: string;
      settlementDate?: string;
      settlementNotes?: string;
      // P1 Task 12 quick-tag enums (optional, back-compat).
      callResult?:
        | 'ANSWERED'
        | 'NO_ANSWER'
        | 'BUSY'
        | 'DEVICE_OFF'
        | 'UNREACHABLE';
      negotiationResult?:
        | 'REQUESTED_EXTENSION'
        | 'WILL_PAY'
        | 'REFUSED'
        | 'REQUESTED_RETURN'
        | 'NEGOTIATING'
        | 'NOT_APPLICABLE';
      // P2 Task 4 — voice memo evidence (S3 URL). Stored on CallLog.
      voiceMemoUrl?: string;
      // P2 Task 10 — structured promise slots (replaces legacy single/dual settlement fields).
      slots?: Array<{ settlementDate: string; settlementAmount: number; notes?: string }>;
      targetInstallmentIds?: string[];
      settlementAmount?: number | string;
      secondSettlementDate?: string;
      secondSettlementAmount?: number | string;
    },
  ) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const now = new Date();

    // P2 Task 11 — route PROMISED results through PromiseService (creates
    // PromiseSlot records, handles broken-promise detection, cycle deadline
    // validation, FIFO installment targeting, and AuditLog).
    if (dto.result === 'PROMISED') {
      // Build slots from either new dto.slots OR legacy single/dual settlement fields.
      const slotsInput =
        dto.slots && dto.slots.length > 0
          ? dto.slots.map((s) => ({
              settlementDate: new Date(s.settlementDate),
              settlementAmount: s.settlementAmount,
              notes: s.notes,
            }))
          : [
              ...(dto.settlementDate
                ? [
                    {
                      settlementDate: new Date(dto.settlementDate),
                      settlementAmount: Number(dto.settlementAmount ?? 0),
                    },
                  ]
                : []),
              ...(dto.secondSettlementDate
                ? [
                    {
                      settlementDate: new Date(dto.secondSettlementDate),
                      settlementAmount: Number(dto.secondSettlementAmount ?? 0),
                    },
                  ]
                : []),
            ];

      if (slotsInput.length === 0) {
        throw new BadRequestException('ต้องระบุอย่างน้อย 1 ที่');
      }

      let totalPromiseAmount = 0;
      for (const s of slotsInput) {
        totalPromiseAmount += Number(s.settlementAmount);
      }

      const targetIds =
        dto.targetInstallmentIds && dto.targetInstallmentIds.length > 0
          ? dto.targetInstallmentIds
          : await this.computeFifoTargets(contractId, totalPromiseAmount);

      // Update contract contact tracking alongside the promise creation.
      await this.prisma.contract.update({
        where: { id: contractId },
        data: {
          lastContactDate: now,
          dunningLastActionAt: now,
          ...(dto.collectionNotes !== undefined && { collectionNotes: dto.collectionNotes }),
          noAnswerCount: 0,
        },
      });

      const newPromise = await this.promiseService.createPromise({
        contractId,
        userId: callerId,
        slots: slotsInput,
        targetInstallmentIds: targetIds,
        notes: dto.notes,
      });

      // Fire CALL_ANSWERED_PROMISE event trigger — non-fatal.
      try {
        await this.dunningEngine.executeEventTrigger(
          'CALL_ANSWERED_PROMISE',
          contractId,
          null,
          newPromise.id,
        );
      } catch (err) {
        this.logger.warn(
          `executeEventTrigger failed for CALL_ANSWERED_PROMISE on contract ${contractId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }

      this.kpiService.invalidate();
      return newPromise;
    }

    // Per-result side effects + event-trigger key
    const resultMap: Record<
      string,
      {
        noAnswerDelta: 'inc' | 'reset' | 'keep';
        needsSkipTracing?: boolean;
        eventKey?: import('@prisma/client').DunningEventTrigger;
      }
    > = {
      NO_ANSWER:    { noAnswerDelta: 'inc',   eventKey: 'CALL_NO_ANSWER' },
      ANSWERED:     { noAnswerDelta: 'reset' },
      PROMISED:     { noAnswerDelta: 'reset', eventKey: 'CALL_ANSWERED_PROMISE' },
      REFUSED:      { noAnswerDelta: 'reset', eventKey: 'CALL_REFUSED' },
      WRONG_NUMBER: { noAnswerDelta: 'keep',  needsSkipTracing: true },
      OTHER:        { noAnswerDelta: 'keep' },
    };
    const plan = resultMap[dto.result] ?? { noAnswerDelta: 'keep' };

    const [callLog] = await this.prisma.$transaction([
      this.prisma.callLog.create({
        data: {
          contractId,
          callerId,
          calledAt: now,
          result: dto.result,
          notes: dto.notes ?? null,
          settlementDate: dto.settlementDate ? new Date(dto.settlementDate) : null,
          settlementNotes: dto.settlementNotes ?? null,
          // P1 Task 12 — quick-tag enums. Stored alongside the legacy `result`
          // free-string for back-compat. Analytics dashboards prefer these
          // structured columns going forward.
          callResult: dto.callResult ?? null,
          negotiationResult: dto.negotiationResult ?? null,
          // P2 Task 4 — voice memo (HOT tier by schema default until S3
          // lifecycle moves the object to GLACIER and a backfill cron flips
          // voiceMemoTier).
          voiceMemoUrl: dto.voiceMemoUrl ?? null,
        },
        include: { caller: { select: { id: true, name: true } } },
      }),
      this.prisma.contract.update({
        where: { id: contractId },
        data: {
          lastContactDate: now,
          dunningLastActionAt: now,
          ...(dto.collectionNotes !== undefined && { collectionNotes: dto.collectionNotes }),
          ...(plan.needsSkipTracing !== undefined && { needsSkipTracing: plan.needsSkipTracing }),
          ...(plan.noAnswerDelta === 'inc' && { noAnswerCount: { increment: 1 } }),
          ...(plan.noAnswerDelta === 'reset' && { noAnswerCount: 0 }),
        },
      }),
    ]);

    // Fire event trigger AFTER commit — failures non-fatal
    if (plan.eventKey) {
      try {
        await this.dunningEngine.executeEventTrigger(plan.eventKey, contractId, null, callLog.id);
      } catch (err) {
        this.logger.warn(
          `executeEventTrigger failed for ${plan.eventKey} on contract ${contractId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    // H2: drop stale KPI snapshots — logContact mutates counters that feed
    // queueToday, noAnswerCount-based filters, and promise-kept calcs.
    this.kpiService.invalidate();

    return callLog;
  }

  /**
   * Returns the IDs of unpaid installments that FIFO-allocate up to targetAmount.
   * Used when the caller does not explicitly specify targetInstallmentIds.
   */
  private async computeFifoTargets(contractId: string, targetAmount: number): Promise<string[]> {
    // C1 fix: use status filter (consistent with getBoardData / logContact unpaid-check)
    // rather than paidAt: null, which misses manual payments (which set paidDate not paidAt).
    const payments = await this.prisma.payment.findMany({
      where: {
        contractId,
        deletedAt: null,
        status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
      },
      select: {
        id: true,
        dueDate: true,
        amountDue: true,
        amountPaid: true,
      },
      orderBy: { dueDate: 'asc' },
    });

    const { Decimal } = await import('@prisma/client/runtime/library');
    const { allocateFifo } = await import('./installment-allocator.util');

    return allocateFifo(
      payments.map((p) => ({
        id: p.id,
        dueDate: p.dueDate,
        remainingAmount: (p.amountDue as any).sub(p.amountPaid as any),
      })),
      new Decimal(targetAmount),
    );
  }

  /**
   * Kanban board data — groups overdue/default contracts by dunning stage.
   * Each lane contains a list of contract cards with key info.
   */
  async getBoardData(userRole?: string, userBranchId?: string) {
    const branchFilter: Prisma.ContractWhereInput =
      (userRole === 'SALES' || userRole === 'BRANCH_MANAGER') && userBranchId
        ? { branchId: userBranchId }
        : {};

    const contracts = await this.prisma.contract.findMany({
      where: {
        status: { in: ['OVERDUE', 'DEFAULT'] },
        deletedAt: null,
        ...branchFilter,
      },
      select: {
        id: true,
        contractNumber: true,
        status: true,
        dunningStage: true,
        dunningEscalatedAt: true,
        lastContactDate: true,
        collectionNotes: true,
        financedAmount: true,
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        payments: {
          where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] }, dueDate: { lt: new Date() } },
          select: { amountDue: true, amountPaid: true, lateFee: true, dueDate: true },
          orderBy: { dueDate: 'asc' },
          take: 1,
        },
      },
      orderBy: { dunningEscalatedAt: 'asc' },
    });

    const stages = ['NONE', 'REMINDER', 'NOTICE', 'FINAL_WARNING', 'LEGAL_ACTION'] as const;
    const stageLabels: Record<string, string> = {
      NONE: 'เพิ่งค้างชำระ',
      REMINDER: 'แจ้งเตือน (1-7 วัน)',
      NOTICE: 'แจ้งค้างชำระ (8-30 วัน)',
      FINAL_WARNING: 'เตือนครั้งสุดท้าย (31-60 วัน)',
      LEGAL_ACTION: 'ดำเนินคดี (>60 วัน)',
    };

    const lanes = stages.map((stage) => ({
      stage,
      label: stageLabels[stage],
      contracts: contracts
        .filter((c) => c.dunningStage === stage)
        .map((c) => {
          const overduePayment = c.payments[0];
          const outstanding = overduePayment
            ? new Prisma.Decimal(overduePayment.amountDue)
                .sub(overduePayment.amountPaid)
                .add(overduePayment.lateFee)
                .toNumber()
            : 0;
          return {
            id: c.id,
            contractNumber: c.contractNumber,
            status: c.status,
            customer: c.customer,
            branch: c.branch,
            assignedTo: c.assignedTo,
            lastContactDate: c.lastContactDate,
            collectionNotes: c.collectionNotes,
            dunningEscalatedAt: c.dunningEscalatedAt,
            outstanding,
            oldestDueDate: overduePayment?.dueDate ?? null,
          };
        }),
    }));

    return {
      lanes,
      totalContracts: contracts.length,
    };
  }

  /**
   * P1 Task 14 — Read today's "promise-due-reminder" suggestions written by
   * BrokenPromiseReminderCron. Used by `BrokenPromiseBanner.tsx` in PromiseTab
   * to surface "วันนี้มีนัดครบกำหนด N ราย" + bulk-LINE prompt.
   *
   * Window is the same Bangkok-local "today" the cron uses, so a reminder
   * created at 09:00 BKK is visible here until 00:00 BKK tomorrow regardless
   * of where the API host clock is.
   */
  async listPromiseDueRemindersToday(branchId: string | null) {
    const RULE_ID = 'dunning-event-PROMISE_DUE_REMINDER';
    const now = new Date();
    const bkkNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const startOfDayBkk = new Date(
      Date.UTC(bkkNow.getUTCFullYear(), bkkNow.getUTCMonth(), bkkNow.getUTCDate(), 0, 0, 0, 0),
    );
    const startOfDayUtc = new Date(startOfDayBkk.getTime() - 7 * 60 * 60 * 1000);
    const endOfDayUtc = new Date(startOfDayUtc.getTime() + 24 * 60 * 60 * 1000);

    const rows = await this.prisma.dunningAction.findMany({
      where: {
        deletedAt: null,
        dunningRuleId: RULE_ID,
        createdAt: { gte: startOfDayUtc, lt: endOfDayUtc },
        contract: {
          deletedAt: null,
          ...(branchId ? { branchId } : {}),
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        contractId: true,
        createdAt: true,
        contract: {
          select: {
            id: true,
            contractNumber: true,
            branchId: true,
            customer: { select: { id: true, name: true, lineId: true, phone: true } },
          },
        },
      },
    });

    return {
      total: rows.length,
      withLine: rows.filter((r) => !!r.contract.customer.lineId).length,
      contractIds: rows.map((r) => r.contractId),
      data: rows.map((r) => ({
        id: r.id,
        contractId: r.contractId,
        contractNumber: r.contract.contractNumber,
        customerName: r.contract.customer.name,
        hasLine: !!r.contract.customer.lineId,
        createdAt: r.createdAt,
      })),
    };
  }

  // --- P2P Lifecycle methods (Task 23) ---

  async getCycleDeadline(contractId: string) {
    const active = await this.promiseService.findActivePromise(contractId);
    const deadline = (active as any)?.cycleDeadline
      ? (active as any).cycleDeadline
      : await this.promiseService.calcCycleDeadline(contractId);

    const activeSlots: Array<{ settlementDate: Date }> = (active as any)?.slots ?? [];
    const slotsPastDue = activeSlots.some((s) => s.settlementDate < new Date());

    return {
      cycleDeadline: deadline.toISOString(),
      activePromise: active
        ? {
            id: (active as any).id,
            settlementDate: (active as any).settlementDate?.toISOString() ?? null,
            settlementAmount: Number((active as any).settlementAmount ?? 0),
            rescheduleCount: (active as any).rescheduleCount ?? 0,
            slotsPastDue,
          }
        : null,
    };
  }

  async getOverdueInstallments(contractId: string) {
    // C1 fix: use status filter rather than paidAt: null — manual payments set paidDate not paidAt.
    const payments = await this.prisma.payment.findMany({
      where: {
        contractId,
        deletedAt: null,
        status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
      },
      orderBy: { dueDate: 'asc' },
      select: {
        id: true,
        installmentNo: true,
        dueDate: true,
        amountDue: true,
        amountPaid: true,
      },
    });
    const now = Date.now();
    return payments.map((p) => ({
      id: p.id,
      installmentNumber: p.installmentNo,
      dueDate: p.dueDate.toISOString(),
      remainingAmount: Number(new Prisma.Decimal(p.amountDue as Prisma.Decimal).sub(p.amountPaid as Prisma.Decimal)),
      daysOverdue: Math.max(0, Math.floor((now - p.dueDate.getTime()) / 86_400_000)),
    }));
  }
}
