import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';

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

// ── Service ─────────────────────────────────────────────────────

@Injectable()
export class DataAuditService {
  private readonly logger = new Logger(DataAuditService.name);

  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // 12 Database Audit Checks
  // ═══════════════════════════════════════════════════════════════

  /** Check 1: Every POSTED JournalEntry must have SUM(debit) = SUM(credit) */
  async checkJournalBalance(): Promise<AuditCheckResult> {
    const unbalanced = await this.prisma.$queryRaw<
      { id: string; entry_number: string; reference_type: string; reference_id: string; total_debit: Prisma.Decimal; total_credit: Prisma.Decimal; diff: Prisma.Decimal }[]
    >`
      SELECT je.id, je.entry_number, je.reference_type, je.reference_id,
        SUM(jl.debit) as total_debit,
        SUM(jl.credit) as total_credit,
        ABS(SUM(jl.debit) - SUM(jl.credit)) as diff
      FROM journal_entries je
      JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.deleted_at IS NULL
      WHERE je.deleted_at IS NULL AND je.status = 'POSTED'
      GROUP BY je.id, je.entry_number, je.reference_type, je.reference_id
      HAVING ABS(SUM(jl.debit) - SUM(jl.credit)) > 0.01
      ORDER BY ABS(SUM(jl.debit) - SUM(jl.credit)) DESC
      LIMIT 50
    `;
    return {
      name: 'journal_balance',
      severity: 'CRITICAL',
      status: unbalanced.length === 0 ? 'PASS' : 'FAIL',
      count: unbalanced.length,
      details: unbalanced,
      executedAt: new Date(),
    };
  }

  /** Check 2: ACTIVE/OVERDUE/DEFAULT/COMPLETED contracts must have a CONTRACT journal */
  async checkOrphanContracts(): Promise<AuditCheckResult> {
    const orphans = await this.prisma.$queryRaw<
      { id: string; contract_number: string; status: string; created_at: Date }[]
    >`
      SELECT c.id, c.contract_number, c.status, c.created_at
      FROM contracts c
      WHERE c.deleted_at IS NULL
        AND c.status IN ('ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED')
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries je
          WHERE je.reference_id = c.id
            AND je.reference_type = 'CONTRACT'
            AND je.deleted_at IS NULL
            AND je.status = 'POSTED'
        )
      ORDER BY c.created_at DESC
      LIMIT 50
    `;
    return {
      name: 'orphan_contracts',
      severity: 'CRITICAL',
      status: orphans.length === 0 ? 'PASS' : 'FAIL',
      count: orphans.length,
      details: orphans,
      executedAt: new Date(),
    };
  }

  /** Check 3: PAID/PARTIALLY_PAID payments with amountPaid > 0 must have a PAYMENT journal */
  async checkOrphanPayments(): Promise<AuditCheckResult> {
    const orphans = await this.prisma.$queryRaw<
      { id: string; installment_no: number; amount_paid: Prisma.Decimal; status: string; paid_date: Date; contract_number: string }[]
    >`
      SELECT p.id, p.installment_no, p.amount_paid, p.status, p.paid_date,
             c.contract_number
      FROM payments p
      JOIN contracts c ON c.id = p.contract_id
      WHERE p.deleted_at IS NULL
        AND p.status IN ('PAID', 'PARTIALLY_PAID')
        AND p.amount_paid > 0
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries je
          WHERE je.reference_id = p.id
            AND je.reference_type = 'PAYMENT'
            AND je.deleted_at IS NULL
            AND je.status = 'POSTED'
        )
      ORDER BY p.paid_date DESC
      LIMIT 50
    `;
    return {
      name: 'orphan_payments',
      severity: 'CRITICAL',
      status: orphans.length === 0 ? 'PASS' : 'FAIL',
      count: orphans.length,
      details: orphans,
      executedAt: new Date(),
    };
  }

