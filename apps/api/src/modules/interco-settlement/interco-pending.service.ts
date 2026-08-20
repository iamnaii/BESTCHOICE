import { Injectable } from '@nestjs/common';
import { InterCoBatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — pending engine (คิวรอจ่าย).
 *
 * Spec: docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md §4
 *
 * Per-contract lens ("payableOrigin"):
 *   payableOrigin_i = Σ(Cr−Dr) of 21-1101 (+21-1102 separately) from POSTED
 *   JEs where metadata.contractId = i (catches 1A + hand-JV that stamp
 *   contractId — settlement-batch JEs are deliberately excluded: they carry
 *   metadata.items[] instead of a single contractId, so they never enter
 *   this lens by construction).
 *
 * A contract is "settled" (removed from the queue) only when it has an
 * `InterCoSettlementItem` inside a batch with status PENDING_APPROVAL or
 * POSTED — REVERSED/CANCELLED do NOT count, so reversing a batch puts its
 * contracts straight back into the queue without touching the GL lens.
 *
 * Amounts always come from GL — never from `Contract.financedAmount` /
 * `Contract.storeCommission` (those fields can legitimately diverge from
 * the ledger, e.g. F4: storeCommission null ↔ 1A JE falls back to a 10%
 * commission — the GL is the only source of truth).
 */
export interface PendingContract {
  contractId: string;
  contractNumber: string;
  customerName: string;
  /** Best-effort activation date — see getPendingContracts() jsdoc for why this
   * is derived from the JE rather than a Contract field. */
  activatedAt: Date | null;
  /** เลนส์ 21-1101 — เจ้าหนี้ยอดจัดคงเหลือ */
  financedGl: Prisma.Decimal;
  /** เลนส์ 21-1102 — เจ้าหนี้ค่าคอมคงเหลือ */
  commissionGl: Prisma.Decimal;
  /** เลนส์ S11-3001 — ลูกหนี้ FINANCE (ยอดจัด) ฝั่ง SHOP */
  shopFinancedGl: Prisma.Decimal;
  /** เลนส์ S11-3002 — ลูกหนี้ FINANCE (ค่าคอม) ฝั่ง SHOP */
  shopCommissionGl: Prisma.Decimal;
  /** true เมื่อ GL ฝั่ง SHOP (S11-3001/S11-3002) ของสัญญานี้ = 0 ทั้งคู่ —
   * สัญญาก่อน wiring 2026-06-23 หรือสัญญาจาก contract-exchange (F1/F2). */
  legacyNoShop: boolean;
  /** เลนส์ 11-2107 SWAP_CREDIT — เครดิตเปลี่ยนเครื่องรอหักกลบ (0 = ไม่ใช่ swap) */
  swapCreditGl: Prisma.Decimal;
  /** เลนส์ S21-3001 (by newContractId) — ขาคู่ฝั่ง SHOP */
  shopBuybackPayableGl: Prisma.Decimal;
  /** หักกลบได้ = ทั้งสองสมุดมียอดและเท่ากัน ±0.01 (mixed-era spec §11.4: swap ก่อน Phase 1 → false) */
  swapCreditEligible: boolean;
}

/**
 * แถวคิวหักเรียกคืน (Flow C-2 — spec §4.1): สัญญายกเลิกหลังตัดจ่ายที่มี
 * 11-2107 [PAYOUT_RECALL] ค้าง — แสดงเป็น "แถวหัก" ในหน้ารอบจ่าย
 * (ไม่มีเจ้าหนี้ 21-1101/21-1102 ของตัวเอง).
 */
export interface RecallCandidate {
  contractId: string;
  contractNumber: string;
  customerName: string;
  /** 11-2107 PAYOUT_RECALL คงเหลือ */
  recallGl: Prisma.Decimal;
  /** S21-3001 PAYOUT_RECALL คงเหลือ (ต้อง = recallGl จึงหักได้) */
  shopRecallGl: Prisma.Decimal;
}

export interface ReconcileTotals {
  /** Σ (financedGl + commissionGl) ของทุกสัญญาในคิวรอจ่าย */
  pendingTotal: Prisma.Decimal;
  /** GL ทั้งบัญชี 21-1101+21-1102 (Σ Cr−Dr, ทุกบรรทัด รวมขา Dr ของรอบจ่ายด้วย — ไม่กรอง metadata) */
  glFinanceTotal: Prisma.Decimal;
  /** GL ทั้งบัญชี S11-3001+S11-3002 (Σ Dr−Cr, ทุกบรรทัด — ไม่กรอง metadata) */
  glShopTotal: Prisma.Decimal;
  /** pendingTotal − glFinanceTotal — เพี้ยน = มี JE แปลกปลอม/เส้นเก่าที่ไม่มี contractId */
  drift: Prisma.Decimal;
  /** 11-2107 typed SWAP_CREDIT ทั้งบัญชี (Dr−Cr — explicit stamp หรือ legacy A.3 flow) */
  glSwapCreditTotal: Prisma.Decimal;
  /** 11-2107 typed PAYOUT_RECALL ทั้งบัญชี (Dr−Cr — explicit stamp เท่านั้น) */
  glRecallTotal: Prisma.Decimal;
  /** S21-3001 ทั้งบัญชี (Cr−Dr — ไม่กรอง type) */
  glShopBuybackTotal: Prisma.Decimal;
}

/** "settled" gate statuses — item ใน batch สถานะเหล่านี้ทำให้สัญญาหลุดจากคิว */
const OPEN_BATCH_STATUSES: InterCoBatchStatus[] = ['PENDING_APPROVAL', 'POSTED'];

interface FinanceRow {
  contract_id: string | null;
  activated_at: Date | null;
  financed: unknown;
  commission: unknown;
}

interface ShopRow {
  contract_id: string | null;
  financed: unknown;
  commission: unknown;
}

@Injectable()
export class IntercoPendingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * คิวรอจ่าย — ดูจาก GL ล้วน (ไม่อ่าน contract.financedAmount/storeCommission)
   * ใช้ `$queryRaw` เพราะ Prisma group-by บน JSON path (`metadata->>'contractId'`)
   * ไม่ได้ (spec §4, plan Task 2 Step 3).
   *
   * `activatedAt` — Contract model ไม่มีฟิลด์ "วันที่ activate" ตรงๆ
   * (มีแค่ `createdAt` ซึ่งคือวันสร้างร่าง ไม่ใช่วัน activate, และ `updatedAt`
   * ซึ่งขยับทุกครั้งที่มีการแก้ไขฟิลด์ใดก็ได้ — ไม่น่าเชื่อถือ). ใช้
   * `MIN(je.posted_at)` ของ JE ที่ถูกนับในเลนส์นี้แทน — เพราะ 1A (ContractActivation1ATemplate)
   * คือ JE ใบแรกที่แตะ 21-1101/21-1102 พร้อม metadata.contractId ของสัญญานั้น
   * เสมอ ดังนั้น MIN(postedAt) ของกลุ่มนี้ = วันที่ activate จริงในทางปฏิบัติ.
   */
  async getPendingContracts(
    tx?: Prisma.TransactionClient,
  ): Promise<PendingContract[]> {
    const client = (tx ?? this.prisma) as Prisma.TransactionClient;

    // FINANCE lens — 21-1101 (ยอดจัด) / 21-1102 (ค่าคอม), grouped by
    // metadata.contractId. Settlement-batch JEs never match this WHERE
    // clause because they don't stamp a per-line metadata.contractId (they
    // stamp metadata.items[] instead) — see spec §4.
    const financeRows = await client.$queryRaw<FinanceRow[]>`
      SELECT je.metadata->>'contractId' AS contract_id,
             MIN(je.posted_at) AS activated_at,
             COALESCE(SUM(CASE WHEN jl.account_code = '21-1101' THEN jl.credit - jl.debit ELSE 0 END), 0)::decimal AS financed,
             COALESCE(SUM(CASE WHEN jl.account_code = '21-1102' THEN jl.credit - jl.debit ELSE 0 END), 0)::decimal AS commission
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code IN ('21-1101', '21-1102')
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
      GROUP BY 1
      HAVING SUM(jl.credit - jl.debit) > 0
    `;

    // Defensive filter — the SQL WHERE already excludes NULL contractId, but
    // guard here too in case the query is ever swapped/edited independently
    // of this mapper.
    const validFinanceRows = financeRows.filter(
      (r): r is FinanceRow & { contract_id: string } => !!r.contract_id,
    );
    if (validFinanceRows.length === 0) return [];

    // SHOP lens — same shape on S11-3001 (ลูกหนี้ยอดจัด) / S11-3002 (ลูกหนี้ค่าคอม),
    // sign flipped (Dr−Cr — these are SHOP-side receivables, not payables).
    // Not filtered to only the FINANCE contractIds — a contract with a SHOP
    // leg but somehow no FINANCE leg would never surface anyway (it's looked
    // up via the finance-side contract list below).
    const shopRows = await client.$queryRaw<ShopRow[]>`
      SELECT je.metadata->>'contractId' AS contract_id,
             COALESCE(SUM(CASE WHEN jl.account_code = 'S11-3001' THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS financed,
             COALESCE(SUM(CASE WHEN jl.account_code = 'S11-3002' THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS commission
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code IN ('S11-3001', 'S11-3002')
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
      GROUP BY 1
    `;
    const shopByContract = new Map<
      string,
      { financed: Prisma.Decimal; commission: Prisma.Decimal }
    >();
    for (const row of shopRows) {
      if (!row.contract_id) continue;
      shopByContract.set(row.contract_id, {
        financed: new Prisma.Decimal(String(row.financed ?? 0)),
        commission: new Prisma.Decimal(String(row.commission ?? 0)),
      });
    }

    // SWAP_CREDIT lenses (Phase 2 — spec §4.1). เงื่อนไข type ต้องสอดคล้อง
    // `classifyShopReceivable` (shop-receivable-type.util.ts) และ SQL twin
    // ใน interco-typed-balance.ts — แก้ที่ไหนต้องแก้ทั้งคู่:
    //   - 11-2107 SWAP_CREDIT: explicit stamp OR legacy flow
    //     'exchange-buyback-receivable-11-2107' (mirror ตอน cancel carry stamp
    //     มาแล้วตั้งแต่ Phase 1 → net เป็นศูนย์เองในประเภทเดียวกัน)
    //   - S21-3001 SWAP_CREDIT: key ด้วย metadata.newContractId (A.4 stamp
    //     ตั้งแต่ Phase 2 Task 1)
    const swapCreditRows = await client.$queryRaw<
      Array<{ contract_id: string | null; credit: unknown }>
    >`
      SELECT je.metadata->>'contractId' AS contract_id,
             COALESCE(SUM(jl.debit - jl.credit), 0)::decimal AS credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '11-2107'
        AND jl.deleted_at IS NULL AND je.status = 'POSTED' AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
        AND (je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
             OR je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107')
      GROUP BY 1
    `;
    const swapCreditByContract = new Map<string, Prisma.Decimal>();
    for (const row of swapCreditRows) {
      if (!row.contract_id) continue;
      swapCreditByContract.set(row.contract_id, new Prisma.Decimal(String(row.credit ?? 0)));
    }

    const shopBuybackRows = await client.$queryRaw<
      Array<{ contract_id: string | null; payable: unknown }>
    >`
      SELECT je.metadata->>'newContractId' AS contract_id,
             COALESCE(SUM(jl.credit - jl.debit), 0)::decimal AS payable
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = 'S21-3001'
        AND jl.deleted_at IS NULL AND je.status = 'POSTED' AND je.deleted_at IS NULL
        AND je.metadata->>'newContractId' IS NOT NULL
        AND je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
      GROUP BY 1
    `;
    const shopBuybackByContract = new Map<string, Prisma.Decimal>();
    for (const row of shopBuybackRows) {
      if (!row.contract_id) continue;
      shopBuybackByContract.set(row.contract_id, new Prisma.Decimal(String(row.payable ?? 0)));
    }

    const contractIds = validFinanceRows.map((r) => r.contract_id);

    // "settled" gate — exclude contracts already carried by an in-flight or
    // posted batch. REVERSED/CANCELLED items do NOT exclude — that's the
    // whole point of the reverse flow putting a contract back in the queue
    // without needing to touch the GL lens.
    const settledItems = await client.interCoSettlementItem.findMany({
      where: {
        contractId: { in: contractIds },
        deletedAt: null,
        batch: { status: { in: OPEN_BATCH_STATUSES }, deletedAt: null },
      },
      select: { contractId: true },
    });
    const settledContractIds = new Set(settledItems.map((i) => i.contractId));

    const remainingIds = contractIds.filter((id) => !settledContractIds.has(id));
    if (remainingIds.length === 0) return [];

    // Deliberately select ONLY id/contractNumber/customer.name — never
    // financedAmount/storeCommission. GL is the sole source of truth for
    // amounts (spec §4, F4).
    const contracts = await client.contract.findMany({
      where: { id: { in: remainingIds }, deletedAt: null },
      select: {
        id: true,
        contractNumber: true,
        customer: { select: { name: true } },
      },
    });
    const contractById = new Map(contracts.map((c) => [c.id, c]));

    const result: PendingContract[] = [];
    for (const row of validFinanceRows) {
      const contractId = row.contract_id;
      const contract = contractById.get(contractId);
      if (!contract) continue; // settled, soft-deleted, or otherwise gone

      const financedGl = new Prisma.Decimal(String(row.financed ?? 0));
      const commissionGl = new Prisma.Decimal(String(row.commission ?? 0));
      const shop = shopByContract.get(contractId);
      const shopFinancedGl = shop?.financed ?? new Prisma.Decimal(0);
      const shopCommissionGl = shop?.commission ?? new Prisma.Decimal(0);

      const swapCreditGl = swapCreditByContract.get(contractId) ?? new Prisma.Decimal(0);
      const shopBuybackPayableGl = shopBuybackByContract.get(contractId) ?? new Prisma.Decimal(0);
      // eligible = ทั้งสองสมุดมียอดและเท่ากัน ±0.01 — swap ยุคก่อน Phase 1
      // (ไม่มี S21-3001) จึงเป็น false โดยโครงสร้าง (mixed-era, spec §11.4)
      const swapCreditEligible =
        swapCreditGl.gt(0) &&
        shopBuybackPayableGl.gt(0) &&
        swapCreditGl.minus(shopBuybackPayableGl).abs().lte('0.01');

      result.push({
        contractId,
        contractNumber: contract.contractNumber,
        customerName: contract.customer.name,
        activatedAt: row.activated_at ?? null,
        financedGl,
        commissionGl,
        shopFinancedGl,
        shopCommissionGl,
        legacyNoShop: shopFinancedGl.eq(0) && shopCommissionGl.eq(0),
        swapCreditGl,
        shopBuybackPayableGl,
        swapCreditEligible,
      });
    }

    return result;
  }

  /**
   * คิวรายการหักเรียกคืน (Flow C-2 — spec §4.1): สัญญาที่มี 11-2107
   * [PAYOUT_RECALL] ค้าง > 0 และไม่อยู่ใน batch เปิด. producer ของ JE เหล่านี้
   * คือ Phase 3 — จนกว่าจะถึงตอนนั้นคิวนี้ว่างบน prod (ทดสอบด้วย synthetic
   * ตาม spec §5.4).
   *
   * Settled gate ของคิวนี้กรอง `itemType: 'RECALL'` เท่านั้น — สัญญา C-2
   * โดยนิยามเคยถูกจ่ายในรอบ POSTED มาก่อน (มี item SETTLEMENT ถาวรอยู่แล้ว);
   * ถ้า gate นับ item ทุกประเภทเหมือนคิวรอจ่าย คิว recall จะว่างตลอดกาล
   * โดยโครงสร้าง.
   */
  async getPendingRecalls(tx?: Prisma.TransactionClient): Promise<RecallCandidate[]> {
    const client = (tx ?? this.prisma) as Prisma.TransactionClient;

    // FINANCE lens — 11-2107 [PAYOUT_RECALL] (explicit stamp เท่านั้น — type
    // ใหม่ ไม่มี legacy; ต้องสอดคล้อง classifyShopReceivable + SQL twin ใน
    // interco-typed-balance.ts)
    const recallRows = await client.$queryRaw<
      Array<{ contract_id: string | null; recall: unknown }>
    >`
      SELECT je.metadata->>'contractId' AS contract_id,
             COALESCE(SUM(jl.debit - jl.credit), 0)::decimal AS recall
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '11-2107'
        AND jl.deleted_at IS NULL AND je.status = 'POSTED' AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
        AND je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'
      GROUP BY 1
      HAVING SUM(jl.debit - jl.credit) > 0
    `;
    const validRecallRows = recallRows.filter(
      (r): r is { contract_id: string; recall: unknown } => !!r.contract_id,
    );
    if (validRecallRows.length === 0) return [];

    // SHOP lens — S21-3001 [PAYOUT_RECALL], key ด้วย metadata.contractId
    // (ต่างจากขา SWAP_CREDIT ที่ key ด้วย newContractId)
    const shopRecallRows = await client.$queryRaw<
      Array<{ contract_id: string | null; recall: unknown }>
    >`
      SELECT je.metadata->>'contractId' AS contract_id,
             COALESCE(SUM(jl.credit - jl.debit), 0)::decimal AS recall
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = 'S21-3001'
        AND jl.deleted_at IS NULL AND je.status = 'POSTED' AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
        AND je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'
      GROUP BY 1
    `;
    const shopRecallByContract = new Map<string, Prisma.Decimal>();
    for (const row of shopRecallRows) {
      if (!row.contract_id) continue;
      shopRecallByContract.set(row.contract_id, new Prisma.Decimal(String(row.recall ?? 0)));
    }

    const contractIds = validRecallRows.map((r) => r.contract_id);

    // "settled" gate — เฉพาะ item RECALL ใน batch เปิด (ดู jsdoc ด้านบน)
    const settledItems = await client.interCoSettlementItem.findMany({
      where: {
        contractId: { in: contractIds },
        itemType: 'RECALL',
        deletedAt: null,
        batch: { status: { in: OPEN_BATCH_STATUSES }, deletedAt: null },
      },
      select: { contractId: true },
    });
    const settledContractIds = new Set(settledItems.map((i) => i.contractId));

    const remainingIds = contractIds.filter((id) => !settledContractIds.has(id));
    if (remainingIds.length === 0) return [];

    const contracts = await client.contract.findMany({
      where: { id: { in: remainingIds }, deletedAt: null },
      select: {
        id: true,
        contractNumber: true,
        customer: { select: { name: true } },
      },
    });
    const contractById = new Map(contracts.map((c) => [c.id, c]));

    const result: RecallCandidate[] = [];
    for (const row of validRecallRows) {
      const contract = contractById.get(row.contract_id);
      if (!contract) continue; // settled, soft-deleted, or otherwise gone

      result.push({
        contractId: row.contract_id,
        contractNumber: contract.contractNumber,
        customerName: contract.customer.name,
        recallGl: new Prisma.Decimal(String(row.recall ?? 0)),
        shopRecallGl: shopRecallByContract.get(row.contract_id) ?? new Prisma.Decimal(0),
      });
    }

    return result;
  }

  /**
   * Reconcile view ระดับบัญชี (spec §4) — ยอดรวมคิวรอจ่ายเทียบ GL ทั้งบัญชี.
   * เพี้ยน (drift ≠ 0) = มี JE แปลกปลอม/เส้นเก่าที่ไม่มี metadata.contractId
   * (pre-flight §10 ข้อ 1 ต้องนับ JE เส้นเก่าก่อนเปิดใช้).
   */
  async getReconcileTotals(): Promise<ReconcileTotals> {
    const pending = await this.getPendingContracts();
    const pendingTotal = pending.reduce(
      (sum, p) => sum.plus(p.financedGl).plus(p.commissionGl),
      new Prisma.Decimal(0),
    );

    const financeRows = await this.prisma.$queryRaw<Array<{ balance: unknown }>>`
      SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::decimal AS balance
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code IN ('21-1101', '21-1102')
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
    `;
    const glFinanceTotal = new Prisma.Decimal(String(financeRows[0]?.balance ?? 0));

    const shopRows = await this.prisma.$queryRaw<Array<{ balance: unknown }>>`
      SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::decimal AS balance
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code IN ('S11-3001', 'S11-3002')
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
    `;
    const glShopTotal = new Prisma.Decimal(String(shopRows[0]?.balance ?? 0));

    const drift = pendingTotal.minus(glFinanceTotal);

    // Typed whole-account totals (Phase 2 — spec §4.1). เงื่อนไข type ชุด
    // เดียวกับเลนส์ per-contract + interco-typed-balance.ts (SQL twins).
    const swapCreditTotalRows = await this.prisma.$queryRaw<Array<{ balance: unknown }>>`
      SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::decimal AS balance
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '11-2107'
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND (je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
             OR je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107')
    `;
    const glSwapCreditTotal = new Prisma.Decimal(String(swapCreditTotalRows[0]?.balance ?? 0));

    const recallTotalRows = await this.prisma.$queryRaw<Array<{ balance: unknown }>>`
      SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::decimal AS balance
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '11-2107'
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'
    `;
    const glRecallTotal = new Prisma.Decimal(String(recallTotalRows[0]?.balance ?? 0));

    // S21-3001 ทั้งบัญชี — ไม่กรอง type (กระทบยอดรวมสองสมุด: SWAP_CREDIT +
    // PAYOUT_RECALL รวมกันต้องหนุนยอดบัญชีนี้)
    const shopBuybackTotalRows = await this.prisma.$queryRaw<Array<{ balance: unknown }>>`
      SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::decimal AS balance
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = 'S21-3001'
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
    `;
    const glShopBuybackTotal = new Prisma.Decimal(String(shopBuybackTotalRows[0]?.balance ?? 0));

    return {
      pendingTotal,
      glFinanceTotal,
      glShopTotal,
      drift,
      glSwapCreditTotal,
      glRecallTotal,
      glShopBuybackTotal,
    };
  }
}
