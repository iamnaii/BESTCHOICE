import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { bkkYyyymmdd } from '../../utils/document-number-format.util';

/**
 * เลขคำขอตัดสินค้า `SA-YYYYMMDD-NNNN` (ก้อน 3) — วันไทย · ลำดับรีเซ็ตเที่ยงคืนไทย · advisory lock ต่อวัน
 * กันสองคำขอพร้อมกันได้เลขซ้ำ. ลอกรูป `IntercoBatchNumberService` ทุกประการ (max ผ่าน findFirst desc —
 * แถวที่ถูก soft-delete ยังถือเลขอยู่ผ่าน unique จึงใช้ count() ไม่ได้).
 */
@Injectable()
export class StockAdjustmentNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async next(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date = new Date(),
  ): Promise<string> {
    const yyyymmdd = bkkYyyymmdd(issueDate);
    const lockKey = this.hashLockKey(`sa:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const last = await tx.stockAdjustment.findFirst({
      where: { requestNumber: { startsWith: `SA-${yyyymmdd}-` } },
      orderBy: { requestNumber: 'desc' },
      select: { requestNumber: true },
    });

    const lastSeq = last?.requestNumber ? parseInt(last.requestNumber.split('-')[2], 10) || 0 : 0;
    return `SA-${yyyymmdd}-${String(lastSeq + 1).padStart(4, '0')}`;
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
