import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  RECEIVABLE_RECON_CONTRACT_STATUSES,
  type ContractScope,
} from '../../journal/contract-receivable-recon';
import { ContractTraceCheck, ContractTraceResult } from '../data-audit.types';
import {
  DataAuditChecksService,
  isContractOpeningEntry,
  SHOP_INVENTORY_TRANSFER_COGS_FLOW,
  SHOP_INVENTORY_TRANSFER_REVENUE_FLOW,
} from './data-audit-checks.service';

/** สถานะที่ผ่านการเปิดสัญญาแล้ว (ต้องมีรายการเปิดสัญญาและขา SHOP ของการเปิดสัญญา) */
const ACTIVATED_STATUSES = [
  'ACTIVE',
  'OVERDUE',
  'DEFAULT',
  'COMPLETED',
  'EARLY_PAYOFF',
  'CLOSED_BAD_DEBT',
];
const SHOP_FINANCE_RECEIVABLE_ACCOUNTS = ['S11-3001', 'S11-3002'];
/** สัญญาที่เปิดก่อนต่อขา SHOP — `DataAuditChecksService.preShopWiringContractIds` */
const PRE_SHOP_WIRING_DETAIL =
  'สัญญาที่เปิดก่อนต่อขา SHOP (2026-06-23 · legacyNoShop) — สมุด SHOP ไม่มีขาของการเปิดสัญญาโดยชอบ';

type TraceLine = { accountCode: string; debit: Prisma.Decimal; credit: Prisma.Decimal };
type TraceJournal = {
  referenceId?: string | null;
  metadata?: Prisma.JsonValue;
  lines: TraceLine[];
};

const money = (v: Prisma.Decimal) => v.toFixed(2);
const zero = () => new Prisma.Decimal(0);
const flowOf = (j: TraceJournal) =>
  j.metadata && typeof j.metadata === 'object' && !Array.isArray(j.metadata)
    ? (j.metadata as Prisma.JsonObject).flow
    : undefined;
const balanceOf = (lines: TraceLine[]) => {
  const totalDebit = lines.reduce((s, l) => s.plus(l.debit), zero());
  const totalCredit = lines.reduce((s, l) => s.plus(l.credit), zero());
  return {
    totalDebit: money(totalDebit),
    totalCredit: money(totalCredit),
    balanced: totalDebit.minus(totalCredit).abs().lt('0.01'),
  };
};

/**
 * ไล่ตรวจสัญญาทีละสัญญา (`GET /data-audit/trace-contract/:id` · `trace-all`) — ไม่มีหน้าเว็บเรียก (e2e smoke บันทึกผลอย่างเดียว)
 *
 * **2026-10-30 (Task 18):** อ่านตามแบบบัญชีปัจจุบัน (Phase A.4) และใช้ตัวตรวจกลางคืนตัวเดียวกันที่ scope ไว้ที่สัญญานี้ — ไม่มีสูตรที่สอง:
 * - รายการของสัญญา = `metadata.contractId` (เดิมหา `referenceId` + `reference_type 'CONTRACT' / 'CONTRACT_COGS'` ที่ไม่มีผู้เขียน)
 * - เปิดสัญญา = 1A / A.1 / ยอดยกมาของสัญญานำเข้า (`isContractOpeningEntry`) · สัญญาประวัติที่นำเข้า (ไม่มีตารางงวด) ไม่ต้องมี
 * - ต้นทุนขาย / ระหว่างกิจการ = ขา SHOP ของการเปิดสัญญา (`ShopInventoryTransferTemplate` JE A / JE B) — เดิมอ่าน
 *   `InterCompanyTransaction` ซึ่งเขียนเฉพาะจาก `POST /inter-company` ด้วยมือ (ไม่มีเส้นทางเปิดสัญญาเขียน) · สัญญานำเข้ายกเว้น
 * - งวดที่ไม่มีรายการผูก `paymentId` = คำตัดสินของ `orphan_payments` (ล้าง 11-2103 ของงวด · JP4 · งวดนำเข้าที่ยังไม่ถูกแตะ)
 * - ลูกหนี้ = `hp_receivable_reconciliation` (เดิมอ่าน 11-2102 ค่าเผื่อหนี้สงสัยจะสูญ) · VAT = `vat_mismatch` (เดิมเทียบ 21-2101
 *   ของใบรับกับ `Payment.vatAmount`) · ค่าคอม = `commission_mismatch` (SKIPPED)
 */
