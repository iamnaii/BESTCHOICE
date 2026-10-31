import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CONTRACT_RECEIVABLE_TOLERANCE,
  isReceivableGapBreached,
  RECEIVABLE_RECON_CONTRACT_STATUSES,
  type ContractReceivableGap,
  type ContractScope,
} from '../../journal/contract-receivable-recon';
import { AuditCheckResult, ContractTraceCheck, ContractTraceResult } from '../data-audit.types';
import {
  ACTIVATED_CONTRACT_STATUSES,
  DataAuditChecksService,
  isContractOpeningEntry,
  JOURNAL_BALANCE_TOLERANCE,
  SHOP_INVENTORY_TRANSFER_COGS_FLOW,
  SHOP_INVENTORY_TRANSFER_REVENUE_FLOW,
  type VatMismatchRow,
} from './data-audit-checks.service';

/** ขอบเขตของ `orphan_contracts` / `missing_cogs` — ชุดสถานะเดียวกับตรวจกลางคืน (Task 23 · m-4) */
const isActivated = (status: string) =>
  (ACTIVATED_CONTRACT_STATUSES as readonly string[]).includes(status);
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

/**
 * คำตัดสินของตรวจกลางคืนสำหรับชุดสัญญาที่ไล่ตรวจ — แต่ละข้อรัน**ครั้งเดียวต่อชุด** scope ด้วย `contractIds` ทั้งชุด (Task 23 · m-5:
 * `trace-all` เดิมรันทุกข้อต่อสัญญา — CTE ของ `orphan_payments` สแกน `journal_entries` ทั้งตารางทุกครั้ง · ≤ 500 สัญญา ⇒ ~1,500 คิวรีสแกนเต็ม) ·
 * แถวไม่ตัด 50 (Task 18 nit — ชุดใหญ่กว่า 50 แถวได้เสมอ)
 */
interface TraceVerdicts {
  orphanContracts: Set<string>;
  missingCogs: Set<string>;
  preShopWiring: Set<string>;
  /** id ของแถวงวด */
  orphanPayments: Set<string>;
  receivableGaps: Map<string, ContractReceivableGap>;
  vatMismatches: Map<string, VatMismatchRow>;
  commission: AuditCheckResult;
}

