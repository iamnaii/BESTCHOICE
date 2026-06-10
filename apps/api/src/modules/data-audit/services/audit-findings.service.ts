import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class AuditFindingsService {
  private readonly logger = new Logger(AuditFindingsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════
  // History
  // ═══════════════════════════════════════════════════════════════

  async getHistory(filters: { checkName?: string; limit?: number }) {
    const where: Prisma.DataAuditLogWhereInput = {};
    if (filters.checkName) {
      where.checkName = filters.checkName;
    }

    const logs = await this.prisma.dataAuditLog.findMany({
      where,
      orderBy: { executedAt: 'desc' },
      take: filters.limit || 50,
    });

    return logs;
  }

  // ═══════════════════════════════════════════════════════════════
  // T2-C7: Acknowledgement workflow for failed checks
  // ═══════════════════════════════════════════════════════════════

  /**
   * List unacknowledged FAIL findings from the last 30 days.
   * Default filter: severity in [CRITICAL, HIGH]. Sorting puts oldest on top
   * so the SLA clock (24h) is obvious in the UI.
   */
  async getUnacknowledgedFindings(severity?: string) {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const severities = severity
      ? [severity.toUpperCase()]
      : ['CRITICAL', 'HIGH'];

    return this.prisma.dataAuditLog.findMany({
      where: {
        status: 'FAIL',
        acknowledgedAt: null,
        severity: { in: severities },
        executedAt: { gte: since },
      },
      orderBy: { executedAt: 'asc' },
      include: {
        acknowledgedBy: { select: { id: true, name: true } },
      },
      take: 200,
    });
  }

  async acknowledgeFinding(findingId: string, userId: string, notes?: string) {
    const existing = await this.prisma.dataAuditLog.findUnique({
      where: { id: findingId },
    });
    if (!existing) {
      throw new Error(`DataAuditLog ${findingId} not found`);
    }
    if (existing.acknowledgedAt) {
      // Idempotent: return the already-acknowledged row
      return existing;
    }
    if (existing.status !== 'FAIL') {
      throw new Error('ตรวจรับได้เฉพาะ FAIL findings');
    }

    return this.prisma.dataAuditLog.update({
      where: { id: findingId },
      data: {
        acknowledgedAt: new Date(),
        acknowledgedById: userId,
        acknowledgeNotes: notes ?? null,
      },
    });
  }

  /**
   * Escalation check — called hourly. Emits Sentry error for any
   * CRITICAL/HIGH finding that has been unacknowledged for >24h.
   */
  async scanForSlaBreaches(): Promise<{ breached: number }> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const overdue = await this.prisma.dataAuditLog.findMany({
      where: {
        status: 'FAIL',
        acknowledgedAt: null,
        severity: { in: ['CRITICAL', 'HIGH'] },
        executedAt: { lte: cutoff },
      },
      select: { id: true, checkName: true, severity: true, executedAt: true },
      orderBy: { executedAt: 'asc' },
      take: 100,
    });

    if (overdue.length > 0) {
      this.logger.error(
        `Data audit SLA breach: ${overdue.length} finding(s) unacknowledged > 24h`,
      );
      Sentry.captureMessage(
        `Data audit SLA breach: ${overdue.length} finding(s) unacknowledged > 24h`,
        {
          level: 'error',
          tags: { kind: 'data-audit', cron: 'data-audit-sla' },
          extra: { findings: overdue },
        },
      );
    }

    return { breached: overdue.length };
  }
}
