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
    const { yyyymmdd } = this.getBkkDayBounds(issueDate);
    const lockKey = this.hashLockKey(`device-return:${yyyymmdd}`);
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

  /** BKK = UTC+7 ไม่มี DST — วิธีเดียวกับ other-income DocNumberService / IntercoBatchNumberService */
  private getBkkDayBounds(date: Date): { start: Date; end: Date; yyyymmdd: string } {
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
    const yyyymmdd = `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
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