const CONTRACT_TRACE_INCLUDE = {
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
} satisfies Prisma.ContractInclude;
type TracedContract = Prisma.ContractGetPayload<{ include: typeof CONTRACT_TRACE_INCLUDE }>;

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
    // เกณฑ์ของ `journal_balance` (ไม่สมดุล = ต่างกันเกิน 0.01)
    balanced: totalDebit.minus(totalCredit).abs().lte(JOURNAL_BALANCE_TOLERANCE),
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
 *
 * **2026-10-31 (Task 23 · m-4):** คำตัดสิน PASS/FAIL ของเปิดสัญญาและต้นทุนขายมาจาก `orphan_contracts` / `missing_cogs` (แถวของข้อนั้น
 * scope ที่สัญญา) — เดิม trace เขียนเงื่อนไขซ้ำฝั่ง TS ด้วยชุดสถานะที่กว้างกว่า (`EARLY_PAYOFF` / `CLOSED_BAD_DEBT`) ⇒ ตอนนี้ขอบเขตเท่า
 * ตรวจกลางคืน (`ACTIVATED_CONTRACT_STATUSES`) · ระหว่างกิจการ (ไม่มีข้อกลางคืนคู่) ใช้ประชากรเดียวกับ `missing_cogs` เพราะ JE A / JE B ลงใน
 * ธุรกรรมเดียวกัน · รายการที่พบใช้ตรวจสมดุลด้วยเกณฑ์ของ `journal_balance`
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
    const contract = await this.loadContract(contractId);
    return this.trace(contract, await this.loadVerdicts([contract.id]));
  }

  /**
   * ไล่ตรวจหลายสัญญา — ตรวจกลางคืนแต่ละข้อรันครั้งเดียวต่อชุด (`loadVerdicts`) แล้วตัดสินทีละสัญญา · ผลต่อสัญญาเท่ากับ `traceContract` ของ
   * สัญญานั้น (DB spec ปักไว้) · `trace-all`
   */
  async traceContracts(contractIds: readonly string[]): Promise<ContractTraceResult[]> {
    if (contractIds.length === 0) return [];
    const verdicts = await this.loadVerdicts(contractIds);
    const results: ContractTraceResult[] = [];
    for (const id of contractIds) {
      results.push(await this.trace(await this.loadContract(id), verdicts));
    }
    return results;
  }

  private async loadContract(contractId: string): Promise<TracedContract> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: CONTRACT_TRACE_INCLUDE,
    });
    if (!contract) {
      throw new NotFoundException(`ไม่พบสัญญา ID: ${contractId}`);
    }
    return contract;
  }

  /** ตรวจกลางคืนที่ trace ใช้ — ข้อละหนึ่งคิวรี scope ด้วยทั้งชุด (ตัวตรวจเดียวกับรอบ 06:00 ไม่มีสูตรที่สอง) */
  private async loadVerdicts(contractIds: readonly string[]): Promise<TraceVerdicts> {
    const scope: ContractScope = { contractIds };
    const ids = <T extends { id: string }>(rows: T[]) => new Set(rows.map((r) => r.id));
    const orphanContracts = ids(await this.checks.orphanContractRows(scope));
    const missingCogs = ids(await this.checks.missingCogsRows(scope));
    const preShopWiring = await this.checks.preShopWiringContractIds(contractIds);
    const orphanPayments = ids(await this.checks.orphanPaymentRows(scope));
    const receivableGaps = new Map(
      (await this.checks.receivableGapRows(scope)).map((r) => [r.contractId, r]),
    );
    const vatMismatches = new Map(
      (await this.checks.vatMismatchRows(scope)).map((r) => [r.contractId, r]),
    );
    const commission = await this.checks.checkCommissionMismatch();
    return {
      orphanContracts,
      missingCogs,
      preShopWiring,
      orphanPayments,
      receivableGaps,
      vatMismatches,
      commission,
    };
  }

  private async trace(
    contract: TracedContract,
    verdicts: TraceVerdicts,
  ): Promise<ContractTraceResult> {
    const contractId = contract.id;

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

    // ตัวแยกเดียวกับตรวจกลางคืน (`legacy_contract_code IS NOT NULL` — ผู้เขียนคนเดียวคือตัวนำเข้า)
    const imported = contract.legacyContractCode != null;
    // คำตัดสินของตรวจกลางคืน — ไม่มีเงื่อนไขชุดที่สองฝั่ง TS (Task 23 · m-4)
    const preShopWiring = verdicts.preShopWiring.has(contractId);

    const creation = this.traceCreation(contract);
    const activation = this.traceActivation(
      contract,
      contractJournals,
      imported,
      verdicts.orphanContracts.has(contractId),
    );
    const cogs = this.traceCogs(
      contract,
      contractJournals,
      imported,
      verdicts.missingCogs.has(contractId),
      preShopWiring,
    );
    const interCompanyCheck = this.traceInterCompany(
      contract,
      contractJournals,
      imported,
      preShopWiring,
    );
    const payments = contract.payments.map((p) =>
      this.tracePayment(p, paymentJournals, verdicts.orphanPayments),
    );
    const hpReceivable = this.traceHpBalance(contract, verdicts.receivableGaps.get(contractId));
    const vatTotal = this.traceVatTotal(contract, verdicts.vatMismatches.get(contractId));
    const commissionTotal = this.traceCommissionTotal(verdicts.commission);
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

    // ตรวจกลางคืนแต่ละข้อรันครั้งเดียวต่อชุด (Task 23 · m-5) — ไม่ใช่ต่อสัญญา
    const traces = await this.traceContracts(contracts.map((c) => c.id));
    const failures = traces.filter((trace) => trace.summary.failed > 0);

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

  /**
   * รายการเปิดสัญญา (1A / A.1 / ยอดยกมาของสัญญานำเข้า) — คำตัดสินของ `orphan_contracts` scope ที่สัญญานี้ (`orphan`) · รายการที่พบต้องสมดุล
   */
  private traceActivation(
    contract: { status: string },
    journals: TraceJournal[],
    imported: boolean,
    orphan: boolean,
  ): ContractTraceCheck {
    if (orphan) {
      return {
        name: 'activation',
        status: 'FAIL',
        details:
          'ไม่พบรายการเปิดสัญญา (1A / เปิดสัญญาใหม่ของการเปลี่ยนเครื่อง / ยอดยกมาของสัญญานำเข้า) — orphan_contracts',
      };
    }
    const opening = journals.find((j) => isContractOpeningEntry(j.metadata ?? null));
    if (!opening) {
      return {
        name: 'activation',
        status: 'PASS',
        details: !isActivated(contract.status)
          ? `สถานะ ${contract.status} — นอกขอบเขตของ orphan_contracts`
          : imported
            ? 'สัญญาประวัติที่นำเข้า (ไม่มีตารางงวด) — ตัวนำเข้าไม่ลงรายการเปิดสัญญาโดยตั้งใจ'
            : 'ไม่อยู่ในเกณฑ์ของ orphan_contracts',
      };
    }
    const balance = balanceOf(opening.lines);
    return { name: 'activation', status: balance.balanced ? 'PASS' : 'FAIL', details: balance };
  }

  /**
   * ต้นทุนขายฝั่ง SHOP ของการเปิดสัญญา — คำตัดสินของ `missing_cogs` scope ที่สัญญานี้ (`missing`) · รายการที่พบต้องสมดุล · ไม่พบและไม่ติด =
   * เหตุยกเว้นของข้อนั้น (เรียงตามเงื่อนไข SQL)
   */
  private traceCogs(
    contract: { status: string; product: { costPrice: Prisma.Decimal } | null },
    journals: TraceJournal[],
    imported: boolean,
    missing: boolean,
    preShopWiring: boolean,
  ): ContractTraceCheck {
    const costPrice = new Prisma.Decimal(contract.product?.costPrice ?? 0);
    if (missing) {
      return {
        name: 'cogs',
        status: 'FAIL',
        details: `costPrice = ${money(costPrice)} แต่ไม่พบต้นทุนขายฝั่ง SHOP ของการเปิดสัญญา (flow ${SHOP_INVENTORY_TRANSFER_COGS_FLOW}) — missing_cogs`,
      };
    }
    const cogsJournal = journals.find((j) => flowOf(j) === SHOP_INVENTORY_TRANSFER_COGS_FLOW);
    if (!cogsJournal) {
      return {
        name: 'cogs',
        status: 'PASS',
        details: !isActivated(contract.status)
          ? `สถานะ ${contract.status} — นอกขอบเขตของ missing_cogs`
          : imported
            ? 'สัญญานำเข้า — การขายฝั่งหน้าร้านอยู่ใน PEAK (ตัวนำเข้าไม่ลงขา SHOP)'
            : costPrice.lte(0)
              ? 'costPrice = 0 — ไม่ต้องมี COGS journal'
              : preShopWiring
                ? PRE_SHOP_WIRING_DETAIL
                : 'ไม่อยู่ในเกณฑ์ของ missing_cogs',
      };
    }
    const balance = balanceOf(cogsJournal.lines);
    return {
      name: 'cogs',
      status: balance.balanced ? 'PASS' : 'FAIL',
      details: { costPrice: money(costPrice), ...balance },
    };
  }

  /**
   * ลูกหนี้ FINANCE ฝั่ง SHOP (S11-3001/S11-3002) ที่ตั้งตอนเปิดสัญญา — คู่ระหว่างกิจการของ 21-1101/21-1102 ใน 1A · ไม่มีข้อกลางคืนคู่:
   * ประชากรเดียวกับ `missing_cogs` (สถานะ `ACTIVATED_CONTRACT_STATUSES` · ไม่ใช่สัญญานำเข้า · ไม่ใช่สัญญาก่อนต่อขา SHOP) เพราะ JE A / JE B
   * ลงในธุรกรรมเดียวกัน
   */
  private traceInterCompany(
    contract: { status: string },
    journals: TraceJournal[],
    imported: boolean,
    preShopWiring: boolean,
  ): ContractTraceCheck {
    if (!isActivated(contract.status)) {
      return {
        name: 'interCompany',
        status: 'PASS',
        details: `สถานะ ${contract.status} — นอกขอบเขตของ missing_cogs`,
      };
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
   * งวดที่ชำระแล้ว — รายการที่ผูก `paymentId` ต้องสมดุล · ไม่มีรายการผูก = คำตัดสินของ `orphan_payments` (`orphanPaymentIds` — **ทุกแถว**ของชุด
   * ไม่ใช่ `details` ของตรวจกลางคืนที่ตัด 50 แถว ⇒ แถวที่เกินเคยถูกตัดสินผิดเป็น PASS — Task 23)
   */
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

  /**
   * `hp_receivable_reconciliation` ของสัญญานี้ — แถวของตัวคำนวณรายสัญญา (`journal/contract-receivable-recon.ts`) + `isReceivableGapBreached`
   * (กติกาเดียวกับข้อกลางคืน) · ไม่มีแถว = ไม่อยู่ในขอบเขตกระทบยอด (เช่น สัญญาที่ถูกลบ)
   */
  private traceHpBalance(
    contract: { status: string },
    gap: ContractReceivableGap | undefined,
  ): ContractTraceCheck {
    if (
      !(RECEIVABLE_RECON_CONTRACT_STATUSES as readonly string[]).includes(contract.status) ||
      !gap
    ) {
      return {
        name: 'hpReceivable',
        status: 'PASS',
        details: `สถานะ ${contract.status} — ไม่อยู่ในขอบเขตกระทบยอดลูกหนี้รายสัญญา`,
      };
    }
    return {
      name: 'hpReceivable',
      status: isReceivableGapBreached(gap) ? 'FAIL' : 'PASS',
      details: {
        glReceivable: money(gap.glReceivable),
        registerOutstanding: money(gap.registerOutstanding),
        gap: money(gap.gap),
        tolerancePerContract: money(CONTRACT_RECEIVABLE_TOLERANCE),
      },
    };
  }

  /** `vat_mismatch` ของสัญญานี้: Dr 11-2105 − Cr 21-2102 = ภาษีของเงินรับล่วงหน้าที่ยังค้าง ± 0.01 */
  private traceVatTotal(
    contract: { status: string },
    mismatch: VatMismatchRow | undefined,
  ): ContractTraceCheck {
    if (!(RECEIVABLE_RECON_CONTRACT_STATUSES as readonly string[]).includes(contract.status)) {
      return {
        name: 'vatTotal',
        status: 'PASS',
        details: `สถานะ ${contract.status} — ไม่อยู่ในขอบเขตตรวจ VAT รอเรียกเก็บรายสัญญา`,
      };
    }
    return {
      name: 'vatTotal',
      status: mismatch ? 'FAIL' : 'PASS',
      details: mismatch
        ? [mismatch]
        : 'Dr 11-2105 − Cr 21-2102 = ภาษีของเงินรับล่วงหน้าที่ยังค้าง (± 0.01)',
    };
  }

  /** `commission_mismatch` — SKIPPED ตั้งแต่ 2026-10-30 (ค่าคอมตั้งครั้งเดียวตอนเปิดสัญญา ไม่ใช่ต่องวด) */
  private traceCommissionTotal(result: AuditCheckResult): ContractTraceCheck {
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
