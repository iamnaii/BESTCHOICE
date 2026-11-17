import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeAuditValue } from './audit-sanitize.util';

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
   * รูปแบบ hash รุ่น 2 — ขึ้นต้น `v2:` ใน rowHash.
   *
   * รุ่น 1 hash จาก `JSON.stringify(object ตอนเขียน)` แต่ Postgres jsonb เก็บ key เรียงใหม่
   * (สั้นก่อน แล้วเรียงไบต์) ⇒ อ่านกลับมาแล้ว stringify ได้คนละสตริง ⇒ แถวที่มี JSON object
   * ตรวจไม่ผ่านทั้งหมด (prod 2026-08-23: 1,752/2,865 แถว "broken" โดยไม่มีใครแก้อะไร
   * และ cron ร้อง fatal ทุกคืนตั้งแต่ seq=1). รุ่น 2 จึง canonicalize ทั้งสองฝั่งด้วย
   * `canonicalJson` (round-trip ผ่าน JSON ก่อนให้ Decimal/Date/undefined กลายเป็นรูปเดียวกับที่
   * jsonb คืน แล้วเรียง key แบบคงที่) — แถวรุ่น 1 ที่มีอยู่ตรวจย้อนหลังไม่ได้โดยโครงสร้าง
   * (รูปตอนเขียนหายไปแล้ว) verifier จึงนับแยกเป็น "legacy ตรวจไม่ได้" ไม่ใช่ "ถูกแก้"
   */
  static readonly HASH_VERSION_PREFIX = 'v2:';

  /** JSON ที่เสถียรข้ามการเก็บใน jsonb: round-trip ก่อน แล้วเรียง key ทุกชั้น */
  static canonicalJson(value: unknown): string {
    const roundTripped: unknown = value === undefined ? null : JSON.parse(JSON.stringify(value));
    const sortKeys = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(sortKeys);
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(v as Record<string, unknown>).sort()) {
          out[k] = sortKeys((v as Record<string, unknown>)[k]);
        }
        return out;
      }
      return v;
    };
    return JSON.stringify(sortKeys(roundTripped));
  }

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
      AuditService.canonicalJson(args.oldValue ?? null),
      AuditService.canonicalJson(args.newValue ?? null),
      args.createdAt.toISOString(),
      args.prevRowHash ?? '',
    ].join('|');
  }

  computeRowHash(args: Parameters<AuditService['buildHashPayload']>[0]): string {
    return (
      AuditService.HASH_VERSION_PREFIX +
      createHash('sha256').update(this.buildHashPayload(args)).digest('hex')
    );
  }

  async log(entry: AuditEntry, outerTx?: Prisma.TransactionClient) {
    try {
      if (!entry.userId) return;

      // Explicit service callers bypass the HTTP interceptor. Normalize Date/Decimal
      // to their JSON representation, then seal exactly the sanitized values we store.
      const oldValue = sanitizeAuditValue(
        JSON.parse(JSON.stringify(entry.oldValue ?? null)),
      ) as Prisma.InputJsonValue | null;
      const newValue = sanitizeAuditValue(
        JSON.parse(JSON.stringify(entry.newValue ?? null)),
      ) as Prisma.InputJsonValue | null;

      // T2-C4 ext: hash chain. $transaction keeps nextval() + read-last-hash
      // + insert atomic so two concurrent writers can't race to the same
      // prevRowHash value.
      const write = async (tx: Prisma.TransactionClient) => {
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
        const rowHash = this.computeRowHash({
          sequenceNumber,
          id,
          userId: entry.userId!,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId || '',
          oldValue,
          newValue,
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
            oldValue: oldValue ?? Prisma.JsonNull,
            newValue: newValue ?? Prisma.JsonNull,
            ipAddress: entry.ipAddress || null,
            userAgent: entry.userAgent || null,
            duration: entry.duration || null,
            createdAt,
            sequenceNumber,
            rowHash,
            prevRowHash: prevRow?.rowHash ?? null,
          },
        });
      };
      if (outerTx) await write(outerTx);
      else await this.prisma.$transaction(write);
    } catch (err) {
      // Audit rows are compliance evidence — a silent write failure must ALERT,
      // not just log to stdout. Sentry surfaces the gap so it gets investigated
      // (e.g. the Merkle chain has a hole). We still swallow so a failed audit
      // write never breaks the user-facing request it was observing.
      this.logger.error('Failed to write audit log', err);
      Sentry.captureException(err, { tags: { subsystem: 'audit', action: entry.action } });
      if (outerTx) throw err;
    }
  }

  /**
   * Walk the Merkle chain and return the first sequenceNumber where the
   * recomputed hash doesn't match the stored hash (or prev linkage breaks).
   * Null = chain intact through all rows with non-null hashes.
   *
   * Historical rows where rowHash IS NULL (backfill before this migration)
   * are skipped — the chain is defined only for post-migration rows.
   *
   * Acknowledged breaks (table `audit_chain_acknowledged_breaks`, append-only):
   * the prev-link comparison is skipped for an acknowledged seq ONLY when the
   * row's id, rowHash, stored prevRowHash AND the previous row's rowHash all
   * still equal the values captured at acknowledgement time. Otherwise it is
   * reported as `ACK_MISMATCH`. The acknowledged row's own content hash is
   * still recomputed, and the next row must still link to its rowHash — so
   * every other break, and any later change to the acknowledged row, alerts.
   * If the acknowledgement table can't be read, this throws (fail closed —
   * the cron reports it as a failure instead of silently passing).
   */
  async verifyChain(options: { maxRows?: number } = {}): Promise<{
    ok: boolean;
    rowsChecked: number;
    /** แถวรุ่น 1 (ไม่มี prefix v2:) — ตรวจ hash ย้อนหลังไม่ได้โดยโครงสร้าง ไม่นับเป็น mismatch */
    legacyUnverifiable: number;
    /** จำนวนจุดขาดที่รับรู้แล้ว (acknowledged) ที่เจอและตรงทุกค่าระหว่างเดิน chain */
    acknowledgedBreaks: number;
    acknowledgedSeqs: string[];
    firstMismatchSeq: bigint | null;
    firstMismatchId: string | null;
    mismatchKind: 'PREV_LINK' | 'ROW_HASH' | 'ACK_MISMATCH' | null;
  }> {
    const take = options.maxRows ?? 10_000;
    // Fail closed: no try/catch — an unreadable ack table must surface as an error.
    const acks = await this.prisma.auditChainAcknowledgedBreak.findMany({
      select: {
        sequenceNumber: true,
        auditLogId: true,
        breakType: true,
        expectedPrevRowHash: true,
        actualPrevRowHash: true,
        rowHashAtAck: true,
      },
    });
    const ackBySeq = new Map(acks.map((a) => [a.sequenceNumber.toString(), a]));

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
    let lastSeq: bigint | null = null;
    let legacyUnverifiable = 0;
    const acknowledgedSeqs: string[] = [];
    const mismatch = (
      index: number,
      r: { sequenceNumber: bigint; id: string },
      kind: 'PREV_LINK' | 'ROW_HASH' | 'ACK_MISMATCH',
    ) => ({
      ok: false,
      rowsChecked: index,
      legacyUnverifiable,
      acknowledgedBreaks: acknowledgedSeqs.length,
      acknowledgedSeqs,
      firstMismatchSeq: r.sequenceNumber,
      firstMismatchId: r.id,
      mismatchKind: kind,
    });
    for (const [index, r] of rows.entries()) {
      if (r.sequenceNumber === null || r.rowHash === null) continue;
      const row = { ...r, sequenceNumber: r.sequenceNumber, rowHash: r.rowHash };
      // prev linkage check — เฉพาะเมื่อ seq ต่อเนื่องกันจริง: nextval() ของ tx ที่ rollback
      // ทำให้ seq ข้ามได้ และแถวถัดไปหา prev ที่ seq-1 ไม่เจอจึงเก็บ prevRowHash=null ตามดีไซน์
      // (ไม่ใช่การแก้ข้อมูล) — ช่องว่างแบบนั้นข้ามการเทียบ ไม่ใช่ mismatch
      const contiguous = lastSeq !== null && row.sequenceNumber === lastSeq + BigInt(1);
      if (contiguous && (row.prevRowHash ?? null) !== lastHash) {
        const ack = ackBySeq.get(row.sequenceNumber.toString());
        if (!ack) return mismatch(index, row, 'PREV_LINK');
        const ackMatches =
          ack.breakType === 'PREV_LINK_MISMATCH' &&
          ack.auditLogId === row.id &&
          ack.expectedPrevRowHash === lastHash &&
          (ack.actualPrevRowHash ?? null) === (row.prevRowHash ?? null) &&
          ack.rowHashAtAck === row.rowHash;
        if (!ackMatches) return mismatch(index, row, 'ACK_MISMATCH');
        // จุดขาดที่รับรู้แล้วและทุกค่ายังตรง — ข้ามเฉพาะการเทียบ prev ส่วน hash เนื้อหายังตรวจต่อด้านล่าง
        acknowledgedSeqs.push(row.sequenceNumber.toString());
      }
      lastHash = row.rowHash;
      lastSeq = row.sequenceNumber;
      if (!row.rowHash.startsWith(AuditService.HASH_VERSION_PREFIX)) {
        // แถวรุ่น 1: รูป JSON ตอนเขียนถูก jsonb เรียง key ใหม่ไปแล้ว คำนวณซ้ำไม่ได้
        legacyUnverifiable++;
        continue;
      }
      const expected = this.computeRowHash({
        sequenceNumber: row.sequenceNumber,
        id: row.id,
        userId: row.userId,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        oldValue: row.oldValue as unknown,
        newValue: row.newValue as unknown,
        createdAt: row.createdAt,
        prevRowHash: row.prevRowHash ?? null,
      });
      if (expected !== row.rowHash) return mismatch(index, row, 'ROW_HASH');
    }

    return {
      ok: true,
      rowsChecked: rows.length,
      legacyUnverifiable,
      acknowledgedBreaks: acknowledgedSeqs.length,
      acknowledgedSeqs,
      firstMismatchSeq: null,
      firstMismatchId: null,
      mismatchKind: null,
    };
  }

  async getAuditLogs(filters: {
    userId?: string;
    entity?: string;
    action?: string;
    actions?: string[];
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
    // `actions` (array of exact matches) takes precedence over `action` (substring match)
    if (filters.actions && filters.actions.length > 0) {
      where.action = { in: filters.actions };
    } else if (filters.action) {
      where.action = { contains: filters.action, mode: 'insensitive' };
    }
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
