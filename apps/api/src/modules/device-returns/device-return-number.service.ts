import { bkkYyyymmdd } from '../../utils/document-number-format.util';
import { hashLockKey } from '../../utils/advisory-lock.util';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * เลขที่ใบรับเครื่องคืน `DR-YYYYMMDD-NNNN` — copy ของ `IntercoBatchNumberService`
 * (advisory lock ต่อวัน BKK + max-via-findFirst-desc; ไม่ใช้ count() เพราะแถว soft-deleted
 * ยังถือเลขผ่าน unique). ไม่ใช้ `DocNumberService` ของ expense (ผูก enum DocumentType ใน Prisma).
 * spec 2026-09-20 §4.1.
 */
@Injectable()
export class DeviceReturnNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async next(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date = new Date(),
  ): Promise<string> {
    const yyyymmdd = bkkYyyymmdd(issueDate);
    const lockKey = hashLockKey(`device-return:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const lastDoc = await tx.deviceReturn.findFirst({
      where: { docNumber: { startsWith: `DR-${yyyymmdd}-` } },
      orderBy: { docNumber: 'desc' },
      select: { docNumber: true },
    });

    const lastSeq = lastDoc ? parseInt(lastDoc.docNumber.split('-')[2], 10) || 0 : 0;
    const seq = String(lastSeq + 1).padStart(4, '0');
    return `DR-${yyyymmdd}-${seq}`;
  }

}
