// ── Types ───────────────────────────────────────────────────────

export interface AuditCheckResult {
  name: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  status: 'PASS' | 'FAIL' | 'WARN';
  count: number;
  details: unknown[];
  executedAt: Date;
}

export interface ContractTraceCheck {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
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
  };
}
