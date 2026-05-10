import { Injectable } from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';

const PREFIX_MAP: Record<DocumentType, string> = {
  EXPENSE: 'EX',
  CREDIT_NOTE: 'CN',
  PAYROLL: 'PR',
  VENDOR_SETTLEMENT: 'SE',
};

@Injectable()
export class DocNumberService {
  /**
   * Generate next sequential document number with race-safe Postgres
   * advisory lock per (type, BKK-day) key. Mirrors OI/RT pattern.
   *
   * Format: <TYPE>-YYYYMMDD-NNNN — daily reset, 4-digit seq.
   */
  async next(
    tx: Prisma.TransactionClient,
    type: DocumentType,
    issueDate: Date,
  ): Promise<string> {
    const yyyymmdd = this.bkkYyyymmdd(issueDate);
    const prefix = `${PREFIX_MAP[type]}-${yyyymmdd}-`;
    const lockKey = this.hashLockKey(`expdoc:${type}:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const last = await tx.expenseDocument.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const lastSeq = last
      ? parseInt(last.number.slice(prefix.length), 10) || 0
      : 0;
    const seq = String(lastSeq + 1).padStart(4, '0');
    return `${prefix}${seq}`;
  }

  /** Asia/Bangkok local YYYYMMDD via Intl (BKK is UTC+7, no DST). */
  private bkkYyyymmdd(date: Date): string {
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
    return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
  }

  /** Deterministic 32-bit hash for advisory lock keys. */
  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
