import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCallLogDto } from './dto/create-call-log.dto';
import { Prisma, DunningStage } from '@prisma/client';
import { BUSINESS_RULES } from '../../utils/config.util';

@Injectable()
export class OverdueService {
  private readonly logger = new Logger(OverdueService.name);

  constructor(private prisma: PrismaService) {}

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

    // Get system user for audit logs (first OWNER)
    const systemUser = await this.prisma.user.findFirst({
      where: { role: 'OWNER', isActive: true },
      select: { id: true },
    });

    // Read overdue threshold from config
    const overdueConfig = await this.prisma.systemConfig.findUnique({
      where: { key: 'overdue_days_threshold' },
    });
    const overdueDays = overdueConfig ? Number(overdueConfig.value) : 7;

    // Step 1: ACTIVE → OVERDUE (payments overdue > threshold days)
    const activeContracts = await this.prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        payments: {
          some: {
            status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
            dueDate: { lt: new Date(now.getTime() - overdueDays * 24 * 60 * 60 * 1000) },
          },
        },
      },
      select: { id: true },
    });

    const activeIds = activeContracts.map((c) => c.id);
    let overdueUpdated = 0;

    if (activeIds.length > 0) {
      // Batch update + audit logs in a single transaction
      const txOps: Prisma.PrismaPromise<unknown>[] = [
        this.prisma.contract.updateMany({
          where: { id: { in: activeIds } },
          data: { status: 'OVERDUE' },
        }),
      ];
      // Only create audit logs if system user exists (avoid FK violation)
      if (systemUser) {
        txOps.push(
          this.prisma.auditLog.createMany({
            data: activeIds.map((id) => ({
              userId: systemUser.id,
              action: 'STATUS_CHANGE',
              entity: 'contract',
              entityId: id,
              newValue: { from: 'ACTIVE', to: 'OVERDUE', reason: `Payment overdue > ${overdueDays} days` },
              ipAddress: 'system-cron',
            })),
          }),
        );
      }
      await this.prisma.$transaction(txOps);
      overdueUpdated = activeIds.length;
    }

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
      ];
      if (systemUser) {
        txOps.push(
          this.prisma.auditLog.createMany({
            data: defaultCandidates.map((c) => ({
              userId: systemUser.id,
              action: 'STATUS_CHANGE',
              entity: 'contract',
              entityId: c.id,
              newValue: { from: 'OVERDUE', to: 'DEFAULT', reason: `${c.consecutive} consecutive missed payments` },
              ipAddress: 'system-cron',
            })),
          }),
        );
      }
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

    // Get system user for audit
    const systemUser = await this.prisma.user.findFirst({
      where: { role: 'OWNER', isActive: true },
      select: { id: true },
    });

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
        await this.prisma.contract.update({
          where: { id: contract.id },
          data: {
            dunningStage: targetStage,
            dunningEscalatedAt: now,
            dunningLastActionAt: now,
          },
        });

        // Audit log
        if (systemUser) {
          await this.prisma.auditLog.create({
            data: {
              userId: systemUser.id,
              action: 'DUNNING_ESCALATION',
              entity: 'contract',
              entityId: contract.id,
              oldValue: { dunningStage: contract.dunningStage },
              newValue: { dunningStage: targetStage, daysOverdue },
              ipAddress: 'system-cron',
            },
          });
        }

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
   * Assign a collections agent to a contract
   */
  async assignCollector(contractId: string, assignedToId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    return this.prisma.contract.update({
      where: { id: contractId },
      data: { assignedToId },
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
   */
  async logContact(
    contractId: string,
    callerId: string,
    dto: { result: string; notes?: string; collectionNotes?: string },
  ) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const now = new Date();

    // Create call log entry and update lastContactDate in a transaction
    const [callLog] = await this.prisma.$transaction([
      this.prisma.callLog.create({
        data: {
          contractId,
          callerId,
          calledAt: now,
          result: dto.result,
          notes: dto.notes || null,
        },
        include: {
          caller: { select: { id: true, name: true } },
        },
      }),
      this.prisma.contract.update({
        where: { id: contractId },
        data: {
          lastContactDate: now,
          dunningLastActionAt: now,
          ...(dto.collectionNotes !== undefined && { collectionNotes: dto.collectionNotes }),
        },
      }),
    ]);

    return callLog;
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
}
