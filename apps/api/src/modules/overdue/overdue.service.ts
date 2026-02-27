import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCallLogDto } from './dto/create-call-log.dto';
import { Prisma } from '@prisma/client';

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
    const limit = filters.limit || 50;
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

    const amountDue = Number(totalOverdueAmount._sum.amountDue || 0);
    const amountPaid = Number(totalOverdueAmount._sum.amountPaid || 0);
    const lateFees = Number(totalOverdueAmount._sum.lateFee || 0);

    return {
      overdueCount,
      defaultCount,
      totalOverdueAmount: amountDue - amountPaid,
      totalLateFees: lateFees,
    };
  }

  /**
   * Get contract detail with full call log timeline
   */
  async getContractTimeline(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: true,
        product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true } },
        branch: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        payments: { orderBy: { installmentNo: 'asc' } },
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
    const contract = await this.prisma.contract.findUnique({
      where: { id: dto.contractId },
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
  async getCallLogs(contractId: string) {
    return this.prisma.callLog.findMany({
      where: { contractId },
      orderBy: { calledAt: 'desc' },
      include: {
        caller: { select: { id: true, name: true } },
      },
    });
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

    const lateFeePerDay = lateFeeConfig ? Number(lateFeeConfig.value) : 100;
    const lateFeeCap = lateFeeCapConfig ? Number(lateFeeCapConfig.value) : 200;

    // Single bulk UPDATE: calculate late fees and set status in one query
    const result = await this.prisma.$executeRaw`
      UPDATE "payments"
      SET
        "late_fee" = LEAST(
          EXTRACT(DAY FROM (${now}::timestamp - "due_date"))::int * ${lateFeePerDay},
          ${lateFeeCap}
        ),
        "status" = 'OVERDUE'
      WHERE "status" IN ('PENDING', 'PARTIALLY_PAID', 'OVERDUE')
        AND "due_date" < ${now}
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
    const systemUserId = systemUser?.id || 'system';

    // Step 1: ACTIVE → OVERDUE (payments overdue > 7 days)
    // Get only the IDs we need to update
    const activeContracts = await this.prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        payments: {
          some: {
            status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
            dueDate: { lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
          },
        },
      },
      select: { id: true },
    });

    const activeIds = activeContracts.map((c) => c.id);
    let overdueUpdated = 0;

    if (activeIds.length > 0) {
      // Batch update + audit logs in a single transaction
      await this.prisma.$transaction([
        this.prisma.contract.updateMany({
          where: { id: { in: activeIds } },
          data: { status: 'OVERDUE' },
        }),
        this.prisma.auditLog.createMany({
          data: activeIds.map((id) => ({
            userId: systemUserId,
            action: 'STATUS_CHANGE',
            entity: 'contract',
            entityId: id,
            newValue: { from: 'ACTIVE', to: 'OVERDUE', reason: 'Payment overdue > 7 days' },
            ipAddress: 'system-cron',
          })),
        }),
      ]);
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
      await this.prisma.$transaction([
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
      ]);
      defaultUpdated = defaultIds.length;
    }

    this.logger.log(`Contract status update: ${overdueUpdated} overdue, ${defaultUpdated} default`);
    return { overdueUpdated, defaultUpdated, timestamp: now };
  }
}
