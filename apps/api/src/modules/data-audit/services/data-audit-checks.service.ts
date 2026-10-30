import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  LEGACY_OPENING_FLOW,
  LEGACY_PRIOR_RECEIPT_FLOW,
} from '../../accounting/peak-export-exclusion';
import { advanceVatOutstanding } from '../../journal/advance-vat';
import {
  CONTRACT_RECEIVABLE_TOLERANCE,
  contractScopeFilter,
  isReceivableGapBreached,
  loadContractReceivableGaps,
  receivableReconScopeSql,
  type ContractScope,
} from '../../journal/contract-receivable-recon';
import { loadLateFeePaidByPaymentIds } from '../../payments/services/payment-late-fee-paid.util';
import { AuditCheckResult } from '../data-audit.types';
import { LEGACY_UNTOUCHED_PAYMENT } from './legacy-untouched-payment';

/** รายการเปิดสัญญา 1A — `cpa-templates/contract-activation-1a.template.ts:71` */
const CONTRACT_ACTIVATION_TAG = '1A';
/** รายการเปิดสัญญาใหม่ของการเปลี่ยนเครื่อง A.1 — `cpa-templates/exchange-new-contract-1a.template.ts:68` */
const EXCHANGE_NEW_CONTRACT_FLOW = 'exchange-new-contract-1a';
/** ปิดยอดก่อนกำหนด JP4 (รายการระดับสัญญา ไม่มี `paymentId`) — `contracts/contract-payment.service.ts:842-843` */
const EARLY_PAYOFF_FLOW = 'early-payoff';
/** ส่วนที่แถวงวดรับเกินยอดเรียกเก็บได้ — เศษปัดของใบที่ปิดงวด ≤ 1 บาท (Tolerance Policy `.claude/rules/accounting.md`) */
const INSTALLMENT_OVERPAY_TOLERANCE = new Prisma.Decimal('1.00');
/** VAT รอเรียกเก็บสองขาต้องตรงกันทุกสตางค์ (ยอด 2 ตำแหน่ง) */
const VAT_DEFERRED_TOLERANCE = new Prisma.Decimal('0.01');
const DETAIL_LIMIT = 50;

const money = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v).toFixed(2);

/**
 * ตรวจข้อมูลกลางคืน 12 ข้อ (data-audit 06:00 — `DataAuditService.dailyHealthCheck`)
 *
 * **2026-10-30 (Task 16 — ก่อนนำเข้าสัญญาระบบเก่า 1 ธ.ค.) ความหมายของห้าข้อเปลี่ยน — ผลใน `data_audit_logs` ก่อนวันนี้เทียบกับหลัง
 * ไม่ได้** (ทุกข้อเดิมเตือนปลอมกับสัญญาปกติด้วย ไม่ใช่เฉพาะสัญญานำเข้า):
 * - `orphan_contracts` — เดิมหา `reference_type = 'CONTRACT'` ซึ่งไม่มีโค้ดใดเขียน (รายการอัตโนมัติทุกตัวเป็น `'AUTO'`) ⇒ หา 1A /
 *   เปิดสัญญาเปลี่ยนเครื่อง / รายการยกมาของสัญญานำเข้า ด้วย `metadata.contractId` · สัญญาประวัติที่นำเข้า (ไม่มีตารางงวด) ไม่ต้องมี
 * - `orphan_payments` — เพิ่มทางหนุนที่ไม่มี `paymentId`: รายการล้าง 11-2103 ของงวด (`installmentScheduleId` — ยกเว้น marker
 *   ยอดรับก่อนวันตัด) และ JP4 ของสัญญา ·
 *   งวดนำเข้าที่ยังไม่มีเส้นทางรับเงินแตะ (`LEGACY_UNTOUCHED_PAYMENT`) ไม่ต้องมีรายการบัญชี
 * - `overpaid_contracts` — เดิมเทียบ Σ `amountPaid` (รวมค่าปรับ) กับหัวสัญญา (ราคา − ดาวน์ … ซึ่งไม่เท่ายอดผ่อนของสัญญานำเข้า) ⇒
 *   เทียบต่อแถวงวด: `amountPaid − ค่าปรับที่รับจริง` ≤ `amountDue + 1.00`
 * - `vat_mismatch` — เดิมเทียบ 21-2101 (รับรู้ตอนตั้งลูกหนี้งวด) กับ VAT ของงวดที่จ่าย (คนละตัววัดตั้งแต่ Phase A.4) ⇒ เอกลักษณ์
 *   รายสัญญา `Dr 11-2105 − Cr 21-2102 = ภาษีของเงินรับล่วงหน้าที่ยังค้าง` ± 0.01
 * - `hp_receivable_reconciliation` — เดิมอ่าน 11-2102 (ค่าเผื่อหนี้สงสัยจะสูญ) และนับแค่ PENDING/PARTIALLY_PAID ⇒ กระทบยอดรายสัญญา
 *   (`journal/contract-receivable-recon.ts`) เกณฑ์ 1.00 บาทต่อสัญญา
 *
 * ห้าข้อนี้รับ `scope.contractIds` (ไม่ส่ง = ทุกสัญญา — cron เรียกแบบนี้) ให้เทสบนฐานที่มีแถวของเทสอื่นปน
 */
