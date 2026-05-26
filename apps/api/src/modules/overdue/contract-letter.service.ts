import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LetterType, LetterStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DunningEngineService } from './dunning-engine.service';
import { getBranchScope } from '../auth/branch-access.util';

@Injectable()
export class ContractLetterService {
  constructor(
    private prisma: PrismaService,
    private dunningEngine: DunningEngineService,
  ) {}

  /**
   * Create a letter for the given contract + type if one doesn't already exist.
   * Enforces single-letter-per-type-per-contract at the DB level via
   * @@unique([contractId, letterType]). Returns the existing record if already
   * present (idempotent for cron re-runs).
   */
  async createIfNotExists(contractId: string, letterType: LetterType) {
    const existing = await this.prisma.contractLetter.findUnique({
      where: { contractId_letterType: { contractId, letterType } },
    });
    if (existing) return existing;

    const year = new Date().getFullYear();
    const seq = await this.nextSequence(year);
    const letterNumber = `ST-${year}-${seq.toString().padStart(5, '0')}`;

    return this.prisma.contractLetter.create({
      data: { contractId, letterType, letterNumber, status: 'PENDING_DISPATCH' },
    });
  }

  /**
   * Cancel a letter that has not yet been dispatched. Allowed only while the
   * letter is in PENDING_DISPATCH or PDF_GENERATED state. After DISPATCHED,
   * the paper trail is legally load-bearing and cancellation is not allowed —
   * the proper action is to issue a follow-up or mark UNDELIVERABLE post-hoc.
   */
  async cancel(letterId: string, userId: string, reason: string) {
    const letter = await this.prisma.contractLetter.findFirst({
      where: { id: letterId, deletedAt: null },
    });
    if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
    if (!['PENDING_DISPATCH', 'PDF_GENERATED'].includes(letter.status)) {
      throw new BadRequestException('ไม่สามารถยกเลิกหนังสือที่ส่งไปแล้ว');
    }
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('ต้องระบุเหตุผลการยกเลิก (≥ 5 ตัวอักษร)');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.contractLetter.update({
        where: { id: letterId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: reason.trim(),
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'CANCEL_LETTER',
          entity: 'contract_letter',
          entityId: letterId,
          newValue: { reason: reason.trim() },
        },
      }),
    ]);
    return updated;
  }

  /**
   * List letters with pagination, search, and branch scope enforcement.
   * Returns { data, total, page, limit } instead of a plain array.
   * Branch-scoped roles (SALES, BRANCH_MANAGER) are automatically filtered
   * to their assigned branchId via getBranchScope(). Cross-branch roles
   * (OWNER, FINANCE_MANAGER, ACCOUNTANT) see all branches.
   */
  async list(params: {
    status?: LetterStatus;
    letterType?: LetterType;
    branchId?: string;
    from?: string;
    to?: string;
    q?: string;
    page?: number;
    limit?: number;
    user: { role?: string | null; branchId?: string | null };
  }): Promise<{
    data: Awaited<ReturnType<typeof this.prisma.contractLetter.findMany>>;
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));

    const scope = getBranchScope(params.user);
    if (!scope.all && !scope.branchId) {
      return { data: [], total: 0, page, limit };
    }

    const effectiveBranchId = !scope.all ? scope.branchId! : params.branchId;

    const where: Prisma.ContractLetterWhereInput = {
      deletedAt: null,
      ...(params.status && { status: params.status }),
      ...(params.letterType && { letterType: params.letterType }),
      ...((params.from || params.to) && {
        triggeredAt: {
          ...(params.from && { gte: new Date(params.from) }),
          ...(params.to && { lte: new Date(params.to) }),
        },
      }),
      ...(effectiveBranchId && {
        contract: { branchId: effectiveBranchId },
      }),
      ...(params.q && {
        OR: [
          { letterNumber: { contains: params.q, mode: 'insensitive' as const } },
          { contract: { contractNumber: { contains: params.q, mode: 'insensitive' as const } } },
          { contract: { customer: { name: { contains: params.q, mode: 'insensitive' as const } } } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.contractLetter.findMany({
        where,
        include: {
          contract: {
            select: {
              id: true,
              contractNumber: true,
              customer: { select: { id: true, name: true, phone: true, addressCurrent: true } },
              branch: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { triggeredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contractLetter.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /** After client generates PDF and uploads to S3, backend records the URL. */
  async markPdfGenerated(letterId: string, pdfUrl: string | null, userId: string) {
    const letter = await this.prisma.contractLetter.findFirst({
      where: { id: letterId, deletedAt: null },
    });
    if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
    if (letter.status !== 'PENDING_DISPATCH') {
      throw new BadRequestException('สถานะไม่ถูกต้อง — ต้องอยู่ในสถานะ PENDING_DISPATCH');
    }
    return this.prisma
      .$transaction([
        this.prisma.contractLetter.update({
          where: { id: letterId },
          data: { status: 'PDF_GENERATED', pdfUrl: pdfUrl ?? null, pdfGeneratedAt: new Date() },
        }),
        this.prisma.auditLog.create({
          data: {
            userId,
            action: 'LETTER_PDF_GENERATED',
            entity: 'contract_letter',
            entityId: letterId,
            newValue: { pdfUrl },
          },
        }),
      ])
      .then(([l]) => l);
  }

  async markDispatched(
    letterId: string,
    userId: string,
    params: { trackingNumber: string; evidencePhotoUrl?: string },
  ) {
    const letter = await this.prisma.contractLetter.findFirst({
      where: { id: letterId, deletedAt: null },
    });
    if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
    if (letter.status !== 'PDF_GENERATED') {
      throw new BadRequestException('สถานะไม่ถูกต้อง — ต้องอยู่ในสถานะ PDF_GENERATED');
    }
    if (!params.trackingNumber || params.trackingNumber.trim().length < 5) {
      throw new BadRequestException('เลข tracking EMS ต้อง ≥ 5 ตัวอักษร');
    }

    const transactionOps: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.contractLetter.update({
        where: { id: letterId },
        data: {
          status: 'DISPATCHED',
          dispatchedAt: new Date(),
          dispatchedById: userId,
          trackingNumber: params.trackingNumber.trim(),
          evidencePhotoUrl: params.evidencePhotoUrl ?? null,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'LETTER_DISPATCHED',
          entity: 'contract_letter',
          entityId: letterId,
          newValue: {
            trackingNumber: params.trackingNumber,
            evidencePhotoUrl: params.evidencePhotoUrl ?? null,
          },
        },
      }),
    ];

    if (letter.letterType === 'CONTRACT_TERMINATION_60D') {
      // Read the actual current status so audit log reflects reality (contract
      // may be OVERDUE, DEFAULT, etc. — not always DEFAULT).
      const currentContract = await this.prisma.contract.findUnique({
        where: { id: letter.contractId },
        select: { status: true },
      });
      const fromStatus = currentContract?.status ?? 'UNKNOWN';
      transactionOps.push(
        this.prisma.contract.update({
          where: { id: letter.contractId },
          data: { status: 'TERMINATED' },
        }),
      );
      transactionOps.push(
        this.prisma.auditLog.create({
          data: {
            userId,
            action: 'CONTRACT_STATUS_LEGAL',
            entity: 'contract',
            entityId: letter.contractId,
            newValue: {
              from: fromStatus,
              to: 'TERMINATED',
              reason: `60d termination letter dispatched: ${letter.letterNumber}`,
            },
          },
        }),
      );
    }

    const [updated] = await this.prisma.$transaction(transactionOps);

    // Fire LINE event — non-fatal
    try {
      await this.dunningEngine.executeEventTrigger(
        'LETTER_DISPATCHED',
        letter.contractId,
        null,
        null,
        { trackingNumber: params.trackingNumber },
      );
    } catch {
      // already logged by engine
    }

    // If CONTRACT_TERMINATION_60D, also fire CONTRACT_TERMINATED event
    if (letter.letterType === 'CONTRACT_TERMINATION_60D') {
      try {
        await this.dunningEngine.executeEventTrigger(
          'CONTRACT_TERMINATED',
          letter.contractId,
          null,
          null,
        );
      } catch {
        /* non-fatal */
      }
    }

    return updated;
  }

  async markDelivered(letterId: string, userId: string) {
    const letter = await this.prisma.contractLetter.findFirst({
      where: { id: letterId, deletedAt: null },
    });
    if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
    if (letter.status !== 'DISPATCHED') {
      throw new BadRequestException('สถานะไม่ถูกต้อง — ต้องอยู่ในสถานะ DISPATCHED');
    }
    return this.prisma
      .$transaction([
        this.prisma.contractLetter.update({
          where: { id: letterId },
          data: { status: 'DELIVERED', deliveredAt: new Date() },
        }),
        this.prisma.auditLog.create({
          data: {
            userId,
            action: 'LETTER_DELIVERED',
            entity: 'contract_letter',
            entityId: letterId,
          },
        }),
      ])
      .then(([l]) => l);
  }

  async markUndeliverable(letterId: string, userId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('เหตุผลต้อง ≥ 5 ตัวอักษร');
    }
    const letter = await this.prisma.contractLetter.findFirst({
      where: { id: letterId, deletedAt: null },
    });
    if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
    if (letter.status !== 'DISPATCHED') {
      throw new BadRequestException('สถานะไม่ถูกต้อง');
    }
    return this.prisma
      .$transaction([
        this.prisma.contractLetter.update({
          where: { id: letterId },
          data: { status: 'UNDELIVERABLE', cancelReason: reason.trim(), cancelledAt: new Date() },
        }),
        this.prisma.contract.update({
          where: { id: letter.contractId },
          data: { needsSkipTracing: true },
        }),
        this.prisma.auditLog.create({
          data: {
            userId,
            action: 'LETTER_UNDELIVERABLE',
            entity: 'contract_letter',
            entityId: letterId,
            newValue: { reason },
          },
        }),
      ])
      .then(([l]) => l);
  }

  /**
   * Z9: Revert a letter from UNDELIVERABLE back to DISPATCHED. Used by the
   * MARK_UNDELIVERABLE undo snackbar. Authorisation:
   *   - OWNER may revert any UNDELIVERABLE letter
   *   - The original dispatcher (`dispatchedById`) may revert their own
   * Anything else → ForbiddenException. Letters not in UNDELIVERABLE state
   * → BadRequestException (defence-in-depth; FE flow should not allow this).
   * Side effect: clears `cancelReason` + `cancelledAt`. Does NOT clear the
   * contract's `needsSkipTracing` flag — once flagged for skip-tracing the
   * customer's outreach gap stands until manually resolved.
   */
  async revertUndeliverable(letterId: string, userId: string, userRole: string) {
    const letter = await this.prisma.contractLetter.findUnique({ where: { id: letterId } });
    if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
    if (letter.status !== 'UNDELIVERABLE') {
      throw new BadRequestException('สามารถ revert เฉพาะหนังสือที่ส่งไม่ถึงเท่านั้น');
    }
    const isOwner = userRole === 'OWNER';
    const isDispatcher = !!letter.dispatchedById && letter.dispatchedById === userId;
    if (!isOwner && !isDispatcher) {
      throw new ForbiddenException('revert ได้เฉพาะ OWNER หรือผู้ส่งหนังสือเท่านั้น');
    }

    return this.prisma
      .$transaction([
        this.prisma.contractLetter.update({
          where: { id: letterId },
          data: { status: 'DISPATCHED', cancelReason: null, cancelledAt: null },
        }),
        this.prisma.auditLog.create({
          data: {
            userId,
            action: 'LETTER_UNDELIVERABLE_REVERTED',
            entity: 'contract_letter',
            entityId: letterId,
          },
        }),
      ])
      .then(([l]) => l);
  }

  /**
   * Update the evidence photo URL for a letter that has already been dispatched or delivered.
   * Creates an audit trail entry alongside the update.
   */
  async updateEvidence(letterId: string, evidencePhotoUrl: string, userId: string) {
    const letter = await this.prisma.contractLetter.findUnique({ where: { id: letterId } });
    if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
    if (!['DISPATCHED', 'DELIVERED'].includes(letter.status)) {
      throw new BadRequestException('สามารถเพิ่มสลิปได้เฉพาะหนังสือที่ส่งแล้ว');
    }
    if (!evidencePhotoUrl || !evidencePhotoUrl.trim()) {
      throw new BadRequestException('กรุณาอัปโหลดสลิป');
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.contractLetter.update({
        where: { id: letterId },
        data: { evidencePhotoUrl: evidencePhotoUrl.trim() },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'LETTER_EVIDENCE_UPDATED',
          entity: 'contract_letter',
          entityId: letterId,
          newValue: { evidencePhotoUrl },
        },
      }),
    ]);
    return updated;
  }

  async bulkDispatch(
    items: Array<{ id: string; trackingNumber: string; evidencePhotoUrl?: string }>,
    userId: string,
  ): Promise<{ updated: Array<{ id: string }>; batchId: string }> {
    if (items.length === 0) {
      throw new BadRequestException('ต้องเลือกอย่างน้อย 1 ฉบับ');
    }

    const ids = items.map((i) => i.id);
    const letters = await this.prisma.contractLetter.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, status: true },
    });

    if (letters.length !== ids.length) {
      const found = new Set(letters.map((l) => l.id));
      const missing = ids.filter((id) => !found.has(id));
      throw new BadRequestException(`ไม่พบจดหมาย: ${missing.join(', ')}`);
    }

    const invalidStatus = letters.filter((l) => l.status !== 'PDF_GENERATED');
    if (invalidStatus.length > 0) {
      throw new BadRequestException(
        `สถานะไม่ถูกต้อง — ต้อง PDF_GENERATED: ${invalidStatus.map((l) => l.id).join(', ')}`,
      );
    }

    const batchId = randomUUID();
    const now = new Date();

    const updateOps = items.map((item) =>
      this.prisma.contractLetter.update({
        where: { id: item.id },
        data: {
          status: 'DISPATCHED' as const,
          dispatchedAt: now,
          dispatchedById: userId,
          trackingNumber: item.trackingNumber.trim(),
          evidencePhotoUrl: item.evidencePhotoUrl ?? null,
        },
      }),
    );

    const auditOps = items.map((item) =>
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'LETTER_DISPATCHED',
          entity: 'contract_letter',
          entityId: item.id,
          newValue: { trackingNumber: item.trackingNumber, batchId, source: 'bulk' },
        },
      }),
    );

    const results = (await this.prisma.$transaction([...updateOps, ...auditOps])) as Array<unknown>;
    const updated = results.slice(0, items.length) as Array<{ id: string }>;

    return { updated, batchId };
  }

  async getCountsByStatus(params: {
    branchId?: string;
    letterType?: LetterType;
    from?: string;
    to?: string;
    q?: string;
    user: { role?: string | null; branchId?: string | null };
  }): Promise<Record<LetterStatus, number>> {
    const scope = getBranchScope(params.user);
    if (!scope.all && !scope.branchId) {
      return {
        PENDING_DISPATCH: 0,
        PDF_GENERATED: 0,
        DISPATCHED: 0,
        DELIVERED: 0,
        UNDELIVERABLE: 0,
        CANCELLED: 0,
      };
    }

    const effectiveBranchId = !scope.all ? scope.branchId! : params.branchId;

    const where: Prisma.ContractLetterWhereInput = {
      deletedAt: null,
      ...(params.letterType && { letterType: params.letterType }),
      ...((params.from || params.to) && {
        triggeredAt: {
          ...(params.from && { gte: new Date(params.from) }),
          ...(params.to && { lte: new Date(params.to) }),
        },
      }),
      ...(effectiveBranchId && { contract: { branchId: effectiveBranchId } }),
      ...(params.q && {
        OR: [
          { letterNumber: { contains: params.q, mode: 'insensitive' as const } },
          { contract: { contractNumber: { contains: params.q, mode: 'insensitive' as const } } },
          { contract: { customer: { name: { contains: params.q, mode: 'insensitive' as const } } } },
        ],
      }),
    };

    const grouped = await this.prisma.contractLetter.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    const result: Record<LetterStatus, number> = {
      PENDING_DISPATCH: 0,
      PDF_GENERATED: 0,
      DISPATCHED: 0,
      DELIVERED: 0,
      UNDELIVERABLE: 0,
      CANCELLED: 0,
    };
    for (const row of grouped) {
      result[row.status as LetterStatus] = row._count._all;
    }
    return result;
  }

  private async nextSequence(year: number): Promise<number> {
    const count = await this.prisma.contractLetter.count({
      where: { letterNumber: { startsWith: `ST-${year}-` } },
    });
    return count + 1;
  }
}