@Injectable()
export class ContractTraceService {
  constructor(
    private prisma: PrismaService,
    private checks: DataAuditChecksService,
  ) {}

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

    // Every template entry of the contract carries metadata.contractId (1A, A.1, the legacy opening,
    // both SHOP activation legs, 2A, receipts, reversals …).
    const contractJournals = await this.prisma.journalEntry.findMany({
      where: {
        metadata: { path: ['contractId'], equals: contractId },
        deletedAt: null,
        status: 'POSTED',
      },
      include: { lines: { where: { deletedAt: null } } },
    });

    // Load payment journals.
    // PR-843/I2 Phase 3 PR 3.1: the epic posts MULTIPLE receipt JEs per Payment.
    // The canonical payment→JE key is now `metadata.paymentId` (JSON); the JE's
    // scalar `referenceId` is a fresh random UUID on new primitive receipt JEs
    // (it equals payment.id only on LEGACY 2B / split-final / credit-allocation
    // JEs). Match BOTH shapes: legacy via `referenceId in paymentIds`, new via
    // `metadata.paymentId` (one OR clause per payment — Prisma's JSON `equals`
    // can't take an array). `metadata` is selected (default scalar) so the
    // in-memory match in tracePayment / aggregations can read it.
    const paymentIds = contract.payments.map((p) => p.id);
    const paymentJournals =
      paymentIds.length > 0
        ? await this.prisma.journalEntry.findMany({
            where: {
              // Payment JEs are stored as referenceType 'AUTO' (journal-auto from
              // reference=payment.id), NOT 'PAYMENT' — the old value matched nothing.
              referenceType: 'AUTO',
              deletedAt: null,
              status: 'POSTED',
              OR: [
                { referenceId: { in: paymentIds } },
                ...paymentIds.map((pid) => ({
                  metadata: { path: ['paymentId'], equals: pid } as Prisma.JsonFilter,
                })),
              ],
            },
            include: { lines: { where: { deletedAt: null } } },
          })
        : [];

    const scope: ContractScope = { contractIds: [contractId] };
    // ตัวแยกเดียวกับตรวจกลางคืน (`legacy_contract_code IS NOT NULL` — ผู้เขียนคนเดียวคือตัวนำเข้า)
    const imported = contract.legacyContractCode != null;

    const preShopWiring = (await this.checks.preShopWiringContractIds([contractId])).has(
      contractId,
    );

    const creation = this.traceCreation(contract);
    const activation = await this.traceActivation(contract, contractJournals, imported);
    const cogs = this.traceCogs(contract, contractJournals, imported, preShopWiring);
    const interCompanyCheck = this.traceInterCompany(
      contract,
      contractJournals,
      imported,
      preShopWiring,
    );
    const orphanPaymentIds = await this.orphanPaymentIds(scope);
    const payments = contract.payments.map((p) =>
      this.tracePayment(p, paymentJournals, orphanPaymentIds),
    );
    const hpReceivable = await this.traceHpBalance(contract, scope);
    const vatTotal = await this.traceVatTotal(contract, scope);
    const commissionTotal = await this.traceCommissionTotal();
    const completion = this.traceCompletion(contract, imported);

