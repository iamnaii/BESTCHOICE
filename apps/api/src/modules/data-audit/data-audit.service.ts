import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { DataAuditChecksService } from './services/data-audit-checks.service';
import { ContractTraceService } from './services/contract-trace.service';
import { AuditFindingsService } from './services/audit-findings.service';
import { AuditBackfillService } from './services/audit-backfill.service';
import { AuditCheckResult, ContractTraceResult } from './data-audit.types';

// Re-export shared types so existing importers of this module keep working.
export { AuditCheckResult, ContractTraceCheck, ContractTraceResult } from './data-audit.types';

// ── Service ─────────────────────────────────────────────────────

/**
 * Facade over the data-audit slice. Keeps the 24-method public surface the
 * controller depends on + both @Cron decorators (cron registration must stay
 * on the DI-token provider) and delegates the bodies to four sub-services:
 *   - DataAuditChecksService — the 12 invariant checks + runAllChecks/runCheck
 *   - ContractTraceService   — traceContract/traceAll + the 9 trace helpers
 *   - AuditFindingsService   — history/findings/acknowledge/SLA
 *   - AuditBackfillService   — backfillJournals (dry-run stubs)
 */
@Injectable()
export class DataAuditService {
  private readonly logger = new Logger(DataAuditService.name);

