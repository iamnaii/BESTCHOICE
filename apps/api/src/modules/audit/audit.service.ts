import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  duration?: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async log(entry: AuditEntry) {
    try {
      if (!entry.userId) return;

      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId || '',
          oldValue: (entry.oldValue as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          newValue: (entry.newValue as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          ipAddress: entry.ipAddress || null,
          userAgent: entry.userAgent || null,
          duration: entry.duration || null,
        },
      });
    } catch (err) {
      this.logger.error('Failed to write audit log', err);
    }
  }

  async getAuditLogs(filters: {
    userId?: string;
    entity?: string;
    action?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    search?: string;
    entityId?: string;
  }) {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100);

    const where: Prisma.AuditLogWhereInput = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.entity) where.entity = { contains: filters.entity, mode: 'insensitive' };
    if (filters.action) where.action = { contains: filters.action, mode: 'insensitive' };
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ─── Financial Audit Trail Methods ────────────────────────────

  /**
   * Log a payment event with full financial context.
   * Immutable record for accountant review.
   */
  async logPaymentEvent(params: {
    userId: string;
    contractId: string;
    paymentId: string;
    action: 'PAYMENT_RECORDED' | 'PAYMENT_PARTIAL' | 'LATE_FEE_WAIVED' | 'CREDIT_APPLIED';
    amount: number;
    installmentNo?: number;
    details?: Record<string, unknown>;
  }) {
    return this.log({
      userId: params.userId,
      action: params.action,
      entity: 'payment',
      entityId: params.paymentId,
      newValue: {
        contractId: params.contractId,
        amount: params.amount,
        installmentNo: params.installmentNo,
        timestamp: new Date().toISOString(),
        ...params.details,
      },
    });
  }

  /**
   * Log receipt lifecycle events (generation, void, credit note).
   */
  async logReceiptEvent(params: {
    userId: string;
    receiptId: string;
    action: 'RECEIPT_GENERATED' | 'RECEIPT_VOIDED' | 'CREDIT_NOTE_ISSUED';
    receiptNumber: string;
    amount: number;
    details?: Record<string, unknown>;
  }) {
    return this.log({
      userId: params.userId,
      action: params.action,
      entity: 'receipt',
      entityId: params.receiptId,
      newValue: {
        receiptNumber: params.receiptNumber,
        amount: params.amount,
        timestamp: new Date().toISOString(),
        ...params.details,
      },
    });
  }

  /**
   * Log contract financial state changes (status, credit balance, dunning).
   */
  async logContractFinancialEvent(params: {
    userId: string;
    contractId: string;
    action: 'OVERPAYMENT_CREDITED' | 'CREDIT_BALANCE_APPLIED' | 'CONTRACT_COMPLETED' | 'DUNNING_ESCALATION';
    oldValue?: Record<string, unknown>;
    newValue: Record<string, unknown>;
  }) {
    return this.log({
      userId: params.userId,
      action: params.action,
      entity: 'contract',
      entityId: params.contractId,
      oldValue: params.oldValue,
      newValue: { ...params.newValue, timestamp: new Date().toISOString() },
    });
  }

  /**
   * Get financial audit trail for a specific contract.
   * Used by accountants to review all financial events.
   */
  async getFinancialAuditTrail(contractId: string, options?: { page?: number; limit?: number }) {
    const page = options?.page || 1;
    const limit = Math.min(options?.limit || 50, 100);

    const financialActions = [
      'PAYMENT_RECORDED', 'PAYMENT_PARTIAL', 'LATE_FEE_WAIVED', 'CREDIT_APPLIED',
      'RECEIPT_GENERATED', 'RECEIPT_VOIDED', 'CREDIT_NOTE_ISSUED',
      'OVERPAYMENT_CREDITED', 'CREDIT_BALANCE_APPLIED', 'CONTRACT_COMPLETED',
      'DUNNING_ESCALATION', 'STATUS_CHANGE',
    ];

    const where: Prisma.AuditLogWhereInput = {
      OR: [
        { entityId: contractId, entity: 'contract' },
        // Also find payment/receipt events linked to this contract via newValue JSON
        { entity: { in: ['payment', 'receipt'] }, newValue: { path: ['contractId'], equals: contractId } },
      ],
      action: { in: financialActions },
    };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getAuditStats() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() - 7);

    const [todayCount, weekCount, totalCount, recentErrors] = await Promise.all([
      this.prisma.auditLog.count({ where: { createdAt: { gte: today } } }),
      this.prisma.auditLog.count({ where: { createdAt: { gte: thisWeek } } }),
      this.prisma.auditLog.count(),
      this.prisma.auditLog.count({
        where: {
          action: { endsWith: '_ERROR' },
          createdAt: { gte: thisWeek },
        },
      }),
    ]);

    return { todayCount, weekCount, totalCount, recentErrors };
  }
}
