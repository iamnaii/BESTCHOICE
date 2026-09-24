import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { hashLockKey } from '../../../utils/advisory-lock.util';

/** AS-YYYYMMDD-NNNN — วันตาม Asia/Bangkok, advisory lock ต่อวัน (แบบเดียวกับ RT-) */
@Injectable()
export class AfterSalesDocNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async nextCaseNumber(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date = new Date(),
  ): Promise<string> {
    const yyyymmdd = this.bkkYyyymmdd(issueDate);
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(${hashLockKey(`as-case:${yyyymmdd}`)})`,
    );
    const last = await tx.afterSalesCase.findFirst({
      where: { caseNumber: { startsWith: `AS-${yyyymmdd}-` } },
      orderBy: { caseNumber: 'desc' },
      select: { caseNumber: true },
    });
    const lastSeq = last ? parseInt(last.caseNumber.split('-')[2], 10) || 0 : 0;
    return `AS-${yyyymmdd}-${String(lastSeq + 1).padStart(4, '0')}`;
  }

  private bkkYyyymmdd(date: Date): string {
    const [y, m, d] = date
      .toLocaleString('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      .split('-');
    return `${y}${m}${d}`;
  }
}
