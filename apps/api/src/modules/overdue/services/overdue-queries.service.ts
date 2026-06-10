import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PromiseService } from '../promise.service';

/**
 * Pure read-side queries for the overdue/collections module.
 *
 * Extracted from OverdueService as part of the behaviour-preserving decompose.
 * Every method here is a read (findMany/aggregate/groupBy/count) — no writes,
 * no $transaction. Bodies are verbatim from the original OverdueService (only
 * `this.prisma` / `this.promiseService` resolution + import paths changed).
 */
export class OverdueQueriesService {
  constructor(
    private prisma: PrismaService,
    private promiseService: PromiseService,
  ) {}

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
          customer: { select: { id: true, name: true, phone: true, lineIdFinance: true } },
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
            customer: { select: { id: true, name: true, lineIdFinance: true, phone: true } },
          },
        },
      },
    });

    return {
      total: rows.length,
      withLine: rows.filter((r) => !!r.contract.customer.lineIdFinance).length,
      contractIds: rows.map((r) => r.contractId),
      data: rows.map((r) => ({
        id: r.id,
        contractId: r.contractId,
        contractNumber: r.contract.contractNumber,
        customerName: r.contract.customer.name,
        hasLine: !!r.contract.customer.lineIdFinance,
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
