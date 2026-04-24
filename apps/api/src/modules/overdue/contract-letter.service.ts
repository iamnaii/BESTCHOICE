import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { LetterType, LetterStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DunningEngineService } from './dunning-engine.service';

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
  async cancel(letterId: string, _userId: string, reason: string) {
    const letter = await this.prisma.contractLetter.findUnique({ where: { id: letterId } });
    if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
    if (!['PENDING_DISPATCH', 'PDF_GENERATED'].includes(letter.status)) {
      throw new BadRequestException('ไม่สามารถยกเลิกหนังสือที่ส่งไปแล้ว');
    }
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('ต้องระบุเหตุผลการยกเลิก (≥ 5 ตัวอักษร)');
    }

    return this.prisma.contractLetter.update({
      where: { id: letterId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason.trim(),
      },
    });
  }

  /**
   * List letters matching a status filter, newest-triggered first.
   * Includes contract + customer for display in OWNER queue.
   */
  async list(params: {
    status?: LetterStatus;
    letterType?: LetterType;
    branchId?: string;
    limit?: number;
  }) {
    const where: Prisma.ContractLetterWhereInput = {
      deletedAt: null,
      ...(params.status && { status: params.status }),
      ...(params.letterType && { letterType: params.letterType }),
      ...(params.branchId && { contract: { branchId: params.branchId } }),
    };
    return this.prisma.contractLetter.findMany({
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
      take: params.limit ?? 100,
    });
  }

  /** After client generates PDF and uploads to S3, backend records the URL. */
  async markPdfGenerated(letterId: string, pdfUrl: string, userId: string) {
    const letter = await this.prisma.contractLetter.findUnique({ where: { id: letterId } });
    if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
    if (letter.status !== 'PENDING_DISPATCH') {
      throw new BadRequestException('สถานะไม่ถูกต้อง — ต้องอยู่ในสถานะ PENDING_DISPATCH');
    }
    return this.prisma
      .$transaction([
        this.prisma.contractLetter.update({
          where: { id: letterId },
          data: { status: 'PDF_GENERATED', pdfUrl, pdfGeneratedAt: new Date() },
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
    const letter = await this.prisma.contractLetter.findUnique({ where: { id: letterId } });
    if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
    if (letter.status !== 'PDF_GENERATED') {
      throw new BadRequestException('สถานะไม่ถูกต้อง — ต้องอยู่ในสถานะ PDF_GENERATED');
    }
    if (!params.trackingNumber || params.trackingNumber.trim().length < 5) {
      throw new BadRequestException('เลข tracking EMS ต้อง ≥ 5 ตัวอักษร');
    }

    const [updated] = await this.prisma.$transaction([
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
    ]);

    // Fire LINE event — non-fatal
    try {
      await this.dunningEngine.executeEventTrigger(
        'LETTER_DISPATCHED',
        letter.contractId,
        null,
        null,
        { trackingNumber: params.trackingNumber } as any,
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
    const letter = await this.prisma.contractLetter.findUnique({ where: { id: letterId } });
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
    const letter = await this.prisma.contractLetter.findUnique({ where: { id: letterId } });
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

  private async nextSequence(year: number): Promise<number> {
    const count = await this.prisma.contractLetter.count({
      where: { letterNumber: { startsWith: `ST-${year}-` } },
    });
    return count + 1;
  }
}
