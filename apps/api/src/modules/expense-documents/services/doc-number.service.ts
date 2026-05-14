import { BadRequestException, Injectable } from '@nestjs/common';
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
   *
   * `issueDate` convention (W5): the BKK-day is derived from the user-chosen
   * `documentDate` (NOT server "now"), so a same-day creation backdated to
   * yesterday will still number under yesterday's sequence. This is intentional
   * — auditors expect a doc dated 2026-05-13 to carry an EX-20260513-NNNN
   * number regardless of when it was keyed in. The per-day advisory lock still
   * prevents collisions across concurrent backdates onto the same day. If the
   * convention ever needs to change, see the W5 note in fix report v1.1.
   *
   * W4 — explicit throw when seq > 9999 (would overflow the 4-digit slot and
   * silently produce a 5-digit number that sorts wrong). Real-world limit is
   * ~100 docs/day, so this is purely a guard against runaway loops / data
   * corruption / future high-volume regimes.
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
    const nextSeq = lastSeq + 1;
    if (nextSeq > 9999) {
      throw new BadRequestException(
        `เลขที่เอกสาร ${PREFIX_MAP[type]} เกิน 9999 ใน 1 วัน (BKK ${yyyymmdd}) — ติดต่อผู้ดูแลระบบ`,
      );
    }
    const seq = String(nextSeq).padStart(4, '0');
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
