import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Compliance dashboard queries used by AnalyticsTab > Compliance section.
 * 4 endpoints:
 *  1. dunning-frequency  — PDPA: contracts hit > N times in past 30 days
 *  2. legal-pipeline     — LEGAL contracts with hearing in 7/14/30 days
 *  3. audit-summary      — actions per user / type, anomalies
 *  4. voice-memo-retention — CallLogs eligible for Glacier transition / delete
 *
 * Defaults:
 *  - dunning-frequency threshold = 4 (overridable via SystemConfig key
 *    `compliance_dunning_threshold`)
 *  - voice memo retention HOT-to-Glacier = 90 days, delete = 365 days
 */
@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  // PDPA threshold: more than this many dunning actions in 30 days flags PDPA risk.
  static readonly DEFAULT_DUNNING_THRESHOLD = 4;
  // Hearing window buckets — show contracts with hearing in <= N days.
  static readonly HEARING_WINDOWS_DAYS = [7, 14, 30] as const;
  // Voice memo retention defaults.
  static readonly VOICE_MEMO_HOT_DAYS = 90;
  static readonly VOICE_MEMO_DELETE_DAYS = 365;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * PDPA-flag: contracts whose customer has received more than `threshold`
   * dunning actions (LINE/SMS/CALL) in the past 30 days.
   */
  async getDunningFrequency(thresholdOverride?: number): Promise<{
    threshold: number;
    rows: Array<{
      contractId: string;
      contractNumber: string | null;
      customerName: string | null;
      actionCount: number;
    }>;
  }> {
    const threshold = await this.resolveDunningThreshold(thresholdOverride);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const grouped = await this.prisma.dunningAction.groupBy({
      by: ['contractId'],
      where: {
        createdAt: { gte: since },
        deletedAt: null,
      },
      _count: { _all: true },
      having: { contractId: { _count: { gt: threshold } } },
      orderBy: { _count: { contractId: 'desc' } },
      take: 200,
    });

    const ids = grouped.map((g) => g.contractId);
    if (ids.length === 0) return { threshold, rows: [] };

    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: ids } },
      include: { customer: { select: { name: true, nickname: true } } },
    });
    const byId = new Map(contracts.map((c) => [c.id, c]));

    const rows = grouped.map((g) => {
      const c = byId.get(g.contractId);
      const fullName = c?.customer?.name ?? null;
      return {
        contractId: g.contractId,
        contractNumber: c?.contractNumber ?? null,
        customerName: fullName,
        actionCount: g._count._all,
      };
    });
    return { threshold, rows };
  }

  /**
   * LEGAL-status contracts whose LegalCase.hearingDate falls in the 7 / 14 / 30
   * day windows from now. Buckets are mutually exclusive (smaller bucket wins).
   */
  async getLegalPipeline(): Promise<{
    windows: Array<{ days: number; count: number }>;
    rows: Array<{
      contractId: string;
      contractNumber: string | null;
      caseNumber: string;
      court: string;
      hearingDate: string;
      daysUntil: number;
    }>;
  }> {
    const now = new Date();
    const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const cases = await this.prisma.legalCase.findMany({
      where: {
        deletedAt: null,
        hearingDate: { gte: now, lte: horizon },
      },
      select: {
        contractId: true,
        caseNumber: true,
        court: true,
        hearingDate: true,
        contract: { select: { contractNumber: true } },
      },
      orderBy: { hearingDate: 'asc' },
    });

    const rows = cases.map((c) => {
      const daysUntil = Math.ceil((c.hearingDate!.getTime() - now.getTime()) / 86400000);
      return {
        contractId: c.contractId,
        contractNumber: c.contract?.contractNumber ?? null,
        caseNumber: c.caseNumber,
        court: c.court,
        hearingDate: c.hearingDate!.toISOString(),
        daysUntil,
      };
    });

    const windows = ComplianceService.HEARING_WINDOWS_DAYS.map((days) => ({
      days,
      count: rows.filter((r) => r.daysUntil <= days && r.daysUntil >= 0).length,
    }));
    return { windows, rows };
  }

  /**
   * Aggregate audit log activity for the period (week | month).
   * Returns:
   *  - actionsByUser: top 20 users by audit-log count
   *  - actionsByType: counts per `entity` (contract/payment/etc.)
   *  - anomalies: cross-branch attempts (DENY_CROSS_BRANCH action) heuristic
   */
  async getAuditSummary(period: 'week' | 'month' = 'week'): Promise<{
    period: 'week' | 'month';
    since: string;
    actionsByUser: Array<{ userId: string; count: number }>;
    actionsByType: Array<{ entity: string; count: number }>;
    anomalyCount: number;
  }> {
    const days = period === 'month' ? 30 : 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [byUser, byType, anomalies] = await Promise.all([
      this.prisma.auditLog.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: since }, archivedAt: null },
        _count: { _all: true },
        orderBy: { _count: { userId: 'desc' } },
        take: 20,
      }),
      this.prisma.auditLog.groupBy({
        by: ['entity'],
        where: { createdAt: { gte: since }, archivedAt: null },
        _count: { _all: true },
        orderBy: { _count: { entity: 'desc' } },
        take: 50,
      }),
      this.prisma.auditLog.count({
        where: {
          createdAt: { gte: since },
          archivedAt: null,
          action: { contains: 'DENY' },
        },
      }),
    ]);

    return {
      period,
      since: since.toISOString(),
      actionsByUser: byUser.map((r) => ({ userId: r.userId, count: r._count._all })),
      actionsByType: byType.map((r) => ({ entity: r.entity, count: r._count._all })),
      anomalyCount: anomalies,
    };
  }

  /**
   * Voice memos eligible for Glacier transition (>= 90 days, still HOT) or
   * deletion (>= 365 days). Returns counts plus sample row IDs for audit.
   */
  async getVoiceMemoRetention(): Promise<{
    hotDays: number;
    deleteDays: number;
    eligibleForGlacier: { count: number; sample: string[] };
    eligibleForDelete: { count: number; sample: string[] };
  }> {
    const now = Date.now();
    const hotCutoff = new Date(now - ComplianceService.VOICE_MEMO_HOT_DAYS * 86400000);
    const deleteCutoff = new Date(now - ComplianceService.VOICE_MEMO_DELETE_DAYS * 86400000);

    const [glacierEligible, deleteEligible] = await Promise.all([
      this.prisma.callLog.findMany({
        where: {
          deletedAt: null,
          voiceMemoUrl: { not: null },
          voiceMemoTier: 'HOT',
          calledAt: { lte: hotCutoff, gt: deleteCutoff },
        },
        select: { id: true },
        take: 500,
      }),
      this.prisma.callLog.findMany({
        where: {
          deletedAt: null,
          voiceMemoUrl: { not: null },
          calledAt: { lte: deleteCutoff },
        },
        select: { id: true },
        take: 500,
      }),
    ]);

    return {
      hotDays: ComplianceService.VOICE_MEMO_HOT_DAYS,
      deleteDays: ComplianceService.VOICE_MEMO_DELETE_DAYS,
      eligibleForGlacier: {
        count: glacierEligible.length,
        sample: glacierEligible.slice(0, 10).map((r) => r.id),
      },
      eligibleForDelete: {
        count: deleteEligible.length,
        sample: deleteEligible.slice(0, 10).map((r) => r.id),
      },
    };
  }

  private async resolveDunningThreshold(override?: number): Promise<number> {
    if (override != null && Number.isFinite(override) && override > 0) return override;
    try {
      const row = await this.prisma.systemConfig.findUnique({
        where: { key: 'compliance_dunning_threshold' },
      });
      const parsed = row ? Number(row.value) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {
      // fall through to default
    }
    return ComplianceService.DEFAULT_DUNNING_THRESHOLD;
  }
}