  /** Check 4: No contract should have total payments exceeding the total owed */
  async checkOverpaidContracts(): Promise<AuditCheckResult> {
    const overpaid = await this.prisma.$queryRaw<
      { id: string; contract_number: string; total_expected: Prisma.Decimal; total_paid: Prisma.Decimal; overpay: Prisma.Decimal }[]
    >`
      SELECT c.id, c.contract_number,
        (c.selling_price - c.down_payment + c.interest_total
         + COALESCE(c.store_commission, 0) + COALESCE(c.vat_amount, 0)) as total_expected,
        SUM(p.amount_paid) as total_paid,
        SUM(p.amount_paid) - (c.selling_price - c.down_payment + c.interest_total
         + COALESCE(c.store_commission, 0) + COALESCE(c.vat_amount, 0)) as overpay
      FROM contracts c
      JOIN payments p ON p.contract_id = c.id AND p.deleted_at IS NULL
      WHERE c.deleted_at IS NULL
      GROUP BY c.id, c.contract_number, c.selling_price, c.down_payment,
               c.interest_total, c.store_commission, c.vat_amount
      HAVING SUM(p.amount_paid) > (c.selling_price - c.down_payment + c.interest_total
         + COALESCE(c.store_commission, 0) + COALESCE(c.vat_amount, 0)) + 1.00
      ORDER BY overpay DESC
      LIMIT 50
    `;
    return {
      name: 'overpaid_contracts',
      severity: 'CRITICAL',
      status: overpaid.length === 0 ? 'PASS' : 'FAIL',
      count: overpaid.length,
      details: overpaid,
      executedAt: new Date(),
    };
  }

  /** Check 5: Products with status inconsistencies (e.g. IN_STOCK but has active contract) */
  async checkGhostStock(): Promise<AuditCheckResult> {
    const ghosts = await this.prisma.$queryRaw<
      { id: string; name: string; imei_serial: string; status: string; contract_number: string; contract_status: string }[]
    >`
      SELECT pr.id, pr.name, pr.imei_serial, pr.status,
             c.contract_number, c.status as contract_status
      FROM products pr
      JOIN contracts c ON c.product_id = pr.id AND c.deleted_at IS NULL
      WHERE pr.deleted_at IS NULL
        AND c.status IN ('ACTIVE', 'OVERDUE', 'DEFAULT')
        AND pr.status = 'IN_STOCK'
      LIMIT 50
    `;
    return {
      name: 'ghost_stock',
      severity: 'HIGH',
      status: ghosts.length === 0 ? 'PASS' : 'FAIL',
      count: ghosts.length,
      details: ghosts,
      executedAt: new Date(),
    };
  }

  /** Check 6: VAT Output from PAYMENT journals must match SUM(vatAmount) from payments */
  async checkVatMismatch(): Promise<AuditCheckResult> {
    const journalVat = await this.prisma.$queryRaw<[{ total: Prisma.Decimal }]>`
      SELECT COALESCE(SUM(jl.credit), 0) as total
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '21-2101'
        AND je.reference_type = 'PAYMENT'
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND jl.deleted_at IS NULL
    `;
    const paymentVat = await this.prisma.$queryRaw<[{ total: Prisma.Decimal }]>`
      SELECT COALESCE(SUM(p.vat_amount), 0) as total
      FROM payments p
      WHERE p.deleted_at IS NULL
        AND p.status IN ('PAID', 'PARTIALLY_PAID')
        AND p.amount_paid > 0
    `;
    const diff = Math.abs(Number(journalVat[0].total) - Number(paymentVat[0].total));
    return {
      name: 'vat_mismatch',
      severity: 'HIGH',
      status: diff < 1.0 ? 'PASS' : diff < 10.0 ? 'WARN' : 'FAIL',
      count: diff > 1.0 ? 1 : 0,
      details: [
        {
          journalVatTotal: journalVat[0].total,
          paymentVatTotal: paymentVat[0].total,
          diff,
        },
      ],
      executedAt: new Date(),
    };
  }

  /** Check 7: HP Receivable balance from journal must match outstanding from contracts */
  async checkHpReceivableReconciliation(): Promise<AuditCheckResult> {
    const journalBalance = await this.prisma.$queryRaw<[{ balance: Prisma.Decimal }]>`
      SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) as balance
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '11-2102'
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND jl.deleted_at IS NULL
    `;
    const contractOutstanding = await this.prisma.$queryRaw<[{ outstanding: Prisma.Decimal }]>`
      SELECT COALESCE(SUM(p.amount_due - p.amount_paid), 0) as outstanding
      FROM payments p
      JOIN contracts c ON c.id = p.contract_id
      WHERE p.deleted_at IS NULL
        AND c.deleted_at IS NULL
        AND c.status IN ('ACTIVE', 'OVERDUE', 'DEFAULT')
        AND p.status IN ('PENDING', 'PARTIALLY_PAID')
    `;
    const jBal = Number(journalBalance[0].balance);
    const cOut = Number(contractOutstanding[0].outstanding);
    const diff = Math.abs(jBal - cOut);
    const threshold = Math.max(cOut * 0.001, 100);
    return {
      name: 'hp_receivable_reconciliation',
      severity: 'HIGH',
      status: diff < threshold ? 'PASS' : 'FAIL',
      count: diff >= threshold ? 1 : 0,
      details: [
        {
          journalBalance: journalBalance[0].balance,
          contractOutstanding: contractOutstanding[0].outstanding,
          diff,
          threshold,
        },
      ],
      executedAt: new Date(),
    };
  }

