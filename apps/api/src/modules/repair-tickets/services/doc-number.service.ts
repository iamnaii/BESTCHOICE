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
    const { yyyymmdd } = this.getBkkDayBounds(issueDate);
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

  /**
   * Returns Asia/Bangkok day boundaries and YYYYMMDD string for the given date.
   * BKK is UTC+7 with no DST — uses Intl-based approach consistent with the
   * rest of the codebase (e.g. other-income DocNumberService, business-hours.util.ts).
   */
  private getBkkDayBounds(date: Date): { start: Date; end: Date; yyyymmdd: string } {
    // Extract BKK local date parts via Intl
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // en-CA format gives "YYYY-MM-DD"
    const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
    const yyyymmdd = `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;

    // BKK midnight = UTC midnight minus 7 hours = UTC (prev day) 17:00:00Z
    const bkkOffsetMs = 7 * 60 * 60 * 1000;
    const start = new Date(Date.UTC(y, m - 1, d) - bkkOffsetMs);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    return { start, end, yyyymmdd };
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
