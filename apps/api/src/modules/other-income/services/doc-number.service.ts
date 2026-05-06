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
    const yyyymmdd = this.formatYYYYMMDD(issueDate);
    const lockKey = this.hashLockKey(`oi:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const startOfDay = new Date(issueDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const count = await tx.otherIncome.count({
      where: { issueDate: { gte: startOfDay, lt: endOfDay } },
    });

    const seq = String(count + 1).padStart(4, '0');
    return `OI-${yyyymmdd}-${seq}`;
  }

  async nextReceiptNumber(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date,
  ): Promise<string> {
    const yyyymmdd = this.formatYYYYMMDD(issueDate);
    const lockKey = this.hashLockKey(`rc:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const startOfDay = new Date(issueDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const count = await tx.otherIncome.count({
      where: {
        receiptNo: { not: null },
        issueDate: { gte: startOfDay, lt: endOfDay },
      },
    });

    const seq = String(count + 1).padStart(3, '0');
    return `RC-${yyyymmdd}-${seq}`;
  }

  private formatYYYYMMDD(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