    const allChecks = [
      creation,
      activation,
      cogs,
      interCompanyCheck,
      ...payments,
      hpReceivable,
      vatTotal,
      commissionTotal,
      completion,
    ];
    const count = (status: ContractTraceCheck['status']) =>
      allChecks.filter((c) => c.status === status).length;

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
        passed: count('PASS'),
        failed: count('FAIL'),
        warnings: count('WARN'),
        skipped: count('SKIPPED'),
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
      return {
        name: 'creation',
        status: 'PASS',
        details: 'Contract is DRAFT — no schedule expected yet',
      };
    }
    return {
      name: 'creation',
      status: hasSchedule ? 'PASS' : 'FAIL',
      details: hasSchedule
        ? { paymentCount: contract.payments.length }
        : 'ไม่พบตารางผ่อนชำระ (payment schedule)',
    };
  }

  /** รายการเปิดสัญญา: 1A / A.1 / ยอดยกมาของสัญญานำเข้า — กติกาเดียวกับ `orphan_contracts` (`CONTRACT_WITHOUT_OPENING_JOURNAL`) */
  private async traceActivation(
    contract: { id: string; status: string },
    journals: TraceJournal[],
    imported: boolean,
  ): Promise<ContractTraceCheck> {
    if (!ACTIVATED_STATUSES.includes(contract.status)) {
      return {
        name: 'activation',
        status: 'PASS',
        details: 'สัญญายังไม่ active — ไม่ต้องมี journal',
      };
    }
    const opening = journals.find((j) => isContractOpeningEntry(j.metadata ?? null));
    if (!opening) {
      const scheduleRows = imported
        ? await this.prisma.installmentSchedule.count({ where: { contractId: contract.id } })
        : 1;
      if (scheduleRows === 0) {
        return {
          name: 'activation',
          status: 'PASS',
          details: 'สัญญาประวัติที่นำเข้า (ไม่มีตารางงวด) — ตัวนำเข้าไม่ลงรายการเปิดสัญญาโดยตั้งใจ',
        };
      }
      return {
        name: 'activation',
        status: 'FAIL',
        details:
          'ไม่พบรายการเปิดสัญญา (1A / เปิดสัญญาใหม่ของการเปลี่ยนเครื่อง / ยอดยกมาของสัญญานำเข้า)',
      };
    }
    const balance = balanceOf(opening.lines);
    return { name: 'activation', status: balance.balanced ? 'PASS' : 'FAIL', details: balance };
  }

  /** ต้นทุนขายฝั่ง SHOP ของการเปิดสัญญา — กติกาเดียวกับ `missing_cogs` */
  private traceCogs(
    contract: { status: string; product: { costPrice: Prisma.Decimal } | null },
    journals: TraceJournal[],
    imported: boolean,
    preShopWiring: boolean,
  ): ContractTraceCheck {
    if (!ACTIVATED_STATUSES.includes(contract.status)) {
      return { name: 'cogs', status: 'PASS', details: 'สัญญายังไม่ active' };
    }
    if (imported) {
      return {
        name: 'cogs',
        status: 'PASS',
        details: 'สัญญานำเข้า — การขายฝั่งหน้าร้านอยู่ใน PEAK (ตัวนำเข้าไม่ลงขา SHOP)',
      };
    }
    const costPrice = new Prisma.Decimal(contract.product?.costPrice ?? 0);
    if (costPrice.lte(0)) {
      return { name: 'cogs', status: 'PASS', details: 'costPrice = 0 — ไม่ต้องมี COGS journal' };
    }
    const cogsJournal = journals.find((j) => flowOf(j) === SHOP_INVENTORY_TRANSFER_COGS_FLOW);
    if (!cogsJournal && preShopWiring) {
      return { name: 'cogs', status: 'PASS', details: PRE_SHOP_WIRING_DETAIL };
    }
    if (!cogsJournal) {
      return {
        name: 'cogs',
        status: 'FAIL',
        details: `costPrice = ${money(costPrice)} แต่ไม่พบต้นทุนขายฝั่ง SHOP ของการเปิดสัญญา (flow ${SHOP_INVENTORY_TRANSFER_COGS_FLOW})`,
      };
    }
    const balance = balanceOf(cogsJournal.lines);
    return {
      name: 'cogs',
      status: balance.balanced ? 'PASS' : 'FAIL',
      details: { costPrice: money(costPrice), ...balance },
    };
  }

  /** ลูกหนี้ FINANCE ฝั่ง SHOP (S11-3001/S11-3002) ที่ตั้งตอนเปิดสัญญา — คู่ระหว่างกิจการของ 21-1101/21-1102 ใน 1A */
  private traceInterCompany(
    contract: { status: string },
    journals: TraceJournal[],
    imported: boolean,
    preShopWiring: boolean,
  ): ContractTraceCheck {
    if (!ACTIVATED_STATUSES.includes(contract.status)) {
      return { name: 'interCompany', status: 'PASS', details: 'สัญญายังไม่ active' };
    }
    if (imported) {
      return {
        name: 'interCompany',
        status: 'PASS',
        details: 'สัญญานำเข้า — ไม่มีรายการระหว่างกิจการในระบบนี้ (การขายฝั่งหน้าร้านอยู่ใน PEAK)',
      };
    }
    const revenue = journals.find((j) => flowOf(j) === SHOP_INVENTORY_TRANSFER_REVENUE_FLOW);
    if (!revenue && preShopWiring) {
      return { name: 'interCompany', status: 'PASS', details: PRE_SHOP_WIRING_DETAIL };
    }
    if (!revenue) {
      return {
        name: 'interCompany',
        status: 'FAIL',
        details: `ไม่พบลูกหนี้ FINANCE ฝั่ง SHOP ของการเปิดสัญญา (flow ${SHOP_INVENTORY_TRANSFER_REVENUE_FLOW})`,
      };
    }
    const receivable = revenue.lines
      .filter((l) => SHOP_FINANCE_RECEIVABLE_ACCOUNTS.includes(l.accountCode))
      .reduce((s, l) => s.plus(l.debit).minus(l.credit), zero());
    const balance = balanceOf(revenue.lines);
    return {
      name: 'interCompany',
      status: balance.balanced ? 'PASS' : 'FAIL',
      details: { shopReceivableFromFinance: money(receivable), ...balance },
    };
  }

  /**
   * งวดที่ `orphan_payments` ตัดสินว่าไม่มีรายการหนุน (คำตัดสินเดียวกับตรวจกลางคืน) — **ทุกแถว**ของสัญญาในขอบเขต (เดิมอ่าน `details` ของ
   * ตรวจกลางคืนที่ตัด 50 แถว ⇒ แถวที่เกินถูกตัดสินผิดเป็น PASS — Task 23)
   */
  private async orphanPaymentIds(scope: ContractScope): Promise<Set<string>> {
    const rows = await this.checks.orphanPaymentRows(scope);
    return new Set(rows.map((row) => row.id));
  }

  private tracePayment(
    payment: { id: string; installmentNo: number; status: string; amountPaid: Prisma.Decimal },
    paymentJournals: TraceJournal[],
    orphanPaymentIds: Set<string>,
  ): ContractTraceCheck {
    const name = `payment_${payment.installmentNo}`;
    if (payment.status === 'PENDING' || new Prisma.Decimal(payment.amountPaid).isZero()) {
      return { name, status: 'PASS', details: 'ยังไม่ชำระ — ไม่ต้องมี journal' };
    }

    // PR-843/I2 Phase 3 PR 3.1: a payment may have MULTIPLE receipt JEs sharing
    // metadata.paymentId. Match ALL of them (new shape via metadata.paymentId,
    // legacy shape via referenceId == payment.id) and aggregate across them.
    const journals = paymentJournals.filter(
      (j) =>
        (j.metadata as { paymentId?: string } | null)?.paymentId === payment.id ||
        j.referenceId === payment.id,
    );
    if (journals.length === 0) {
      // ไม่มีรายการผูก paymentId — ยังหนุนได้แบบเดียวกับ orphan_payments: รายการล้าง 11-2103 ของงวด (รอบกลางคืนหักเงินรับล่วงหน้า /
      // เงินพัก) · JP4 ระดับสัญญา · งวดนำเข้าที่ยังไม่มีเส้นทางรับเงินแตะ
      if (!orphanPaymentIds.has(payment.id)) {
        return {
          name,
          status: 'PASS',
          details: { installmentNo: payment.installmentNo, backedWithoutPaymentId: true },
        };
      }
      return {
        name,
        status: 'FAIL',
        details: `งวดที่ ${payment.installmentNo} ชำระแล้ว (${payment.amountPaid}) แต่ไม่พบ journal`,
      };
    }

    // Aggregate Dr/Cr across ALL matching JEs — for a multi-receipt payment the
    // combined entry must still balance (each receipt JE balances individually,
    // so the sum does too).
    const balance = balanceOf(journals.flatMap((j) => j.lines));
    return {
      name,
      status: balance.balanced ? 'PASS' : 'FAIL',
      details: { installmentNo: payment.installmentNo, journalCount: journals.length, ...balance },
    };
  }

  /** `hp_receivable_reconciliation` ของสัญญานี้ (ตัวคำนวณรายสัญญา `journal/contract-receivable-recon.ts`) */
  private async traceHpBalance(
    contract: { status: string },
    scope: ContractScope,
  ): Promise<ContractTraceCheck> {
    if (!(RECEIVABLE_RECON_CONTRACT_STATUSES as readonly string[]).includes(contract.status)) {
      return {
        name: 'hpReceivable',
        status: 'PASS',
        details: `สถานะ ${contract.status} — ไม่อยู่ในขอบเขตกระทบยอดลูกหนี้รายสัญญา`,
      };
    }
    const result = await this.checks.checkHpReceivableReconciliation(scope);
    const summary = result.details[0] as {
      glReceivable: string;
      registerOutstanding: string;
      gap: string;
      tolerancePerContract: string;
    };
    return {
      name: 'hpReceivable',
      status: result.status === 'FAIL' ? 'FAIL' : 'PASS',
      details: {
        glReceivable: summary.glReceivable,
        registerOutstanding: summary.registerOutstanding,
        gap: summary.gap,
        tolerancePerContract: summary.tolerancePerContract,
      },
    };
  }

  /** `vat_mismatch` ของสัญญานี้: Dr 11-2105 − Cr 21-2102 = ภาษีของเงินรับล่วงหน้าที่ยังค้าง ± 0.01 */
  private async traceVatTotal(
    contract: { status: string },
    scope: ContractScope,
  ): Promise<ContractTraceCheck> {
    if (!(RECEIVABLE_RECON_CONTRACT_STATUSES as readonly string[]).includes(contract.status)) {
      return {
        name: 'vatTotal',
        status: 'PASS',
        details: `สถานะ ${contract.status} — ไม่อยู่ในขอบเขตตรวจ VAT รอเรียกเก็บรายสัญญา`,
      };
    }
    const result = await this.checks.checkVatMismatch(scope);
    return {
      name: 'vatTotal',
      status: result.status === 'FAIL' ? 'FAIL' : 'PASS',
      details:
        result.count > 0
          ? result.details
          : 'Dr 11-2105 − Cr 21-2102 = ภาษีของเงินรับล่วงหน้าที่ยังค้าง (± 0.01)',
    };
  }

  /** `commission_mismatch` — SKIPPED ตั้งแต่ 2026-10-30 (ค่าคอมตั้งครั้งเดียวตอนเปิดสัญญา ไม่ใช่ต่องวด) */
  private async traceCommissionTotal(): Promise<ContractTraceCheck> {
    const result = await this.checks.checkCommissionMismatch();
    return { name: 'commissionTotal', status: result.status, details: result.details[0] };
  }

  private traceCompletion(
    contract: {
      status: string;
      payments: { status: string }[];
      product: { ownedByCompanyId: string | null } | null;
    },
    imported: boolean,
  ): ContractTraceCheck {
    if (contract.status !== 'COMPLETED') {
      return {
        name: 'completion',
        status: 'PASS',
        details: `สถานะ ${contract.status} — ยังไม่ complete`,
      };
    }
    if (imported) {
      // สถานะ COMPLETED และยอดของแถวงวดมาจากระบบเก่าตามจริง (เช่น งวดสุดท้ายรับขาดเศษสตางค์ ⇒ PARTIALLY_PAID) — ไม่ใช่การปิด
      // สัญญาในระบบนี้
      return {
        name: 'completion',
        status: 'PASS',
        details: 'สัญญาประวัติที่นำเข้า — สถานะและแถวงวดมาจากระบบเก่า',
      };
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
}
