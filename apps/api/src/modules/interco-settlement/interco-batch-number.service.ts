import { bkkYyyymmdd } from '../../utils/document-number-format.util';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — เลขเอกสารรอบจ่าย.
 *
 * Generates the next batch number in format IC-YYYYMMDD-NNNN. Sequence
 * resets at Asia/Bangkok midnight. Advisory lock per BKK-day prevents race
 * conditions when 2 batches are created concurrently.
 *
 * Mirrors `RepairTicketDocNumberService`
 * (`apps/api/src/modules/repair-tickets/services/doc-number.service.ts`)
 * exactly — same getBkkDayBounds/advisory-lock/max-via-findFirst-desc
 * approach, just swapped to `InterCoSettlementBatch.batchNumber` with an
 * `IC-` prefix. Uses max(seq) via findFirst+desc ordering — soft-deleted
 * batches still occupy their batchNumber via the unique constraint, so
 * count() would collide.
 *
 * Spec: docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md §3
 */
@Injectable()
export class IntercoBatchNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async next(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date = new Date(),
  ): Promise<string> {
    const yyyymmdd = bkkYyyymmdd(issueDate);
    const lockKey = this.hashLockKey(`ic-batch:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const lastDoc = await tx.interCoSettlementBatch.findFirst({
      where: { batchNumber: { startsWith: `IC-${yyyymmdd}-` } },
      orderBy: { batchNumber: 'desc' },
      select: { batchNumber: true },
    });

    const lastSeq = lastDoc
      ? parseInt(lastDoc.batchNumber.split('-')[2], 10) || 0
      : 0;
    const seq = String(lastSeq + 1).padStart(4, '0');
    return `IC-${yyyymmdd}-${seq}`;
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