  /** Check 8: Payments with late fee should not have VAT charged on the late fee portion */
  async checkLateFeeVatLeak(): Promise<AuditCheckResult> {
    const leaks = await this.prisma.$queryRaw<
      { payment_id: string; contract_number: string; installment_no: number; late_fee: Prisma.Decimal; payment_vat: Prisma.Decimal; journal_vat: Prisma.Decimal }[]
    >`
      SELECT p.id as payment_id, c.contract_number, p.installment_no,
        p.late_fee, p.vat_amount as payment_vat,
        (SELECT COALESCE(SUM(jl.credit), 0) FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE je.reference_id = p.id::text AND je.reference_type = 'PAYMENT'
         AND jl.account_code = '21-2101' AND je.deleted_at IS NULL AND jl.deleted_at IS NULL
         AND je.status = 'POSTED'
        ) as journal_vat
      FROM payments p
      JOIN contracts c ON c.id = p.contract_id
      WHERE p.deleted_at IS NULL
        AND p.late_fee > 0
        AND p.status IN ('PAID', 'PARTIALLY_PAID')
        AND p.amount_paid > 0
        AND ABS(
          COALESCE((SELECT SUM(jl2.credit) FROM journal_lines jl2
           JOIN journal_entries je2 ON je2.id = jl2.journal_entry_id
           WHERE je2.reference_id = p.id::text AND je2.reference_type = 'PAYMENT'
           AND jl2.account_code = '21-2101' AND je2.deleted_at IS NULL AND jl2.deleted_at IS NULL
           AND je2.status = 'POSTED'), 0)
          - COALESCE(p.vat_amount, 0)
        ) > 0.01
      LIMIT 50
    `;
    return {
      name: 'late_fee_vat_leak',
      severity: 'MEDIUM',
      status: leaks.length === 0 ? 'PASS' : 'FAIL',
      count: leaks.length,
      details: leaks,
      executedAt: new Date(),
    };
  }

  /** Check 9: Inter-company transaction totals between SHOP↔FINANCE */
  async checkInterCompanyBalance(): Promise<AuditCheckResult> {
    const balances = await this.prisma.$queryRaw<
      { from_entity: string; to_entity: string; total_flow: Prisma.Decimal; tx_count: bigint }[]
    >`
      SELECT from_entity, to_entity,
        SUM(total_amount) as total_flow,
        COUNT(*) as tx_count
      FROM inter_company_transactions
      WHERE status != 'CANCELLED'
        AND deleted_at IS NULL
      GROUP BY from_entity, to_entity
    `;
    return {
      name: 'inter_company_balance',
      severity: 'MEDIUM',
      status: 'PASS',
      count: 0,
      details: balances.map((b) => ({
        ...b,
        tx_count: Number(b.tx_count),
      })),
      executedAt: new Date(),
    };
  }

  /** Check 10: No duplicate gateway references (double-charge protection) */
  async checkDuplicatePayments(): Promise<AuditCheckResult> {
    const dupes = await this.prisma.$queryRaw<
      { gateway_ref: string; count: bigint; payment_ids: string[] }[]
    >`
      SELECT gateway_ref, COUNT(*) as count,
        ARRAY_AGG(id) as payment_ids
      FROM payments
      WHERE deleted_at IS NULL
        AND gateway_ref IS NOT NULL
        AND gateway_ref != ''
      GROUP BY gateway_ref
      HAVING COUNT(*) > 1
      LIMIT 50
    `;
    return {
      name: 'duplicate_payments',
      severity: 'HIGH',
      status: dupes.length === 0 ? 'PASS' : 'FAIL',
      count: dupes.length,
      details: dupes.map((d) => ({ ...d, count: Number(d.count) })),
      executedAt: new Date(),
    };
  }

