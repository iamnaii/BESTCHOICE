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
      userRole === 'SALES' || userRole === 'BRANCH_MANAGER'
        ? { branchId: userBranchId || '' }
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

    // Find all overdue payments
    const overduePayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
        dueDate: { lt: now },
        contract: { status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] }, deletedAt: null },
      },
      include: { contract: true },
    });

    let updated = 0;
    for (const payment of overduePayments) {
      const daysOverdue = Math.floor(
        (now.getTime() - new Date(payment.dueDate).getTime()) / (1000 * 60 * 60 * 24),
      );
      const lateFee = Math.min(daysOverdue * lateFeePerDay, lateFeeCap);

      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          lateFee,
          status: 'OVERDUE',
        },
      });
      updated++;
    }

    this.logger.log(`Late fees calculated: ${updated} payments updated`);
    return { updated, timestamp: now };
  }

  /**
   * Update contract statuses based on overdue rules (cron job)
   */
  async updateContractStatuses() {
    const now = new Date();
    let overdueUpdated = 0;
    let defaultUpdated = 0;

    // Get system user for audit logs (first OWNER)
    const systemUser = await this.prisma.user.findFirst({
      where: { role: 'OWNER', isActive: true },
      select: { id: true },
    });
    const systemUserId = systemUser?.id || 'system';

    // Find contracts with overdue payments > 7 days → OVERDUE
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
    });

    for (const contract of activeContracts) {
      await this.prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'OVERDUE' },
      });

      // Audit log for status change
      await this.prisma.auditLog.create({
        data: {
          userId: systemUserId,
          action: 'STATUS_CHANGE',
          entity: 'contract',
          entityId: contract.id,
          newValue: { from: 'ACTIVE', to: 'OVERDUE', reason: 'Payment overdue > 7 days' },
          ipAddress: 'system-cron',
        },
      });

      overdueUpdated++;
    }

    // Find contracts with 2+ consecutive missed payments → DEFAULT
    const overdueContracts = await this.prisma.contract.findMany({
      where: {
        status: 'OVERDUE',
        deletedAt: null,
      },
      include: {
        payments: { orderBy: { installmentNo: 'asc' } },
      },
    });

    for (const contract of overdueContracts) {
      let consecutiveMissed = 0;
      let maxConsecutive = 0;

      for (const payment of contract.payments) {
        if (
          ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(payment.status) &&
          new Date(payment.dueDate) < now
        ) {
          consecutiveMissed++;
          maxConsecutive = Math.max(maxConsecutive, consecutiveMissed);
        } else if (payment.status === 'PAID') {
          consecutiveMissed = 0;
        }
      }

      if (maxConsecutive >= 2) {
        await this.prisma.contract.update({
          where: { id: contract.id },
          data: { status: 'DEFAULT' },
        });

        // Audit log for status change
        await this.prisma.auditLog.create({
          data: {
            userId: systemUserId,
            action: 'STATUS_CHANGE',
            entity: 'contract',
            entityId: contract.id,
            newValue: { from: 'OVERDUE', to: 'DEFAULT', reason: `${maxConsecutive} consecutive missed payments` },
            ipAddress: 'system-cron',
          },
        });

        defaultUpdated++;
      }
    }

    this.logger.log(`Contract status update: ${overdueUpdated} overdue, ${defaultUpdated} default`);
    return { overdueUpdated, defaultUpdated, timestamp: now };
  }
}
