/**
 * 11-2107 / S21-3001 reference types (workbook เจ้าของ 2026-08-19, spec §2).
 *
 * ทุก JE ใหม่ที่แตะสองบัญชีนี้ stamp `metadata.shopReceivableType` ตรงๆ;
 * แถวเก่า (ก่อน Phase 1) classify ตอนอ่านจาก `metadata.flow` /
 * `collectedByShop` — forward-only ไม่ backfill DB.
 *
 * | Type          | ความหมาย                                            | ล้างที่ |
 * |---------------|------------------------------------------------------|---------|
 * | SWAP_CREDIT   | เครดิตราคารับซื้อจากรับคืนเครื่อง (Flow B / A.3+A.4) | รอบจ่าย INTER-CO (Phase 2) หรือ shop-collect |
 * | PAYOUT_RECALL | เงินตัดจ่ายแล้วต้องเรียกคืน จากยกเลิกสัญญา (Flow C-2) | รอบจ่ายถัดไป หรือรับเงินสดคืน (Phase 3) |
 * | SHOP_COLLECT  | เงินลูกค้าที่หน้าร้านรับแทน (Flow D)                  | settleShopCollect — ไม่เข้ารอบจ่าย |
 *
 * SQL twins: เงื่อนไข explicit-stamp/FLOW_MAP ของ SWAP_CREDIT + PAYOUT_RECALL
 * ถูก reproduce เป็น raw SQL ใน `interco-settlement/interco-typed-balance.ts`,
 * เลนส์ `IntercoPendingService` และรายงานอายุ `IntercoAgingService` — แก้การ
 * classify ที่นี่ต้องแก้ทุกที่ (เฉพาะ SWAP_CREDIT ฝั่ง 11-2107 มี **4 จุด**).
 * NB: ฝั่ง S21-3001 SQL เป็น **stamp-only ไม่มี flow fallback** ทั้งที่ FLOW_MAP
 * map 'shop-exchange-return' → SWAP_CREDIT — แคบกว่า util ตัวนี้โดยตั้งใจ
 * (carry → Phase 5, ดู .claude/rules/accounting.md "ยังเปิดอยู่ → Phase 5")
 * (anti-drift net: interco-netting.integration.spec.ts).
 */
export type ShopReceivableType = 'SWAP_CREDIT' | 'PAYOUT_RECALL' | 'SHOP_COLLECT' | 'UNKNOWN';

const EXPLICIT: ReadonlySet<string> = new Set(['SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT']);

/** Legacy flow → type (ตารางตายตัว — เพิ่มได้ ห้ามแก้ความหมายเดิม) */
const FLOW_MAP: Readonly<Record<string, ShopReceivableType>> = {
  'exchange-buyback-receivable-11-2107': 'SWAP_CREDIT',
  'shop-exchange-return': 'SWAP_CREDIT', // ขาคู่ S21-3001 ฝั่ง SHOP
  'shop-collect-settlement': 'SHOP_COLLECT',
};

export function classifyShopReceivable(metadata: unknown): ShopReceivableType {
  if (!metadata || typeof metadata !== 'object') return 'UNKNOWN';
  const m = metadata as Record<string, unknown>;

  const explicit = m['shopReceivableType'];
  if (typeof explicit === 'string' && EXPLICIT.has(explicit)) {
    return explicit as ShopReceivableType;
  }

  const flow = typeof m['flow'] === 'string' ? (m['flow'] as string) : '';
  const fromFlow = FLOW_MAP[flow];
  if (fromFlow) return fromFlow;

  // JP4/บันทึกชำระเส้นทางหน้าร้านรับแทน (แถวเก่า) — stamp เดิมของมันเอง
  if (m['collectedByShop'] === true || m['shopReceivable'] === '11-2107') {
    return 'SHOP_COLLECT';
  }

  return 'UNKNOWN';
}