@Injectable()
export class DataAuditChecksService {
  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════
  // 12 Database Audit Checks
  // ═══════════════════════════════════════════════════════════════

  /** Check 1: Every POSTED JournalEntry must have SUM(debit) = SUM(credit) */
  async checkJournalBalance(): Promise<AuditCheckResult> {
    const unbalanced = await this.prisma.$queryRaw<
      {
        id: string;
        entry_number: string;
        reference_type: string;
        reference_id: string;
        total_debit: Prisma.Decimal;
        total_credit: Prisma.Decimal;
        diff: Prisma.Decimal;
      }[]
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

  /**
   * Check 2: ACTIVE/OVERDUE/DEFAULT/COMPLETED contracts must have their opening journal — 1A, the
   * exchange A.1 new-contract entry, or (imported legacy contracts) the legacy opening entry, all
   * keyed by `metadata.contractId`. Imported history contracts (legacy code + no schedule rows —
   * the importer books nothing for them by design) are exempt.
   */
  async checkOrphanContracts(scope?: ContractScope): Promise<AuditCheckResult> {
    const orphans = await this.prisma.$queryRaw<
      { id: string; contract_number: string; status: string; created_at: Date }[]
    >`
      SELECT c.id, c.contract_number, c.status, c.created_at
      FROM contracts c
      WHERE c.deleted_at IS NULL
        AND c.status IN ('ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED')
        ${contractScopeFilter('c.id', scope)}
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries je
          WHERE je.metadata->>'contractId' = c.id
            AND je.status = 'POSTED'
            AND je.deleted_at IS NULL
            AND (je.metadata->>'tag' = ${CONTRACT_ACTIVATION_TAG}
                 OR je.metadata->>'flow' IN (${EXCHANGE_NEW_CONTRACT_FLOW}, ${LEGACY_OPENING_FLOW}))
        )
        AND NOT (
          c.legacy_contract_code IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM installment_schedules s WHERE s.contract_id = c.id)
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

  /**
   * Check 3: PAID/PARTIALLY_PAID payments with amountPaid > 0 must be backed by a journal entry:
   *   (a) a receipt-style entry keyed by the payment (`referenceId` or `metadata.paymentId`), or
   *   (b) an entry that credits 11-2103 for the installment's schedule row without a paymentId
   *       (nightly advance / park consumption, 6a/6b) — not the legacy prior-receipt marker, or
   *   (c) the contract's early payoff (JP4 is one contract-level entry for every row it pays).
   * Imported rows still untouched since the cutover (`LEGACY_UNTOUCHED_PAYMENT`) are exempt — their
   * money was booked in PEAK. Set-based (anti-joins) so the nightly run does not rescan the journal
   * per payment row.
   */
  async checkOrphanPayments(scope?: ContractScope): Promise<AuditCheckResult> {
    const orphans = await this.prisma.$queryRaw<
      {
        id: string;
        installment_no: number;
        amount_paid: Prisma.Decimal;
        status: string;
        paid_date: Date;
        contract_number: string;
      }[]
    >`
      -- (a) and (b) deliberately count originals stamped metadata.reversed = true (receipt entries
      -- carry both paymentId and installmentScheduleId, so each path sees them): after a receipt void
      -- the row keeps the voided receipt's payment_method / recorded_by (so an imported row is no
      -- longer "untouched" (d)) while amount_paid falls back to the pre-cutover amount — the reversed
      -- original is its only backing. Do NOT "tighten" either path by dropping reversed originals:
      -- every imported row with a voided post-cutover receipt would turn CRITICAL nightly (spec L9B).
      WITH backed_payment AS (
        SELECT je.reference_id AS id FROM journal_entries je
        WHERE je.reference_type = 'AUTO' AND je.status = 'POSTED' AND je.deleted_at IS NULL
          AND je.reference_id IS NOT NULL
        UNION
        SELECT je.metadata->>'paymentId' FROM journal_entries je
        WHERE je.reference_type = 'AUTO' AND je.status = 'POSTED' AND je.deleted_at IS NULL
          AND je.metadata->>'paymentId' IS NOT NULL
      ),
      backed_schedule AS (
        SELECT DISTINCT je.metadata->>'installmentScheduleId' AS id
        FROM journal_entries je
        JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.deleted_at IS NULL
        WHERE je.status = 'POSTED' AND je.deleted_at IS NULL
          AND je.metadata->>'installmentScheduleId' IS NOT NULL
          AND jl.account_code = '11-2103' AND jl.credit > 0
          -- the legacy marker backs only the pre-cutover part, which (d) already exempts — once a
          -- receipt touches the row it needs its own entry, so the marker must not excuse it
          AND COALESCE(je.metadata->>'flow', '') <> ${LEGACY_PRIOR_RECEIPT_FLOW}
      ),
      early_payoff_contract AS (
        SELECT DISTINCT je.metadata->>'contractId' AS id FROM journal_entries je
        WHERE je.status = 'POSTED' AND je.deleted_at IS NULL
          AND je.metadata->>'flow' = ${EARLY_PAYOFF_FLOW}
      )
      SELECT p.id, p.installment_no, p.amount_paid, p.status, p.paid_date,
             c.contract_number
      FROM payments p
      JOIN contracts c ON c.id = p.contract_id
      LEFT JOIN installment_schedules s
        ON s.contract_id = p.contract_id AND s.installment_no = p.installment_no
      WHERE p.deleted_at IS NULL
        AND p.status IN ('PAID', 'PARTIALLY_PAID')
        AND p.amount_paid > 0
        ${contractScopeFilter('p.contract_id', scope)}
        AND NOT EXISTS (SELECT 1 FROM backed_payment b WHERE b.id = p.id)
        AND NOT EXISTS (SELECT 1 FROM backed_schedule b WHERE b.id = s.id)
        AND NOT EXISTS (SELECT 1 FROM early_payoff_contract b WHERE b.id = p.contract_id)
        AND NOT ${LEGACY_UNTOUCHED_PAYMENT}
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

  /**
   * Check 4: no installment row may be paid beyond its billing — `amountPaid` minus the late fee
   * actually received (it rides in `amountPaid`; read from the ledger with the same reader the
   * receipt paths use) must not exceed `amountDue` by more than the ≤1 THB closing tolerance.
   * On a row JP4 paid the row's charged late fee counts as received (JP4 books the fee on its
   * contract-level entry) — only that row: a row already PAID before the payoff gets no allowance.
   * Reported per contract. Imported rows untouched since the cutover are exempt (closed legacy data).
   */
  async checkOverpaidContracts(scope?: ContractScope): Promise<AuditCheckResult> {
    const candidates = await this.prisma.$queryRaw<
      {
        payment_id: string;
        contract_id: string;
        contract_number: string;
        installment_no: number;
        amount_due: Prisma.Decimal;
        amount_paid: Prisma.Decimal;
        late_fee: Prisma.Decimal;
        late_fee_waived: boolean;
        early_payoff: boolean;
      }[]
    >`
      SELECT p.id AS payment_id, c.id AS contract_id, c.contract_number, p.installment_no,
             p.amount_due, p.amount_paid, p.late_fee, p.late_fee_waived,
             -- Rows this JP4 paid: ContractPaymentService.earlyPayoff stamps Payment.paidDate and the JP4
             -- postedAt from one paidDate value (both timestamp(3)), but receipts entered the same day carry
             -- the same UTC-midnight date, so the stamped range of the rows it closed (unpaid at payoff,
             -- ascending) must hold too. JP4 entries without the range (before 2026-10-18) fall back to the date.
             EXISTS (
               SELECT 1 FROM journal_entries je
               WHERE je.metadata->>'contractId' = p.contract_id
                 AND je.metadata->>'flow' = ${EARLY_PAYOFF_FLOW}
                 AND je.status = 'POSTED' AND je.deleted_at IS NULL
                 AND je.posted_at = p.paid_date
                 AND (
                   je.metadata->>'firstUnpaidInstallmentNo' IS NULL
                   OR p.installment_no BETWEEN (je.metadata->>'firstUnpaidInstallmentNo')::int
                                           AND (je.metadata->>'lastUnpaidInstallmentNo')::int
                 )
             ) AS early_payoff
      FROM payments p
      JOIN contracts c ON c.id = p.contract_id
      WHERE p.deleted_at IS NULL
        AND c.deleted_at IS NULL
        AND p.amount_paid > p.amount_due + ${INSTALLMENT_OVERPAY_TOLERANCE}
        ${contractScopeFilter('p.contract_id', scope)}
        AND NOT ${LEGACY_UNTOUCHED_PAYMENT}
      ORDER BY c.contract_number, p.installment_no
    `;
    const fees =
      candidates.length > 0
        ? await loadLateFeePaidByPaymentIds(
            this.prisma,
            candidates.map((r) => r.payment_id),
          )
        : new Map<string, Prisma.Decimal>();
    const byContract = new Map<
      string,
      { id: string; contract_number: string; installment_nos: number[]; overpay: Prisma.Decimal }
    >();
    for (const r of candidates) {
      const receiptFee = new Prisma.Decimal(fees.get(r.payment_id) ?? 0);
      // JP4 (early payoff) spreads the payoff FIFO with owed = amountDue + lateFee − amountPaid, so the
      // fee lands in amountPaid while its Cr 42-1103 sits on the contract-level JP4 entry (no paymentId —
      // invisible to the receipt reader). The fee stops accruing once money comes in, so earlier receipts
      // of the row are a subset of late_fee ⇒ allow the full charged fee on a row that JP4 paid.
      const fee =
        r.early_payoff && !r.late_fee_waived
          ? Prisma.Decimal.max(receiptFee, r.late_fee)
          : receiptFee;
      const over = new Prisma.Decimal(r.amount_paid).minus(fee).minus(r.amount_due);
      if (!over.gt(INSTALLMENT_OVERPAY_TOLERANCE)) continue;
      const row = byContract.get(r.contract_id) ?? {
        id: r.contract_id,
        contract_number: r.contract_number,
        installment_nos: [],
        overpay: new Prisma.Decimal(0),
      };
      row.installment_nos.push(r.installment_no);
      row.overpay = row.overpay.plus(over);
      byContract.set(r.contract_id, row);
    }
    const overpaid = [...byContract.values()]
      .sort((a, b) => b.overpay.comparedTo(a.overpay))
      .slice(0, DETAIL_LIMIT)
      .map((r) => ({ ...r, overpay: money(r.overpay) }));
    return {
      name: 'overpaid_contracts',
      severity: 'CRITICAL',
      status: byContract.size === 0 ? 'PASS' : 'FAIL',
      count: byContract.size,
      details: overpaid,
      executedAt: new Date(),
    };
  }

  /** Check 5: Products with status inconsistencies (e.g. IN_STOCK but has active contract) */
  async checkGhostStock(): Promise<AuditCheckResult> {
    const ghosts = await this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        imei_serial: string;
        status: string;
        contract_number: string;
        contract_status: string;
      }[]
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

  /**
   * Check 6: per contract (same scope as the receivable recon), the deferred output VAT must
   * mirror the VAT receivable — `Dr 11-2105 − Cr 21-2102 = advanceVatOutstanding` (±0.01).
   * 1A books both legs equal, every 2A / its reversal moves both by the same VAT, the legacy
   * opening + VAT catch-up leave them equal, and the only intended gap is the VAT of customer
   * advances recognized at receipt (`advance-vat.ts` — read with that module's own reader).
   * Catches one-legged VAT movements and a lost legacy VAT catch-up (VAT that would never reach
   * ภ.พ.30).
   */
  async checkVatMismatch(scope?: ContractScope): Promise<AuditCheckResult> {
    const candidates = await this.prisma.$queryRaw<
      {
        contract_id: string;
        contract_number: string;
        vat_receivable: Prisma.Decimal;
        vat_deferred: Prisma.Decimal;
      }[]
    >`
      WITH scope AS (${receivableReconScopeSql(scope)}),
      bal AS (
        SELECT je.metadata->>'contractId' AS contract_id,
          COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE jl.account_code = '11-2105'), 0) AS vat_receivable,
          COALESCE(SUM(jl.credit - jl.debit) FILTER (WHERE jl.account_code = '21-2102'), 0) AS vat_deferred
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE je.status = 'POSTED'
          AND je.deleted_at IS NULL
          AND jl.deleted_at IS NULL
          AND jl.account_code IN ('11-2105', '21-2102')
          AND je.metadata->>'contractId' IN (SELECT id FROM scope)
        GROUP BY je.metadata->>'contractId'
      ),
      advance_vat AS (
        SELECT DISTINCT je.metadata->>'contractId' AS contract_id
        FROM journal_entries je
        WHERE je.status = 'POSTED'
          AND je.deleted_at IS NULL
          AND (je.metadata->>'advanceVatPark' IS NOT NULL OR je.metadata->>'advanceVatConsume' IS NOT NULL)
          AND je.metadata->>'contractId' IN (SELECT id FROM scope)
      )
      SELECT s.id AS contract_id, s.contract_number,
        COALESCE(b.vat_receivable, 0) AS vat_receivable,
        COALESCE(b.vat_deferred, 0) AS vat_deferred
      FROM scope s
      LEFT JOIN bal b ON b.contract_id = s.id
      WHERE ABS(COALESCE(b.vat_receivable, 0) - COALESCE(b.vat_deferred, 0)) > ${VAT_DEFERRED_TOLERANCE}
         OR EXISTS (SELECT 1 FROM advance_vat a WHERE a.contract_id = s.id)
      ORDER BY s.contract_number
    `;
    const mismatches: {
      contractId: string;
      contractNumber: string;
      vatReceivable: string;
      vatDeferred: string;
      advanceVatOutstanding: string;
      diff: string;
    }[] = [];
    for (const r of candidates) {
      const advance = await advanceVatOutstanding(this.prisma, r.contract_id);
      const diff = new Prisma.Decimal(r.vat_receivable).minus(r.vat_deferred).minus(advance);
      if (!diff.abs().gt(VAT_DEFERRED_TOLERANCE)) continue;
      mismatches.push({
        contractId: r.contract_id,
        contractNumber: r.contract_number,
        vatReceivable: money(r.vat_receivable),
        vatDeferred: money(r.vat_deferred),
        advanceVatOutstanding: money(advance),
        diff: money(diff),
      });
    }
    return {
      name: 'vat_mismatch',
      severity: 'HIGH',
      status: mismatches.length === 0 ? 'PASS' : 'FAIL',
      count: mismatches.length,
      details: mismatches.slice(0, DETAIL_LIMIT),
      executedAt: new Date(),
    };
  }

  /**
   * Check 7: per-contract HP receivable reconciliation — ledger receivable (11-2101 + 11-2103 +
   * 11-2105 by `metadata.contractId`) vs the installment register, ≤ 1.00 THB per contract
   * (`journal/contract-receivable-recon.ts` — the same calculator as the 02:00 receivable recon).
   */
  async checkHpReceivableReconciliation(scope?: ContractScope): Promise<AuditCheckResult> {
    const rows = await loadContractReceivableGaps(this.prisma, scope);
    const zero = new Prisma.Decimal(0);
    const glReceivable = rows.reduce((s, r) => s.plus(r.glReceivable), zero);
    const registerOutstanding = rows.reduce((s, r) => s.plus(r.registerOutstanding), zero);
    const breaches = rows
      .filter(isReceivableGapBreached)
      .sort((a, b) => b.gap.abs().comparedTo(a.gap.abs()));
    return {
      name: 'hp_receivable_reconciliation',
      severity: 'HIGH',
      status: breaches.length === 0 ? 'PASS' : 'FAIL',
      count: breaches.length,
      details: [
        {
          contractsChecked: rows.length,
          glReceivable: money(glReceivable),
          registerOutstanding: money(registerOutstanding),
          gap: money(glReceivable.minus(registerOutstanding)),
          tolerancePerContract: money(CONTRACT_RECEIVABLE_TOLERANCE),
          breaches: breaches.slice(0, DETAIL_LIMIT).map((r) => ({
            contractId: r.contractId,
            contractNumber: r.contractNumber,
            branchId: r.branchId,
            glReceivable: money(r.glReceivable),
            registerOutstanding: money(r.registerOutstanding),
            gap: money(r.gap),
          })),
        },
      ],
      executedAt: new Date(),
    };
  }

  /** Check 8: Payments with late fee should not have VAT charged on the late fee portion */
  async checkLateFeeVatLeak(): Promise<AuditCheckResult> {
    const leaks = await this.prisma.$queryRaw<
      {
        payment_id: string;
        contract_number: string;
        installment_no: number;
        late_fee: Prisma.Decimal;
        payment_vat: Prisma.Decimal;
        journal_vat: Prisma.Decimal;
      }[]
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
      {
        id: string;
        contract_number: string;
        installment_no: number;
        payment_comm: Prisma.Decimal;
        journal_comm: Prisma.Decimal;
        diff: Prisma.Decimal;
      }[]
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
