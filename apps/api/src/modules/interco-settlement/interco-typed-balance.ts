import { Prisma, PrismaClient } from '@prisma/client';

type Client = Prisma.TransactionClient | PrismaClient;

/**
 * Typed GL balances สำหรับหักกลบรอบจ่าย (Phase 2 — spec §4).
 *
 * เงื่อนไข type ต้อง**สอดคล้อง**กับ `classifyShopReceivable` (shop-receivable-type.util.ts):
 * - SWAP_CREDIT ฝั่ง 11-2107: explicit stamp **ชนะ** flow fallback (Phase 4 Task 6) —
 *   stamp = SWAP_CREDIT, หรือไม่มี/ไม่รู้จัก stamp แล้ว flow = legacy A.3
 *   'exchange-buyback-receivable-11-2107' (mirror ตอน cancel carry stamp มาแล้ว
 *   ตั้งแต่ Phase 1 → net เป็นศูนย์เองในประเภทเดียวกัน)
 * - PAYOUT_RECALL: explicit stamp เท่านั้น (type ใหม่ ไม่มี legacy)
 * - S21-3001 SWAP_CREDIT: key ด้วย metadata.newContractId (A.4 stamp ตั้งแต่ Phase 2 Task 1)
 * - S21-3001 PAYOUT_RECALL: key ด้วย metadata.contractId (C-2 producer ใน Phase 3)
 *
 * SQL twins ของเงื่อนไขชุดนี้อยู่ในเลนส์ `IntercoPendingService` (grouped
 * queries — interco-pending.service.ts) — แก้ที่ไหนต้องแก้ทั้งคู่;
 * anti-drift net คือ interco-netting.integration.spec.ts.
 */
async function sumTyped(
  client: Client,
  accountCode: string,
  sign: 'dr-cr' | 'cr-dr',
  where: Prisma.Sql,
): Promise<Prisma.Decimal> {
  const expr =
    sign === 'dr-cr'
      ? Prisma.sql`SUM(jl.debit - jl.credit)`
      : Prisma.sql`SUM(jl.credit - jl.debit)`;
  const rows = await client.$queryRaw<Array<{ balance: unknown }>>(Prisma.sql`
    SELECT COALESCE(${expr}, 0)::decimal AS balance
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_code = ${accountCode}
      AND jl.deleted_at IS NULL
      AND je.status = 'POSTED'
      AND je.deleted_at IS NULL
      AND ${where}
  `);
  return new Prisma.Decimal(String(rows[0]?.balance ?? 0));
}

/**
 * 11-2107 Σ(Dr−Cr) เฉพาะประเภท SWAP_CREDIT — explicit stamp **ชนะ** flow
 * fallback (Phase 4 Task 6): `classifyShopReceivable` เช็ค `EXPLICIT.has(...)`
 * ก่อน `FLOW_MAP` เสมอ ⇒ JE รูป A.3 (flow เดิม) ที่ stamp ประเภทอื่นต้องไม่
 * ถูกนับที่นี่ ไม่งั้นมันจะเข้าสองประเภทพร้อมกัน (SWAP_CREDIT + PAYOUT_RECALL)
 * ทั้งในเลนส์ต่อสัญญาและรายงานอายุ. carve-out รูปเดียวกับ
 * `shopCollectTypedBalance` (Phase 3 Task 6).
 *
 * แถวเก่าทุกชนิดให้ผลเท่าเดิมทุกบาท: A.3 ยุค Phase 1+ (stamp SWAP_CREDIT) เข้า
 * branch แรก; A.3 ยุค legacy (ไม่มี stamp) และแถวที่ stamp ค่าที่ไม่รู้จัก เข้า
 * branch fallback เหมือนเดิม (ตรงกับ `EXPLICIT.has` ที่ล้มเหลวแล้วไปต่อ FLOW_MAP).
 */
export function swapCreditFinanceBalance(
  client: Client,
  contractId: string,
): Promise<Prisma.Decimal> {
  return sumTyped(
    client,
    '11-2107',
    'dr-cr',
    Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND (je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
         OR ((je.metadata->>'shopReceivableType' IS NULL
              OR je.metadata->>'shopReceivableType' NOT IN
                 ('SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT'))
             AND je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107'))`,
  );
}

/** S21-3001 Σ(Cr−Dr) เฉพาะ SWAP_CREDIT — key ด้วย metadata.newContractId (A.4) */
export function swapCreditShopBalance(
  client: Client,
  newContractId: string,
): Promise<Prisma.Decimal> {
  return sumTyped(
    client,
    'S21-3001',
    'cr-dr',
    Prisma.sql`
    je.metadata->>'newContractId' = ${newContractId}
    AND je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'`,
  );
}

/**
 * 11-2107 Σ(Dr−Cr) เฉพาะประเภท SHOP_COLLECT ของสัญญาหนึ่ง (Phase 3 Task 2 —
 * guard ยกเลิกสัญญา C-1: หน้าร้านถือเงินลูกค้ายังไม่ settle → ห้ามยกเลิก).
 * เงื่อนไข mirror `classifyShopReceivable`: explicit stamp ชนะเสมอ — fallback
 * (legacy JP4/JP5 marker `collectedByShop` / `shopReceivable='11-2107'` และ
 * flow ของใบ settle `shop-collect-settlement`) ใช้เฉพาะแถวที่ไม่มี explicit
 * stamp ที่ valid. จำเป็นตั้งแต่ Phase 3 Task 6: ใบ settle เส้นทางรับเงินสดคืน
 * ใช้ flow 'shop-collect-settlement' เดิมแต่ stamp 'PAYOUT_RECALL' — ถ้า OR
 * flow แบบไม่ดู stamp ใบนั้นจะรั่วเข้าเลนส์นี้เป็นยอดติดลบ (ขัด precedence
 * ของ classifyShopReceivable).
 */
export function shopCollectTypedBalance(
  client: Client,
  contractId: string,
): Promise<Prisma.Decimal> {
  return sumTyped(
    client,
    '11-2107',
    'dr-cr',
    Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND (je.metadata->>'shopReceivableType' = 'SHOP_COLLECT'
         OR ((je.metadata->>'shopReceivableType' IS NULL
              OR je.metadata->>'shopReceivableType' NOT IN
                 ('SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT'))
             AND (je.metadata->>'collectedByShop' = 'true'
                  OR je.metadata->>'shopReceivable' = '11-2107'
                  OR je.metadata->>'flow' = 'shop-collect-settlement')))`,
  );
}

/** 11-2107 Σ(Dr−Cr) เฉพาะประเภท PAYOUT_RECALL (explicit stamp เท่านั้น) */
export function recallFinanceBalance(client: Client, contractId: string): Promise<Prisma.Decimal> {
  return sumTyped(
    client,
    '11-2107',
    'dr-cr',
    Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'`,
  );
}

/** S21-3001 Σ(Cr−Dr) เฉพาะ PAYOUT_RECALL — key ด้วย metadata.contractId (C-2) */
export function recallShopBalance(client: Client, contractId: string): Promise<Prisma.Decimal> {
  return sumTyped(
    client,
    'S21-3001',
    'cr-dr',
    Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'`,
  );
}
