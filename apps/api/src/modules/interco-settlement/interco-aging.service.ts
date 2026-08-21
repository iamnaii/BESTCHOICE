import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * รายงานอายุลูกหนี้-หน้าร้าน 11-2107 / S21-3001 (Phase 4 — spec §6 ข้อ 1).
 *
 * SQL ในไฟล์นี้เป็น grouped twins ของ helper ต่อสัญญาใน
 * `interco-typed-balance.ts` และเลนส์ใน `interco-pending.service.ts` —
 * เงื่อนไข type ต้องตรงกันทุกตัวอักษร (แก้ที่ไหนแก้ทุกที่):
 *   - 11-2107 SWAP_CREDIT   = explicit stamp OR legacy flow 'exchange-buyback-receivable-11-2107'
 *   - 11-2107 PAYOUT_RECALL = explicit stamp เท่านั้น (type ใหม่ ไม่มี legacy)
 *   - 11-2107 SHOP_COLLECT  = explicit stamp ชนะ; ไม่มี stamp → flow/collectedByShop fallback
 *   - S21-3001 SWAP_CREDIT  key ด้วย metadata.newContractId (A.4 stamp)
 *   - S21-3001 PAYOUT_RECALL key ด้วย metadata.contractId (C-2 redirect / cash settle SHOP leg)
 *
 * ยอด "คงเหลือจริง" ของกลุ่มระหว่างกิจการ = typed gross ทั้งสองประเภทรวมกัน
 * ลบ Σ deduction ของ item ใน batch POSTED (สถาปัตยกรรม gross-lens: ขา Cr ของ
 * batch ไม่ stamp type/contractId จึงไม่ลด typed balance) — invariant ถือที่ระดับ
 * สัญญา ไม่ใช่ระดับประเภท (สัญญา swap ที่ถูกยกเลิกมีประวัติข้ามประเภท).
 */
export interface ShopReceivableAgingRow {
  contractId: string;
  contractNumber: string;
  customerName: string;
  /** 11-2107 typed SWAP_CREDIT gross (Dr−Cr) ของสัญญา */
  swapCreditGross: Prisma.Decimal;
  /** 11-2107 typed PAYOUT_RECALL gross (Dr−Cr) ของสัญญา */
  payoutRecallGross: Prisma.Decimal;
  /** Σ (swapCreditAmount + recallAmount) ของ item ทุก itemType ใน batch POSTED */
  settledDeduction: Prisma.Decimal;
  /** ยอดกลุ่มระหว่างกิจการคงเหลือจริง = swapCreditGross + payoutRecallGross − settledDeduction */
  intercoNet: Prisma.Decimal;
  /** 11-2107 typed SHOP_COLLECT (Dr−Cr) — เงินลูกค้าที่หน้าร้านรับแทน แยกคอลัมน์ ไม่ปนกลุ่ม interco */
  shopCollect: Prisma.Decimal;
  /** S21-3001 (Cr−Dr, conditional key) − settledDeduction — กระจกฝั่ง SHOP ของ intercoNet */
  shopMirrorNet: Prisma.Decimal;
  /** MIN(posted_at) ของ JE ที่มีขา Dr บน 11-2107 typed (กลุ่ม interco) */
  intercoOldestPostedAt: Date | null;
  intercoAgeDays: number | null;
  shopCollectOldestPostedAt: Date | null;
  shopCollectAgeDays: number | null;
  /** |intercoNet − shopMirrorNet| > 0.01 — สองสมุดไม่ตรง (SHOP_COLLECT ไม่นับ: FINANCE-side-only) */
  bookMismatch: boolean;
}

export interface ShopReceivableAgingResult {
  /** เฉพาะสัญญาที่ intercoNet > 0.01 หรือ shopCollect > 0.01 หรือ bookMismatch */
  rows: ShopReceivableAgingRow[];
  asOf: Date;
  totals: { intercoNet: Prisma.Decimal; shopCollect: Prisma.Decimal; overdueCount: number };
}

const EPS = new Prisma.Decimal('0.01');
const DAY_MS = 86_400_000;

// --- Typed conditions — VERBATIM twins ของ interco-typed-balance.ts ---------
// (composed เป็น Prisma.sql fragment เพื่อใช้ซ้ำใน CASE หลายคอลัมน์ของ Query A)
const SWAP_COND = Prisma.sql`(je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
         OR je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107')`;
const RECALL_COND = Prisma.sql`(je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL')`;
const SHOP_COLLECT_COND = Prisma.sql`(je.metadata->>'shopReceivableType' = 'SHOP_COLLECT'
         OR ((je.metadata->>'shopReceivableType' IS NULL
              OR je.metadata->>'shopReceivableType' NOT IN
                 ('SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT'))
             AND (je.metadata->>'collectedByShop' = 'true'
                  OR je.metadata->>'shopReceivable' = '11-2107'
                  OR je.metadata->>'flow' = 'shop-collect-settlement')))`;

