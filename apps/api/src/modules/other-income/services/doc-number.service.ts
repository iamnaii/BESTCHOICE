import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildStartsWithPrefix,
  formatDocNumber,
  getPeriodBounds,
  hashLockKey,
  parseSequence,
} from '../../../utils/doc-number-format.util';

/**
 * Other Income document + receipt number generator.
 *
 * SP4 — reads `DocumentNumberConfig` (docType 'OI' / 'RT') when present and
 * falls back to the legacy hard-coded format if a row is missing or the table
 * doesn't exist yet. Existing tests that run before the SP4 migration is
 * applied get unchanged behavior thanks to the try/catch fallback.
 */
@Injectable()
export class DocNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async nextDocNumber(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date,
  ): Promise<string> {
    const config = await this.tryLoadConfig('OI');
    const prefix = config?.prefix || 'OI';
    const format = config?.format || '{prefix}-{YYYYMMDD}-{NNNN}';
    const cadence = config?.resetCadence || 'DAILY';
    const digitCount = config?.digitCount || 4;

    const bounds = getPeriodBounds(issueDate, cadence);
    const startsWith = buildStartsWithPrefix(format, prefix, issueDate);
    const lockKey = hashLockKey(`oi:${bounds.periodKey}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    // Use max(seq) instead of count() — soft-deleted docs still occupy their
    // docNumber via the unique constraint, so count(deletedAt=null) would
    // collide with their numbers. findFirst with desc ordering sees all rows
    // and gives us the next available sequence.
    const lastDoc = await tx.otherIncome.findFirst({
      where: { docNumber: { startsWith } },
      orderBy: { docNumber: 'desc' },
      select: { docNumber: true },
    });

    const lastSeq = lastDoc ? parseSequence(lastDoc.docNumber, startsWith) : 0;
    const nextSeq = lastSeq + 1;
    return formatDocNumber(format, prefix, nextSeq, issueDate, digitCount);
  }

  async nextReceiptNumber(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date,
  ): Promise<string> {
    const config = await this.tryLoadConfig('RT');
    const prefix = config?.prefix || 'RT';
    const format = config?.format || '{prefix}-{YYYYMM}-{NNNNN}';
    const cadence = config?.resetCadence || 'MONTHLY';
    const digitCount = config?.digitCount || 5;

    const bounds = getPeriodBounds(issueDate, cadence);
    const startsWith = buildStartsWithPrefix(format, prefix, issueDate);
    const lockKey = hashLockKey(`rt:${bounds.periodKey}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const lastDoc = await tx.otherIncome.findFirst({
      where: { receiptNo: { startsWith } },
      orderBy: { receiptNo: 'desc' },
      select: { receiptNo: true },
    });

    const lastSeq = lastDoc?.receiptNo ? parseSequence(lastDoc.receiptNo, startsWith) : 0;
    const nextSeq = lastSeq + 1;
    return formatDocNumber(format, prefix, nextSeq, issueDate, digitCount);
  }

  /**
   * SP4 — load the active config for a docType. Returns null on any error so
   * the legacy hard-coded path remains in effect:
   *   - Config row missing
   *   - Table missing (running against an older DB)
   *   - inactive (active=false)
   */
  private async tryLoadConfig(docType: string) {
    try {
      const row = await this.prisma.documentNumberConfig.findUnique({
        where: { docType },
      });
      if (!row || row.deletedAt || !row.active) return null;
      return row;
    } catch {
      return null;
    }
  }
}
