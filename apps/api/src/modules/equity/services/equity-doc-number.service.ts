import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/** EQ-YYYYMMDD-NNNN — BKK-day advisory-lock pattern (สำเนาจาก other-income DocNumberService) */
@Injectable()
export class EquityDocNumberService {
  async nextDocNumber(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date,
  ): Promise<string> {
    const { yyyymmdd } = this.getBkkDayBounds(issueDate);
    const lockKey = this.hashLockKey(`eq:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    // max(seq) ไม่ใช่ count() — เอกสาร soft-deleted ยังครองเลขผ่าน unique constraint
    const lastDoc = await tx.equityDocument.findFirst({
      where: { docNumber: { startsWith: `EQ-${yyyymmdd}-` } },
      orderBy: { docNumber: 'desc' },
      select: { docNumber: true },
    });
    const lastSeq = lastDoc ? parseInt(lastDoc.docNumber.split('-')[2], 10) || 0 : 0;
    return `EQ-${yyyymmdd}-${String(lastSeq + 1).padStart(4, '0')}`;
  }

  private getBkkDayBounds(date: Date): { yyyymmdd: string } {
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
    return { yyyymmdd: `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}` };
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return h;
  }
}
