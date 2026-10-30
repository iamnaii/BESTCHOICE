// ── Types ───────────────────────────────────────────────────────

export interface AuditCheckResult {
  name: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  /**
   * `SKIPPED` = the check's assertion no longer has a meaning in today's ledger model (dated reason in
   * `details`) — never a finding: not FAIL, no Sentry, no acknowledgement queue (2026-10-30 Task 18).
   */
  status: 'PASS' | 'FAIL' | 'WARN' | 'SKIPPED';
  count: number;
  details: unknown[];
  executedAt: Date;
}

export interface ContractTraceCheck {
  name: string;
  /** `SKIPPED` — same meaning as on `AuditCheckResult` (retired assertion, dated reason in `details`) */
  status: 'PASS' | 'FAIL' | 'WARN' | 'SKIPPED';
  details: unknown;
}

export interface ContractTraceResult {
  contract: {
    id: string;
    contractNumber: string;
    status: string;
  };
  checks: {
    creation: ContractTraceCheck;
    activation: ContractTraceCheck;
    cogs: ContractTraceCheck;
    interCompany: ContractTraceCheck;
    payments: ContractTraceCheck[];
    hpReceivable: ContractTraceCheck;
    vatTotal: ContractTraceCheck;
    commissionTotal: ContractTraceCheck;
    completion: ContractTraceCheck;
  };
  summary: {
    totalChecks: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
  };
}
