import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
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

  /**
   * Canonical hash input string used to seal a row into the chain.
   * Order matters — never reorder, never drop fields, or backfill breaks.
   */
  private buildHashPayload(args: {
    sequenceNumber: bigint;
    id: string;
    userId: string;
    action: string;
    entity: string;
    entityId: string;
    oldValue: unknown;
    newValue: unknown;
    createdAt: Date;
    prevRowHash: string | null;
  }): string {
    return [
      args.sequenceNumber.toString(),
      args.id,
      args.userId,
      args.action,
      args.entity,
      args.entityId,
      JSON.stringify(args.oldValue ?? null),
      JSON.stringify(args.newValue ?? null),
      args.createdAt.toISOString(),
      args.prevRowHash ?? '',
    ].join('|');
  }

  computeRowHash(args: Parameters<AuditService['buildHashPayload']>[0]): string {
    return createHash('sha256').update(this.buildHashPayload(args)).digest('hex');
  }

  async log(entry: AuditEntry) {
    try {
      if (!entry.userId) return;

      // T2-C4 ext: hash chain. $transaction keeps nextval() + read-last-hash
      // + insert atomic so two concurrent writers can't race to the same
      // prevRowHash value.
      await this.prisma.$transaction(async (tx) => {
        const seqRow = await tx.$queryRaw<Array<{ nextval: bigint }>>`
          SELECT nextval('audit_logs_seq') AS nextval
        `;
        const sequenceNumber = seqRow[0].nextval;

        const prevRow = sequenceNumber > BigInt(1)
          ? await tx.auditLog.findFirst({
              where: { sequenceNumber: sequenceNumber - BigInt(1) },
              select: { rowHash: true },
            })
          : null;

        const id = randomUUID();
        const createdAt = new Date();
        const oldValue = (entry.oldValue as Prisma.InputJsonValue) ?? Prisma.JsonNull;
        const newValue = (entry.newValue as Prisma.InputJsonValue) ?? Prisma.JsonNull;

        const rowHash = this.computeRowHash({
          sequenceNumber,
          id,
          userId: entry.userId!,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId || '',
          oldValue: entry.oldValue ?? null,
          newValue: entry.newValue ?? null,
          createdAt,
          prevRowHash: prevRow?.rowHash ?? null,
        });

        await tx.auditLog.create({
          data: {
            id,
            userId: entry.userId!,
            action: entry.action,
            entity: entry.entity,
            entityId: entry.entityId || '',
            oldValue,
            newValue,
            ipAddress: entry.ipAddress || null,
            userAgent: entry.userAgent || null,
            duration: entry.duration || null,
            createdAt,
            sequenceNumber,
            rowHash,
            prevRowHash: prevRow?.rowHash ?? null,
          },
        });
      });
    } catch (err) {
      this.logger.error('Failed to write audit log', err);
    }
  }

  /**
   * Walk the Merkle chain and return the first sequenceNumber where the
   * recomputed hash doesn't match the stored hash (or prev linkage breaks).
   * Null = chain intact through all rows with non-null hashes.
   *
   * Historical rows where rowHash IS NULL (backfill before this migration)
   * are skipped — the chain is defined only for post-migration rows.
   */
  async verifyChain(options: { maxRows?: number } = {}): Promise<{
    ok: boolean;
    rowsChecked: number;
    firstMismatchSeq: bigint | null;
    firstMismatchId: string | null;
  }> {
    const take = options.maxRows ?? 10_000;
    const rows = await this.prisma.auditLog.findMany({
      where: { rowHash: { not: null }, sequenceNumber: { not: null } },
      orderBy: { sequenceNumber: 'asc' },
      select: {
        id: true,
        userId: true,
        action: true,
        entity: true,
        entityId: true,
        oldValue: true,
        newValue: true,
        createdAt: true,
        sequenceNumber: true,
        rowHash: true,
        prevRowHash: true,
      },
      take,
    });

    let lastHash: string | null = null;
    for (const r of rows) {
      if (r.sequenceNumber === null || r.rowHash === null) continue;
      // prev linkage check
      if ((r.prevRowHash ?? null) !== lastHash && lastHash !== null) {
        return {
          ok: false,
          rowsChecked: rows.indexOf(r),
          firstMismatchSeq: r.sequenceNumber,
          firstMismatchId: r.id,
        };
      }
      const expected = this.computeRowHash({
        sequenceNumber: r.sequenceNumber,
        id: r.id,
        userId: r.userId,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        oldValue: r.oldValue as unknown,
        newValue: r.newValue as unknown,
        createdAt: r.createdAt,
        prevRowHash: r.prevRowHash ?? null,
      });
      if (expected !== r.rowHash) {
        return {
          ok: false,
          rowsChecked: rows.indexOf(r),
          firstMismatchSeq: r.sequenceNumber,
          firstMismatchId: r.id,
        };
      }
      lastHash = r.rowHash;
    }

    return { ok: true, rowsChecked: rows.length, firstMismatchSeq: null, firstMismatchId: null };
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