  /** Check 11: Active contracts with costPrice > 0 must have a COGS journal */
  async checkMissingCogs(): Promise<AuditCheckResult> {
    const missing = await this.prisma.$queryRaw<
      { id: string; contract_number: string; product_name: string; cost_price: Prisma.Decimal }[]
    >`
      SELECT c.id, c.contract_number, pr.name as product_name, pr.cost_price
      FROM contracts c
      JOIN products pr ON pr.id = c.product_id
      WHERE c.deleted_at IS NULL
        AND c.status IN ('ACTIVE', 'COMPLETED', 'OVERDUE', 'DEFAULT')
        AND pr.cost_price > 0
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries je
          WHERE je.reference_id = c.id
            AND je.reference_type = 'CONTRACT_COGS'
            AND je.deleted_at IS NULL
            AND je.status = 'POSTED'
        )
      LIMIT 50
    `;
    return {
      name: 'missing_cogs',
      severity: 'MEDIUM',
      status: missing.length === 0 ? 'PASS' : 'FAIL',
      count: missing.length,
      details: missing,
      executedAt: new Date(),
    };
  }

  /** Check 12: Commission from journal must match SUM(monthlyCommission) from payments */
  async checkCommissionMismatch(): Promise<AuditCheckResult> {
    const mismatches = await this.prisma.$queryRaw<
      { id: string; contract_number: string; installment_no: number; payment_comm: Prisma.Decimal; journal_comm: Prisma.Decimal; diff: Prisma.Decimal }[]
    >`
      WITH journal_commission AS (
        SELECT je.reference_id as payment_id, SUM(jl.credit) as journal_comm
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE jl.account_code = '42-1105'
          AND je.reference_type = 'PAYMENT'
          AND je.status = 'POSTED'
          AND je.deleted_at IS NULL AND jl.deleted_at IS NULL
        GROUP BY je.reference_id
      )
      SELECT p.id, c.contract_number, p.installment_no,
        p.monthly_commission as payment_comm,
        jc.journal_comm,
        ABS(COALESCE(p.monthly_commission, 0) - COALESCE(jc.journal_comm, 0)) as diff
      FROM payments p
      JOIN contracts c ON c.id = p.contract_id
      LEFT JOIN journal_commission jc ON jc.payment_id = p.id::text
      WHERE p.deleted_at IS NULL
        AND p.status = 'PAID'
        AND ABS(COALESCE(p.monthly_commission, 0) - COALESCE(jc.journal_comm, 0)) > 0.01
      ORDER BY diff DESC
      LIMIT 50
    `;
    return {
      name: 'commission_mismatch',
      severity: 'MEDIUM',
      status: mismatches.length === 0 ? 'PASS' : 'FAIL',
      count: mismatches.length,
      details: mismatches,
      executedAt: new Date(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Run All Checks
  // ═══════════════════════════════════════════════════════════════

  async runAllChecks(): Promise<AuditCheckResult[]> {
    return Promise.all([
      this.checkJournalBalance(),
      this.checkOrphanContracts(),
      this.checkOrphanPayments(),
      this.checkOverpaidContracts(),
      this.checkGhostStock(),
      this.checkVatMismatch(),
      this.checkHpReceivableReconciliation(),
      this.checkLateFeeVatLeak(),
      this.checkInterCompanyBalance(),
      this.checkDuplicatePayments(),
      this.checkMissingCogs(),
      this.checkCommissionMismatch(),
    ]);
  }

  async runCheck(name: string): Promise<AuditCheckResult> {
    const checkMap: Record<string, () => Promise<AuditCheckResult>> = {
      journal_balance: () => this.checkJournalBalance(),
      orphan_contracts: () => this.checkOrphanContracts(),
      orphan_payments: () => this.checkOrphanPayments(),
      overpaid_contracts: () => this.checkOverpaidContracts(),
      ghost_stock: () => this.checkGhostStock(),
      vat_mismatch: () => this.checkVatMismatch(),
      hp_receivable_reconciliation: () => this.checkHpReceivableReconciliation(),
      late_fee_vat_leak: () => this.checkLateFeeVatLeak(),
      inter_company_balance: () => this.checkInterCompanyBalance(),
      duplicate_payments: () => this.checkDuplicatePayments(),
      missing_cogs: () => this.checkMissingCogs(),
      commission_mismatch: () => this.checkCommissionMismatch(),
    };
    const fn = checkMap[name];
    if (!fn) {
      throw new NotFoundException(`ไม่พบ audit check ชื่อ '${name}'`);
    }
    return fn();
  }

  // ═══════════════════════════════════════════════════════════════
  // Contract Lifecycle Trace (Phase 2)
  // ═══════════════════════════════════════════════════════════════

  async traceContract(contractId: string): Promise<ContractTraceResult> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
        product: {
          select: {
            id: true,
            name: true,
            costPrice: true,
            category: true,
            ownedByCompanyId: true,
          },
        },
        branch: { select: { id: true, name: true } },
      },
    });
    if (!contract) {
      throw new NotFoundException(`ไม่พบสัญญา ID: ${contractId}`);
    }

