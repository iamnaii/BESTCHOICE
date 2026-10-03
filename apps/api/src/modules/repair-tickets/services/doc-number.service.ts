import { bkkYyyymmdd } from '../../../utils/document-number-format.util';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class RepairTicketDocNumberService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate next ticket number in format RT-YYYYMMDD-NNNN.
   * Sequence resets at Asia/Bangkok midnight. Advisory lock per BKK-day
   * prevents race conditions when 2 tickets are created concurrently.
   *
   * Uses max(seq) via findFirst+desc ordering — soft-deleted tickets still
   * occupy their ticketNumber via the unique constraint, so count() would
   * collide. Mirrors the OI DocNumberService pattern exactly.
   */
  async nextTicketNumber(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date = new Date(),
  ): Promise<string> {
    const yyyymmdd = bkkYyyymmdd(issueDate);
    const lockKey = this.hashLockKey(`rt-ticket:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const lastDoc = await tx.repairTicket.findFirst({
      where: { ticketNumber: { startsWith: `RT-${yyyymmdd}-` } },
      orderBy: { ticketNumber: 'desc' },
      select: { ticketNumber: true },
    });

    const lastSeq = lastDoc
      ? parseInt(lastDoc.ticketNumber.split('-')[2], 10) || 0
      : 0;
    const seq = String(lastSeq + 1).padStart(4, '0');
    return `RT-${yyyymmdd}-${seq}`;
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
