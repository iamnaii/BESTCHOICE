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
    const { yyyymmdd } = this.getBkkDayBounds(issueDate);
    const lockKey = this.hashLockKey(`oi:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    // Use max(seq) instead of count() — soft-deleted docs still occupy their
    // docNumber via the unique constraint, so count(deletedAt=null) would
    // collide with their numbers. findFirst with desc ordering sees all rows
    // and gives us the next available sequence.
    const lastDoc = await tx.otherIncome.findFirst({
      where: { docNumber: { startsWith: `OI-${yyyymmdd}-` } },
      orderBy: { docNumber: 'desc' },
      select: { docNumber: true },
    });

    const lastSeq = lastDoc
      ? parseInt(lastDoc.docNumber.split('-')[2], 10) || 0
      : 0;
    const seq = String(lastSeq + 1).padStart(4, '0');
    return `OI-${yyyymmdd}-${seq}`;
  }

  async nextReceiptNumber(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date,
  ): Promise<string> {
    const yyyymm = this.getBkkYyyymm(issueDate);
    const lockKey = this.hashLockKey(`rt:${yyyymm}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const lastDoc = await tx.otherIncome.findFirst({
      where: { receiptNo: { startsWith: `RT-${yyyymm}-` } },
      orderBy: { receiptNo: 'desc' },
      select: { receiptNo: true },
    });

    const lastSeq = lastDoc?.receiptNo
      ? parseInt(lastDoc.receiptNo.split('-')[2], 10) || 0
      : 0;
    const seq = String(lastSeq + 1).padStart(5, '0');
    return `RT-${yyyymm}-${seq}`;
  }

  private getBkkYyyymm(date: Date): string {
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
    });
    // Defensive: en-CA with year+month returns "YYYY-MM" today, but slice the
    // first two segments to stay robust against ICU output shape drift across
    // Node versions. Mirrors getBkkDayBounds() style.
    return parts.split('-').slice(0, 2).join('');
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