    // Load all journal entries for this contract (activation, COGS)
    const contractJournals = await this.prisma.journalEntry.findMany({
      where: { referenceId: contractId, deletedAt: null, status: 'POSTED' },
      include: { lines: { where: { deletedAt: null } } },
    });

    // Load payment journals
    const paymentIds = contract.payments.map((p) => p.id);
    const paymentJournals =
      paymentIds.length > 0
        ? await this.prisma.journalEntry.findMany({
            where: {
              referenceId: { in: paymentIds },
              referenceType: 'PAYMENT',
              deletedAt: null,
              status: 'POSTED',
            },
            include: { lines: { where: { deletedAt: null } } },
          })
        : [];

    // Load inter-company transaction
    const interCompany = await this.prisma.interCompanyTransaction.findFirst({
      where: { contractId, deletedAt: null },
    });

    // Run lifecycle checks
    const creation = this.traceCreation(contract);
    const activation = this.traceActivation(contract, contractJournals);
    const cogs = this.traceCogs(contract, contractJournals);
    const interCompanyCheck = this.traceInterCompany(contract, interCompany);
    const payments = contract.payments.map((p) => this.tracePayment(p, paymentJournals));
    const hpReceivable = this.traceHpBalance(contract, contractJournals, paymentJournals);
    const vatTotal = this.traceVatTotal(contract, paymentJournals);
    const commissionTotal = this.traceCommissionTotal(contract, paymentJournals);
    const completion = this.traceCompletion(contract);

    const allChecks = [creation, activation, cogs, interCompanyCheck, ...payments, hpReceivable, vatTotal, commissionTotal, completion];
    const passed = allChecks.filter((c) => c.status === 'PASS').length;
    const failed = allChecks.filter((c) => c.status === 'FAIL').length;
    const warnings = allChecks.filter((c) => c.status === 'WARN').length;