// Group key ของ S21-3001 — แบบมีเงื่อนไข (jsdoc ด้านบน): SWAP_CREDIT key ด้วย
// newContractId (A.4 stamp — contractId บนใบนั้นคือสัญญาเก่า), ประเภทอื่น key
// ด้วย contractId. เขียนพลาดเป็น key เดียว = double-count/แถวผี — ด่านจับคือ
// เทสเคส (b) ที่สัญญาเดียวมีทั้งสองประเภท.
const SHOP_KEY = Prisma.sql`CASE WHEN je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
         THEN je.metadata->>'newContractId'
         ELSE je.metadata->>'contractId' END`;

interface FinanceAgingRow {
  contract_id: string | null;
  swap_gross: unknown;
  recall_gross: unknown;
  shop_collect: unknown;
  interco_oldest: Date | null;
  collect_oldest: Date | null;
}

@Injectable()
export class IntercoAgingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * รายงานอายุลูกหนี้ต่อสัญญา — engine กลางของ Phase 4: Task 2 (endpoint),
   * Task 3 (daily cron), Task 4 (reconcile cron) เรียก method นี้ตัวเดียว
   * ห้ามคำนวณเอง.
   *
   * จำนวน query **คงที่** (4 ครั้ง — ไม่ขึ้นกับจำนวนสัญญา): Query A รวม 3
   * typed sums + 2 MIN(posted_at) ของ 11-2107 ใน CASE เดียว, Query B รวม
   * S21-3001 สองประเภทด้วย conditional group key, Query C = deductions
   * groupBy, Query D = hydrate contract. ห้าม refactor กลับไปเรียก helper
   * ต่อสัญญาในลูป (N×5).
   *
   * `asOf` ใช้คำนวณอายุเท่านั้น — ยอดคงเหลือเป็นยอดปัจจุบันเสมอ (ตรงกับ
   * twins ใน interco-typed-balance.ts ที่ไม่มี date filter; deduction gate
   * อ่านสถานะ batch ปัจจุบันซึ่ง time-travel ไม่ได้อยู่แล้ว).
   */
  async getShopReceivableAging(
    asOf: Date = new Date(),
    thresholdDays = 30,
  ): Promise<ShopReceivableAgingResult> {
    // Query A — 11-2107 ทั้งบัญชี group by metadata.contractId: typed sums
    // สามประเภท + MIN(posted_at) ของขา Dr (วันตั้งหนี้เก่าสุด) สองกลุ่ม.
    // WHERE กรองเฉพาะบรรทัดที่ classify ได้ (UNKNOWN ไม่เข้ารายงานนี้ —
    // เหมือน twins; drift ระดับบัญชีเป็นหน้าที่ reconcile totals).
    const financeRows = await this.prisma.$queryRaw<FinanceAgingRow[]>(Prisma.sql`
      SELECT je.metadata->>'contractId' AS contract_id,
             COALESCE(SUM(CASE WHEN ${SWAP_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS swap_gross,
             COALESCE(SUM(CASE WHEN ${RECALL_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS recall_gross,
             COALESCE(SUM(CASE WHEN ${SHOP_COLLECT_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS shop_collect,
             MIN(CASE WHEN jl.debit > 0 AND (${SWAP_COND} OR ${RECALL_COND}) THEN je.posted_at END) AS interco_oldest,
             MIN(CASE WHEN jl.debit > 0 AND ${SHOP_COLLECT_COND} THEN je.posted_at END) AS collect_oldest
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '11-2107'
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
        AND (${SWAP_COND} OR ${RECALL_COND} OR ${SHOP_COLLECT_COND})
      GROUP BY 1
    `);

    // Query B — S21-3001 group by conditional key (SWAP_CREDIT → newContractId,
    // อื่น → contractId), Σ(Cr−Dr). WHERE จำกัดสองประเภท = union ของ twins
    // `swapCreditShopBalance` + `recallShopBalance` ตรงตัว.
    const shopRows = await this.prisma.$queryRaw<
      Array<{ contract_id: string | null; mirror_gross: unknown }>
    >(Prisma.sql`
      SELECT ${SHOP_KEY} AS contract_id,
             COALESCE(SUM(jl.credit - jl.debit), 0)::decimal AS mirror_gross
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = 'S21-3001'
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND je.metadata->>'shopReceivableType' IN ('SWAP_CREDIT', 'PAYOUT_RECALL')
        AND (${SHOP_KEY}) IS NOT NULL
      GROUP BY 1
    `);
    const shopByContract = new Map<string, Prisma.Decimal>();
    for (const row of shopRows) {
      if (!row.contract_id) continue;
      shopByContract.set(row.contract_id, new Prisma.Decimal(String(row.mirror_gross ?? 0)));
    }

    const financeByContract = new Map<
      string,
      FinanceAgingRow & { contract_id: string }
    >();
    for (const row of financeRows) {
      if (!row.contract_id) continue;
      financeByContract.set(row.contract_id, row as FinanceAgingRow & { contract_id: string });
    }

    // Universe = สัญญาที่มี typed 11-2107 หรือ S21-3001 — สัญญาที่มีแต่
    // deduction (ไม่มี gross ทั้งสองสมุด) net ติดลบเท่ากันสองสมุด → ไม่ผ่าน
    // filter อยู่แล้ว จึงไม่ต้องรวม key จาก Query C.
    const universeIds = [...new Set([...financeByContract.keys(), ...shopByContract.keys()])];
    if (universeIds.length === 0) {
      return {
        rows: [],
        asOf,
        totals: {
          intercoNet: new Prisma.Decimal(0),
          shopCollect: new Prisma.Decimal(0),
          overdueCount: 0,
        },
      };
    }

    // Query C — Σ deduction ต่อสัญญาจาก batch POSTED (item ทุก itemType —
    // สูตร NET ระดับสัญญา, สถาปัตยกรรม gross-lens: "หักแล้วเท่าไร" อยู่ที่
    // item table ไม่ใช่ GL metadata).
    const deductionGroups = await this.prisma.interCoSettlementItem.groupBy({
      by: ['contractId'],
      where: {
        contractId: { in: universeIds },
        deletedAt: null,
        batch: { status: 'POSTED', deletedAt: null },
      },
      _sum: { swapCreditAmount: true, recallAmount: true },
    });
    const deductionByContract = new Map<string, Prisma.Decimal>();
    for (const g of deductionGroups) {
      deductionByContract.set(
        g.contractId,
        new Prisma.Decimal(g._sum.swapCreditAmount ?? 0).plus(g._sum.recallAmount ?? 0),
      );
    }

    // Query D — hydrate contract. **ไม่กรอง status** — สัญญา CANCELED ต้องโผล่
    // ในรายงานอายุหนี้ (หัวใจของเคส C-2: สัญญายกเลิกหลังตัดจ่ายคือลูกหนี้
    // เรียกคืนตัวจริง). กรองเฉพาะ soft-delete ตาม house rule.
    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: universeIds }, deletedAt: null },
      select: { id: true, contractNumber: true, customer: { select: { name: true } } },
    });
    const contractById = new Map(contracts.map((c) => [c.id, c]));

    const zero = new Prisma.Decimal(0);
    const ageDays = (oldest: Date | null): number | null =>
      oldest ? Math.floor((asOf.getTime() - oldest.getTime()) / DAY_MS) : null;

    const rows: ShopReceivableAgingRow[] = [];
    for (const contractId of universeIds) {
      const contract = contractById.get(contractId);
      if (!contract) continue; // soft-deleted / phantom key (เช่น สัญญาเก่าของ A.4) — ไม่มีอะไรให้รายงาน

      const fin = financeByContract.get(contractId);
      const swapCreditGross = new Prisma.Decimal(String(fin?.swap_gross ?? 0));
      const payoutRecallGross = new Prisma.Decimal(String(fin?.recall_gross ?? 0));
      const shopCollect = new Prisma.Decimal(String(fin?.shop_collect ?? 0));
      const settledDeduction = deductionByContract.get(contractId) ?? zero;
      const shopGross = shopByContract.get(contractId) ?? zero;

      const intercoNet = swapCreditGross.plus(payoutRecallGross).minus(settledDeduction);
      const shopMirrorNet = shopGross.minus(settledDeduction);
      const bookMismatch = intercoNet.minus(shopMirrorNet).abs().gt(EPS);

      if (!intercoNet.gt(EPS) && !shopCollect.gt(EPS) && !bookMismatch) continue;

      const intercoOldestPostedAt = fin?.interco_oldest ?? null;
      const shopCollectOldestPostedAt = fin?.collect_oldest ?? null;

      rows.push({
        contractId,
        contractNumber: contract.contractNumber,
        customerName: contract.customer.name,
        swapCreditGross,
        payoutRecallGross,
        settledDeduction,
        intercoNet,
        shopCollect,
        shopMirrorNet,
        intercoOldestPostedAt,
        intercoAgeDays: ageDays(intercoOldestPostedAt),
        shopCollectOldestPostedAt,
        shopCollectAgeDays: ageDays(shopCollectOldestPostedAt),
        bookMismatch,
      });
    }

    // เรียงอายุมากสุดก่อน (effective age = max ของสองกลุ่ม; ไม่มีวันที่ = ท้ายสุด)
    const effectiveAge = (r: ShopReceivableAgingRow) =>
      Math.max(r.intercoAgeDays ?? -1, r.shopCollectAgeDays ?? -1);
    rows.sort(
      (a, b) => effectiveAge(b) - effectiveAge(a) || a.contractNumber.localeCompare(b.contractNumber),
    );

    const isOverdue = (r: ShopReceivableAgingRow) =>
      (r.intercoAgeDays !== null && r.intercoAgeDays >= thresholdDays && r.intercoNet.gt(EPS)) ||
      (r.shopCollectAgeDays !== null &&
        r.shopCollectAgeDays >= thresholdDays &&
        r.shopCollect.gt(EPS));

    return {
      rows,
      asOf,
      totals: {
        intercoNet: rows.reduce((s, r) => s.plus(r.intercoNet), zero),
        shopCollect: rows.reduce((s, r) => s.plus(r.shopCollect), zero),
        overdueCount: rows.filter(isOverdue).length,
      },
    };
  }
}
