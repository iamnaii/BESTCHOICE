import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class DocNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async nextDocNumber(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date,
  ): Promise<string> {
    const { start, end, yyyymmdd } = this.getBkkDayBounds(issueDate);
    const lockKey = this.hashLockKey(`oi:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const count = await tx.otherIncome.count({
      where: { issueDate: { gte: start, lt: end }, deletedAt: null },
    });

    const seq = String(count + 1).padStart(4, '0');
    return `OI-${yyyymmdd}-${seq}`;
  }

  async nextReceiptNumber(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date,
  ): Promise<string> {
    const { start, end, yyyymmdd } = this.getBkkDayBounds(issueDate);
    const lockKey = this.hashLockKey(`rc:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const count = await tx.otherIncome.count({
      where: {
        receiptNo: { not: null },
        issueDate: { gte: start, lt: end },
        deletedAt: null,
      },
    });

    const seq = String(count + 1).padStart(3, '0');
    return `RC-${yyyymmdd}-${seq}`;
  }

  /**
   * Returns Asia/Bangkok day boundaries and YYYYMMDD string for the given date.
   * BKK is UTC+7 with no DST — uses Intl-based approach consistent with the
   * rest of the codebase (e.g. business-hours.util.ts).
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
    // Construct start as UTC equivalent of BKK 00:00:00
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
