import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Phase 3 SP4 — DEEP review W2 — PdpaBackfillRun retention.
 *
 * Hard-deletes PdpaBackfillRun rows older than the given retention window.
 * Called by `PdpaBackfillRetentionCron` (daily at 02:00 BKK). Matches the
 * existing AuditLog / OffsiteBackupRun retention patterns.
 */
@Injectable()
export class PdpaRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Hard-delete PdpaBackfillRun rows older than the given retention window.
   * Called by `PdpaBackfillRetentionCron` (daily at 02:00 BKK). Matches
   * the existing AuditLog / OffsiteBackupRun retention patterns.
   */
  async pruneOldRuns(retentionDays: number): Promise<number> {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.pdpaBackfillRun.deleteMany({
      where: { startedAt: { lt: cutoff } },
    });
    return result.count;
  }
}
