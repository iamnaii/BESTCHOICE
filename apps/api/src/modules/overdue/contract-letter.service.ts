import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { LetterType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ContractLetterService {
  constructor(private prisma: PrismaService) {}

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

  private async nextSequence(year: number): Promise<number> {
    const count = await this.prisma.contractLetter.count({
      where: { letterNumber: { startsWith: `ST-${year}-` } },
    });
    return count + 1;
  }
}
