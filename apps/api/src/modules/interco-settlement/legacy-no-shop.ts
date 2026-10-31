import { Prisma, PrismaClient } from '@prisma/client';

/**
 * `legacyNoShop` — สมุด SHOP ไม่มีลูกหนี้ FINANCE ของการเปิดสัญญาเลย: เลนส์ S11-3001 (ลูกหนี้ยอดจัด) และ S11-3002 (ลูกหนี้ค่าคอม)
 * ของสัญญา (Σ Dr − Cr ของรายการ `POSTED` ที่ไม่ถูกลบ ผูก `metadata.contractId`) เป็น 0 ทั้งคู่ — `.claude/rules/accounting.md`
 * หัวข้อ "`legacyNoShop` policy (F1/F2)" (`legacyNoShop_i = (shopFinancedGl_i == 0) AND (shopCommissionGl_i == 0)`).
 * ความหมายเดียวที่เหลือ (ตั้งแต่ 2026-08-03): **สัญญาที่เปิดก่อนต่อขา SHOP** (`SHOP_LEG_WIRED_BEFORE`) — สัญญาเปลี่ยนเครื่องลงขา SHOP แล้ว
 *
 * ไฟล์เดียวของนิยามนี้: คิวรอจ่าย (`IntercoPendingService.getPendingContracts` — รอบจ่ายไม่สร้างบรรทัด SHOP ให้) และตรวจข้อมูล
 * (`DataAuditChecksService.preShopWiringContractIds` — `missing_cogs` / trace) อ่านเลนส์และตัดสินผ่านไฟล์นี้
 *
 * หมายเหตุ: `IntercoAgingService.getPayablePairing` (กระทบยอดรายเดือน) ยังคำนวณธงนี้เองจากคิวรีสี่บัญชีของมันด้วยเกณฑ์ ±0.01
 * (ไม่ใช่ = 0) — ต่างจากที่นี่เฉพาะเลนส์ที่ค้าง ±0.01 พอดี
 */

/** เลนส์ลูกหนี้ FINANCE ฝั่ง SHOP ของสัญญาหนึ่ง (Dr − Cr) */
export interface ShopFinanceReceivableLens {
  /** S11-3001 — ลูกหนี้ FINANCE ยอดจัด */
  shopFinancedGl: Prisma.Decimal;
  /** S11-3002 — ลูกหนี้ FINANCE ค่าคอม */
  shopCommissionGl: Prisma.Decimal;
}

type Client = Prisma.TransactionClient | PrismaClient;

/**
 * เลนส์ S11-3001 / S11-3002 ต่อสัญญา (`metadata.contractId`) — รายการรอบจ่ายไม่ stamp `contractId` (stamp `items[]`) จึงไม่เข้าเลนส์
 * ⇒ ยอดต่อสัญญาคงที่ระดับ gross หลังจ่าย · `contractIds` ไม่ส่ง = ทุกสัญญา · ว่าง = ไม่มีสัญญา · สัญญาที่ไม่มีแถว = ไม่อยู่ใน Map
 * (= 0 ทั้งคู่)
 */
export async function loadShopFinanceReceivableLens(
  client: Client,
  contractIds?: readonly string[],
): Promise<Map<string, ShopFinanceReceivableLens>> {
  const lens = new Map<string, ShopFinanceReceivableLens>();
  if (contractIds && contractIds.length === 0) return lens;
  const rows = await client.$queryRaw<
    { contract_id: string | null; financed: unknown; commission: unknown }[]
  >`
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
        ${contractIds ? Prisma.sql`AND je.metadata->>'contractId' IN (${Prisma.join([...contractIds])})` : Prisma.empty}
      GROUP BY 1
    `;
  for (const row of rows) {
    if (!row.contract_id) continue;
    lens.set(row.contract_id, {
      shopFinancedGl: new Prisma.Decimal(String(row.financed ?? 0)),
      shopCommissionGl: new Prisma.Decimal(String(row.commission ?? 0)),
    });
  }
  return lens;
}

/** `legacyNoShop` ของสัญญา — ไม่มีแถวในเลนส์ (`undefined`) = 0 ทั้งคู่ */
export function isLegacyNoShop(lens: ShopFinanceReceivableLens | undefined): boolean {
  return !lens || (lens.shopFinancedGl.eq(0) && lens.shopCommissionGl.eq(0));
}

/**
 * ต่อขา SHOP ของการเปิดสัญญา (`ShopInventoryTransferTemplate` ใน `ContractWorkflowService.activate` — PR #1280 commit `bbcfa7a3`
 * merge 2026-06-23 16:08 น. เวลาไทย) ⇒ สัญญาที่เปิด**ภายในวันนั้นหรือก่อน** (เวลาไทย) อาจไม่มีขา SHOP โดยชอบ · ขอบรวมทั้งวันต่อขาเพราะ
 * deploy หลังเวลา merge — สัญญาที่เปิดหลัง deploy วันนั้นมีขา SHOP อยู่แล้ว (`legacyNoShop = false` ⇒ ยังถูกตรวจ)
 */
export const SHOP_LEG_WIRED_BEFORE = new Date('2026-06-24T00:00:00+07:00');

/** วันเปิดสัญญา (รายการเปิดสัญญาใบแรก) อยู่ก่อนต่อขา SHOP — ไม่ทราบวัน (`null`) = ไม่ใช่ */
export function activatedBeforeShopWiring(activatedAt: Date | null | undefined): boolean {
  return !!activatedAt && activatedAt.getTime() < SHOP_LEG_WIRED_BEFORE.getTime();
}
