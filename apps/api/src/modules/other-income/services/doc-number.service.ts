import { bkkYyyymmdd, bkkYyyymm } from '../../../utils/document-number-format.util';
import { hashLockKey } from '../../../utils/advisory-lock.util';
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
    const yyyymmdd = bkkYyyymmdd(issueDate);
    const lockKey = hashLockKey(`oi:${yyyymmdd}`);
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
    const yyyymm = bkkYyyymm(issueDate);
    const lockKey = hashLockKey(`rt:${yyyymm}`);
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

}