    return {
      contract: {
        id: contract.id,
        contractNumber: contract.contractNumber,
        status: contract.status,
      },
      checks: {
        creation,
        activation,
        cogs,
        interCompany: interCompanyCheck,
        payments,
        hpReceivable,
        vatTotal,
        commissionTotal,
        completion,
      },
      summary: {
        totalChecks: allChecks.length,
        passed,
        failed,
        warnings,
      },
    };
  }

  async traceAll(filters: { status?: string; limit?: number }): Promise<{
    total: number;
    checked: number;
    passed: number;
    failed: number;
    failures: ContractTraceResult[];
  }> {
    const statusFilter = filters.status
      ? { equals: filters.status as never }
      : { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] as never[] };

    const contracts = await this.prisma.contract.findMany({
      where: { deletedAt: null, status: statusFilter },
      select: { id: true },
      take: filters.limit || 100,
    });

    const failures: ContractTraceResult[] = [];
    for (const c of contracts) {
      const trace = await this.traceContract(c.id);
      if (trace.summary.failed > 0) {
        failures.push(trace);
      }
    }

    return {
      total: contracts.length,
      checked: contracts.length,
      passed: contracts.length - failures.length,
      failed: failures.length,
      failures,
    };
  }

  // ── Trace sub-checks ──────────────────────────────────────────

  private traceCreation(contract: { payments: unknown[]; status: string }): ContractTraceCheck {
    const hasSchedule = contract.payments.length > 0;
    const isPostDraft = contract.status !== 'DRAFT';
    if (!isPostDraft) {
      return { name: 'creation', status: 'PASS', details: 'Contract is DRAFT — no schedule expected yet' };
    }
    return {
      name: 'creation',
      status: hasSchedule ? 'PASS' : 'FAIL',
      details: hasSchedule
        ? { paymentCount: contract.payments.length }
        : 'ไม่พบตารางผ่อนชำระ (payment schedule)',
    };
  }

  private traceActivation(
    contract: { status: string },
    journals: { referenceType: string | null; lines: { debit: Prisma.Decimal; credit: Prisma.Decimal }[] }[],
  ): ContractTraceCheck {
    const activationStatuses = ['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF', 'CLOSED_BAD_DEBT'];
    if (!activationStatuses.includes(contract.status)) {
      return { name: 'activation', status: 'PASS', details: 'สัญญายังไม่ active — ไม่ต้องมี journal' };
    }

    const activationJournal = journals.find((j) => j.referenceType === 'CONTRACT');
    if (!activationJournal) {
      return { name: 'activation', status: 'FAIL', details: 'ไม่พบ journal entry สำหรับ CONTRACT activation' };
    }

    const totalDebit = activationJournal.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = activationJournal.lines.reduce((sum, l) => sum + Number(l.credit), 0);
    const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

    return {
      name: 'activation',
      status: balanced ? 'PASS' : 'FAIL',
      details: { totalDebit, totalCredit, balanced },
    };
  }

  private traceCogs(
    contract: { status: string; product: { costPrice: Prisma.Decimal } | null },
    journals: { referenceType: string | null; lines: { debit: Prisma.Decimal; credit: Prisma.Decimal }[] }[],
  ): ContractTraceCheck {
    const activationStatuses = ['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF', 'CLOSED_BAD_DEBT'];
    if (!activationStatuses.includes(contract.status)) {
      return { name: 'cogs', status: 'PASS', details: 'สัญญายังไม่ active' };
    }

    const costPrice = Number(contract.product?.costPrice ?? 0);
    if (costPrice <= 0) {
      return { name: 'cogs', status: 'PASS', details: 'costPrice = 0 — ไม่ต้องมี COGS journal' };
    }

    const cogsJournal = journals.find((j) => j.referenceType === 'CONTRACT_COGS');
    if (!cogsJournal) {
      return { name: 'cogs', status: 'FAIL', details: `costPrice = ${costPrice} แต่ไม่พบ COGS journal` };
    }

    const totalDebit = cogsJournal.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = cogsJournal.lines.reduce((sum, l) => sum + Number(l.credit), 0);
    const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

    return {
      name: 'cogs',
      status: balanced ? 'PASS' : 'FAIL',
      details: { costPrice, totalDebit, totalCredit, balanced },
    };
  }

  private traceInterCompany(
    contract: { status: string },
    interCompany: unknown | null,
  ): ContractTraceCheck {
    const activationStatuses = ['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF', 'CLOSED_BAD_DEBT'];
    if (!activationStatuses.includes(contract.status)) {
      return { name: 'interCompany', status: 'PASS', details: 'สัญญายังไม่ active' };
    }
    return {
      name: 'interCompany',
      status: interCompany ? 'PASS' : 'FAIL',
      details: interCompany ? 'InterCompanyTransaction found' : 'ไม่พบ InterCompanyTransaction',
    };
  }

  private tracePayment(
    payment: { id: string; installmentNo: number; status: string; amountPaid: Prisma.Decimal },
    paymentJournals: { referenceId: string | null; lines: { debit: Prisma.Decimal; credit: Prisma.Decimal }[] }[],
  ): ContractTraceCheck {
    if (payment.status === 'PENDING' || Number(payment.amountPaid) === 0) {
      return {
        name: `payment_${payment.installmentNo}`,
        status: 'PASS',
        details: 'ยังไม่ชำระ — ไม่ต้องมี journal',
      };
    }

    const journal = paymentJournals.find((j) => j.referenceId === payment.id);
    if (!journal) {
      return {
        name: `payment_${payment.installmentNo}`,
        status: 'FAIL',
        details: `งวดที่ ${payment.installmentNo} ชำระแล้ว (${payment.amountPaid}) แต่ไม่พบ journal`,
      };
    }

    const totalDebit = journal.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = journal.lines.reduce((sum, l) => sum + Number(l.credit), 0);
    const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

    return {
      name: `payment_${payment.installmentNo}`,
      status: balanced ? 'PASS' : 'FAIL',
      details: { installmentNo: payment.installmentNo, totalDebit, totalCredit, balanced },
    };
  }

  private traceHpBalance(
    contract: { status: string; payments: { status: string; amountDue: Prisma.Decimal; amountPaid: Prisma.Decimal }[] },
    contractJournals: { lines: { accountCode: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[] }[],
    paymentJournals: { lines: { accountCode: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[] }[],
  ): ContractTraceCheck {
    const activationStatuses = ['ACTIVE', 'OVERDUE', 'DEFAULT'];
    if (!activationStatuses.includes(contract.status)) {
      return { name: 'hpReceivable', status: 'PASS', details: `สถานะ ${contract.status} — ไม่ reconcile` };
    }

    // HP Receivable from journals (debit - credit for account 11-2102)
    const allLines = [...contractJournals, ...paymentJournals].flatMap((j) => j.lines);
    const hpLines = allLines.filter((l) => l.accountCode === '11-2102');
    const journalHp = hpLines.reduce((sum, l) => sum + Number(l.debit) - Number(l.credit), 0);

    // Outstanding from payments
    const outstanding = contract.payments
      .filter((p) => ['PENDING', 'PARTIALLY_PAID'].includes(p.status))
      .reduce((sum, p) => sum + Number(p.amountDue) - Number(p.amountPaid), 0);

    const diff = Math.abs(journalHp - outstanding);
    const threshold = Math.max(outstanding * 0.001, 10);

    return {
      name: 'hpReceivable',
      status: diff < threshold ? 'PASS' : 'FAIL',
      details: { journalHpReceivable: journalHp, contractOutstanding: outstanding, diff, threshold },
    };
  }

  private traceVatTotal(
    contract: { payments: { status: string; vatAmount: Prisma.Decimal | null }[] },
    paymentJournals: { lines: { accountCode: string; credit: Prisma.Decimal }[] }[],
  ): ContractTraceCheck {
    const paidPayments = contract.payments.filter((p) => ['PAID', 'PARTIALLY_PAID'].includes(p.status));
    const paymentVat = paidPayments.reduce((sum, p) => sum + Number(p.vatAmount ?? 0), 0);

    const journalVat = paymentJournals
      .flatMap((j) => j.lines)
      .filter((l) => l.accountCode === '21-2101')
      .reduce((sum, l) => sum + Number(l.credit), 0);

    const diff = Math.abs(paymentVat - journalVat);

    return {
      name: 'vatTotal',
      status: diff < 1.0 ? 'PASS' : 'FAIL',
      details: { paymentVatSum: paymentVat, journalVatSum: journalVat, diff },
    };
  }

  private traceCommissionTotal(
    contract: { payments: { status: string; monthlyCommission: Prisma.Decimal | null }[] },
    paymentJournals: { lines: { accountCode: string; credit: Prisma.Decimal }[] }[],
  ): ContractTraceCheck {
    const paidPayments = contract.payments.filter((p) => p.status === 'PAID');
    const paymentComm = paidPayments.reduce((sum, p) => sum + Number(p.monthlyCommission ?? 0), 0);

    const journalComm = paymentJournals
      .flatMap((j) => j.lines)
      .filter((l) => l.accountCode === '42-1105')
      .reduce((sum, l) => sum + Number(l.credit), 0);

    const diff = Math.abs(paymentComm - journalComm);

    return {
      name: 'commissionTotal',
      status: diff < 1.0 ? 'PASS' : 'FAIL',
      details: { paymentCommissionSum: paymentComm, journalCommissionSum: journalComm, diff },
    };
  }

  private traceCompletion(contract: {
    status: string;
    payments: { status: string }[];
    product: { ownedByCompanyId: string | null } | null;
  }): ContractTraceCheck {
    if (contract.status !== 'COMPLETED') {
      return { name: 'completion', status: 'PASS', details: `สถานะ ${contract.status} — ยังไม่ complete` };
    }

    const allPaid = contract.payments.every((p) => p.status === 'PAID');
    if (!allPaid) {
      const unpaidCount = contract.payments.filter((p) => p.status !== 'PAID').length;
      return {
        name: 'completion',
        status: 'FAIL',
        details: `สัญญา COMPLETED แต่ยังมี ${unpaidCount} งวดที่ยังไม่จ่ายครบ`,
      };
    }

    return {
      name: 'completion',
      status: 'PASS',
      details: 'ทุกงวดชำระครบ',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Daily Health Check Cron (Phase 3)
  // ═══════════════════════════════════════════════════════════════

  /** Runs every day at 06:00 AM (Bangkok time) */
  @Cron('0 6 * * *')
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
  // Backfill — create missing journals for legacy contracts
  // ═══════════════════════════════════════════════════════════════

  async backfillJournals(options: { dryRun: boolean; limit?: number }): Promise<{
    dryRun: boolean;
    contracts: { total: number; backfilled: number; skipped: number; errors: number };
    payments: { total: number; backfilled: number; skipped: number; errors: number };
    details: { contractNumber: string; action: string; status: string; error?: string }[];
  }> {
    const details: { contractNumber: string; action: string; status: string; error?: string }[] = [];
    const stats = {
      contracts: { total: 0, backfilled: 0, skipped: 0, errors: 0 },
      payments: { total: 0, backfilled: 0, skipped: 0, errors: 0 },
    };

    // Find OWNER user for createdById
    const systemUser = await this.prisma.user.findFirst({
      where: { role: 'OWNER', deletedAt: null },
      select: { id: true },
    });
    if (!systemUser) {
      throw new NotFoundException('ไม่พบผู้ใช้ OWNER สำหรับ backfill');
    }

    // 1. Find orphan contracts (any non-DRAFT status without CONTRACT journal)
    const orphanContracts = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id
      FROM contracts c
      WHERE c.deleted_at IS NULL
        AND c.status IN ('ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF', 'CLOSED_BAD_DEBT')
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries je
          WHERE je.reference_id = c.id
            AND je.reference_type = 'CONTRACT'
            AND je.deleted_at IS NULL
            AND je.status = 'POSTED'
        )
      ORDER BY c.created_at ASC
      LIMIT ${options.limit || 100}
    `;

    stats.contracts.total = orphanContracts.length;

    for (const { id: contractId } of orphanContracts) {
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        include: {
          product: { select: { costPrice: true, category: true } },
          payments: {
            where: {
              deletedAt: null,
              status: { in: ['PAID', 'PARTIALLY_PAID'] },
              amountPaid: { gt: 0 },
            },
            orderBy: { installmentNo: 'asc' },
          },
        },
      });
      if (!contract) {
        stats.contracts.skipped++;
        continue;
      }

      // Backfill contract activation journal
      if (options.dryRun) {
        details.push({
          contractNumber: contract.contractNumber,
          action: 'CREATE_CONTRACT_JOURNAL',
          status: 'DRY_RUN',
        });
        stats.contracts.backfilled++;
      } else {
        try {
          await this.prisma.$transaction(async (tx) => {
            await this.journalAutoService.createContractActivationJournal(tx, {
              contract: {
                id: contract.id,
                contractNumber: contract.contractNumber,
                sellingPrice: contract.sellingPrice,
                downPayment: contract.downPayment,
                financedAmount: contract.financedAmount,
                interestTotal: contract.interestTotal,
                storeCommission: contract.storeCommission ?? 0,
                vatAmount: contract.vatAmount ?? 0,
              },
              product: {
                costPrice: contract.product?.costPrice,
                category: contract.product?.category,
              },
              userId: systemUser.id,
            });
          });
          details.push({
            contractNumber: contract.contractNumber,
            action: 'CREATE_CONTRACT_JOURNAL',
            status: 'OK',
          });
          stats.contracts.backfilled++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          details.push({
            contractNumber: contract.contractNumber,
            action: 'CREATE_CONTRACT_JOURNAL',
            status: 'ERROR',
            error: message,
          });
          stats.contracts.errors++;
        }
      }

      // Backfill payment journals for this contract
      for (const payment of contract.payments) {
        // Check if payment journal already exists
        const existing = await this.prisma.journalEntry.findFirst({
          where: {
            referenceId: payment.id,
            referenceType: 'PAYMENT',
            deletedAt: null,
            status: 'POSTED',
          },
        });
        if (existing) {
          stats.payments.skipped++;
          continue;
        }

        stats.payments.total++;

        if (options.dryRun) {
          details.push({
            contractNumber: contract.contractNumber,
            action: `CREATE_PAYMENT_JOURNAL #${payment.installmentNo}`,
            status: 'DRY_RUN',
          });
          stats.payments.backfilled++;
        } else {
          try {
            await this.prisma.$transaction(async (tx) => {
              await this.journalAutoService.createPaymentJournal(tx, {
                payment: {
                  id: payment.id,
                  installmentNo: payment.installmentNo,
                  amountPaid: payment.amountPaid,
                  monthlyPrincipal: payment.monthlyPrincipal,
                  monthlyInterest: payment.monthlyInterest,
                  monthlyCommission: payment.monthlyCommission,
                  vatAmount: payment.vatAmount,
                  lateFee: payment.lateFee,
                  lateFeeWaived: payment.lateFeeWaived,
                  paidDate: payment.paidDate,
                },
                contract: {
                  contractNumber: contract.contractNumber,
                  branchId: contract.branchId,
                },
                userId: systemUser.id,
              });
            });
            details.push({
              contractNumber: contract.contractNumber,
              action: `CREATE_PAYMENT_JOURNAL #${payment.installmentNo}`,
              status: 'OK',
            });
            stats.payments.backfilled++;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            details.push({
              contractNumber: contract.contractNumber,
              action: `CREATE_PAYMENT_JOURNAL #${payment.installmentNo}`,
              status: 'ERROR',
              error: message,
            });
            stats.payments.errors++;
          }
        }
      }
    }

    return {
      dryRun: options.dryRun,
      contracts: stats.contracts,
      payments: stats.payments,
      details,
    };
  }
}
