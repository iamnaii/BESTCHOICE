import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { d, dAbs, dSub } from '../../../utils/decimal.util';
import { AuditCheckResult } from '../data-audit.types';

@Injectable()
export class DataAuditChecksService {
  constructor(private prisma: PrismaService) {}

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
          WHERE (je.reference_id = p.id::text OR je.metadata->>'paymentId' = p.id::text)
            AND je.reference_type = 'AUTO'
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
        AND je.reference_type = 'AUTO'
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
    const diff = dAbs(dSub(journalVat[0].total, paymentVat[0].total)).toNumber();
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
    const jBal = d(journalBalance[0].balance).toNumber();
    const cOut = d(contractOutstanding[0].outstanding).toNumber();
    const diff = dAbs(dSub(jBal, cOut)).toNumber();
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
         WHERE (je.reference_id = p.id::text OR je.metadata->>'paymentId' = p.id::text)
         AND je.reference_type = 'AUTO'
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
           WHERE (je2.reference_id = p.id::text OR je2.metadata->>'paymentId' = p.id::text)
           AND je2.reference_type = 'AUTO'
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
        SELECT COALESCE(je.metadata->>'paymentId', je.reference_id) as payment_id,
          SUM(jl.credit) as journal_comm
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE jl.account_code = '42-1105'
          AND je.reference_type = 'AUTO'
          AND je.status = 'POSTED'
          AND je.deleted_at IS NULL AND jl.deleted_at IS NULL
        GROUP BY COALESCE(je.metadata->>'paymentId', je.reference_id)
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
}