  constructor(
    private prisma: PrismaService,
    private checks: DataAuditChecksService,
    private trace: ContractTraceService,
    private findings: AuditFindingsService,
    private backfill: AuditBackfillService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // 12 Database Audit Checks (→ DataAuditChecksService)
  // ═══════════════════════════════════════════════════════════════

  /** Check 1: Every POSTED JournalEntry must have SUM(debit) = SUM(credit) */
  async checkJournalBalance(): Promise<AuditCheckResult> {
    return this.checks.checkJournalBalance();
  }

  /** Check 2: ACTIVE/OVERDUE/DEFAULT/COMPLETED contracts must have a CONTRACT journal */
  async checkOrphanContracts(): Promise<AuditCheckResult> {
    return this.checks.checkOrphanContracts();
  }

  /** Check 3: PAID/PARTIALLY_PAID payments with amountPaid > 0 must have a PAYMENT journal */
  async checkOrphanPayments(): Promise<AuditCheckResult> {
    return this.checks.checkOrphanPayments();
  }

  /** Check 4: No contract should have total payments exceeding the total owed */
  async checkOverpaidContracts(): Promise<AuditCheckResult> {
    return this.checks.checkOverpaidContracts();
  }

  /** Check 5: Products with status inconsistencies (e.g. IN_STOCK but has active contract) */
  async checkGhostStock(): Promise<AuditCheckResult> {
    return this.checks.checkGhostStock();
  }

  /** Check 6: VAT Output from PAYMENT journals must match SUM(vatAmount) from payments */
  async checkVatMismatch(): Promise<AuditCheckResult> {
    return this.checks.checkVatMismatch();
  }

  /** Check 7: HP Receivable balance from journal must match outstanding from contracts */
  async checkHpReceivableReconciliation(): Promise<AuditCheckResult> {
    return this.checks.checkHpReceivableReconciliation();
  }

  /** Check 8: Payments with late fee should not have VAT charged on the late fee portion */
  async checkLateFeeVatLeak(): Promise<AuditCheckResult> {
    return this.checks.checkLateFeeVatLeak();
  }

  /** Check 9: Inter-company transaction totals between SHOP↔FINANCE */
  async checkInterCompanyBalance(): Promise<AuditCheckResult> {
    return this.checks.checkInterCompanyBalance();
  }

  /** Check 10: No duplicate gateway references (double-charge protection) */
  async checkDuplicatePayments(): Promise<AuditCheckResult> {
    return this.checks.checkDuplicatePayments();
  }

  /** Check 11: Active contracts with costPrice > 0 must have a COGS journal */
  async checkMissingCogs(): Promise<AuditCheckResult> {
    return this.checks.checkMissingCogs();
  }

  /** Check 12: Commission from journal must match SUM(monthlyCommission) from payments */
  async checkCommissionMismatch(): Promise<AuditCheckResult> {
    return this.checks.checkCommissionMismatch();
  }

  // ═══════════════════════════════════════════════════════════════
  // Run All Checks (→ DataAuditChecksService)
  // ═══════════════════════════════════════════════════════════════

  async runAllChecks(): Promise<AuditCheckResult[]> {
    return this.checks.runAllChecks();
  }

  async runCheck(name: string): Promise<AuditCheckResult> {
    return this.checks.runCheck(name);
  }

  // ═══════════════════════════════════════════════════════════════
  // Contract Lifecycle Trace (Phase 2) (→ ContractTraceService)
  // ═══════════════════════════════════════════════════════════════

  async traceContract(contractId: string): Promise<ContractTraceResult> {
    return this.trace.traceContract(contractId);
  }

  async traceAll(filters: { status?: string; limit?: number }): Promise<{
    total: number;
    checked: number;
    passed: number;
    failed: number;
    failures: ContractTraceResult[];
  }> {
    return this.trace.traceAll(filters);
  }

  // ═══════════════════════════════════════════════════════════════
  // Daily Health Check Cron (Phase 3)
  // ═══════════════════════════════════════════════════════════════

  /** Runs every day at 06:00 AM (Bangkok time) */
  @Cron('0 6 * * *', { timeZone: 'Asia/Bangkok' })
  async dailyHealthCheck() {
    this.logger.log('Starting daily data audit health check...');
    try {
      const runId = randomUUID();
      const results = await this.runAllChecks();

      // Persist results
      await this.prisma.dataAuditLog.createMany({
        data: results.map((r) => ({
          runId,
          checkName: r.name,
          severity: r.severity,
          status: r.status,
          count: r.count,
          details: r.details as Prisma.InputJsonValue,
        })),
      });

      // Alert on CRITICAL/HIGH failures
      const criticals = results.filter(
        (r) => r.status === 'FAIL' && ['CRITICAL', 'HIGH'].includes(r.severity),
      );
      if (criticals.length > 0) {
        const summary = criticals.map((c) => `${c.name}: ${c.count} issues`).join(', ');
        Sentry.captureMessage(`Data audit FAILED: ${summary}`, {
          level: 'error',
          tags: { kind: 'data-audit' },
          extra: { runId, criticals },
        });
      }

      this.logger.log(
        `Data audit complete: ${results.filter((r) => r.status === 'PASS').length}/${results.length} passed (runId: ${runId})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Daily health check failed: ${message}`);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'data-audit' },
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // History (→ AuditFindingsService)
  // ═══════════════════════════════════════════════════════════════

  async getHistory(filters: { checkName?: string; limit?: number }) {
    return this.findings.getHistory(filters);
  }

  // ═══════════════════════════════════════════════════════════════
  // T2-C7: Acknowledgement workflow for failed checks (→ AuditFindingsService)
  // ═══════════════════════════════════════════════════════════════

  /**
   * List unacknowledged FAIL findings from the last 30 days.
   * Default filter: severity in [CRITICAL, HIGH]. Sorting puts oldest on top
   * so the SLA clock (24h) is obvious in the UI.
   */
  async getUnacknowledgedFindings(severity?: string) {
    return this.findings.getUnacknowledgedFindings(severity);
  }

  async acknowledgeFinding(findingId: string, userId: string, notes?: string) {
    return this.findings.acknowledgeFinding(findingId, userId, notes);
  }

  /**
   * Escalation check — called hourly. Emits Sentry error for any
   * CRITICAL/HIGH finding that has been unacknowledged for >24h.
   */
  async scanForSlaBreaches(): Promise<{ breached: number }> {
    return this.findings.scanForSlaBreaches();
  }

  @Cron('20 * * * *', { timeZone: 'Asia/Bangkok' })
  async hourlySlaCheck(): Promise<void> {
    try {
      await this.scanForSlaBreaches();
    } catch (err) {
      this.logger.error(
        `Data audit SLA cron failed: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'data-audit-sla' },
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Backfill — create missing journals for legacy contracts (→ AuditBackfillService)
  // ═══════════════════════════════════════════════════════════════

  async backfillJournals(options: { dryRun: boolean; limit?: number }): Promise<{
    dryRun: boolean;
    contracts: { total: number; backfilled: number; skipped: number; errors: number };
    payments: { total: number; backfilled: number; skipped: number; errors: number };
    details: { contractNumber: string; action: string; status: string; error?: string }[];
  }> {
    return this.backfill.backfillJournals(options);
  }
}
