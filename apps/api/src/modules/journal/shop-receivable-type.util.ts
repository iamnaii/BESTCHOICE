/**
 * 11-2107 / S21-1104 reference types (workbook เจ้าของ 2026-08-19, spec §2).
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
 * | DEVICE_RETURN | ค่าเครื่องคืนจากใบรับเครื่องคืน (JP5 ยืนยัน 2026-09-20 §6.3) | หักในรอบจ่าย INTER-CO หรือรับเงินสด (settleDeductionCash) — ห้ามล้างผ่านใบรับโอน (§6.4) |
 *
 * `SHOP_RECEIVABLE_TYPES` คือ**แหล่งเดียว**ของลิสต์ประเภท: `EXPLICIT` และ IN-list ใน raw SQL
 * ทุกตัว (`interco-typed-balance.ts`, `IntercoPendingService`, `IntercoAgingService`) สร้างจาก
 * ค่านี้ผ่าน `Prisma.join([...SHOP_RECEIVABLE_TYPES])` — เพิ่มประเภทที่นี่ที่เดียว carve-out
 * "stamp ที่รู้จักชนะ fallback" จะครอบประเภทใหม่ทุกจุดพร้อมกัน (spec 2026-09-20 §6.2).
 * DEVICE_RETURN เป็น explicit-stamp-only **โดยตั้งใจ ห้ามเพิ่ม FLOW_MAP**: แถวยึดเก่า flow
 * 'shop-repossession-intake' ที่ไม่มี stamp คือโหมดโอนทันที (Cr S11-1202 ไม่แตะ S21-1104) —
 * flow fallback จะทำให้ util จัดเป็น DEVICE_RETURN โดยไม่มีหนี้จริง.
 *
 * SQL twins: เงื่อนไข explicit-stamp/FLOW_MAP ของ SWAP_CREDIT + PAYOUT_RECALL
 * ถูก reproduce เป็น raw SQL ใน `interco-settlement/interco-typed-balance.ts`,
 * เลนส์ `IntercoPendingService` และรายงานอายุ `IntercoAgingService` — แก้การ
 * classify ที่นี่ต้องแก้ทุกที่ (เฉพาะ SWAP_CREDIT ฝั่ง 11-2107 มี **4 จุด**).
 * NB: ฝั่ง S21-1104 SQL เป็น **stamp-only ไม่มี flow fallback** ทั้งที่ FLOW_MAP
 * map 'shop-exchange-return' → SWAP_CREDIT — แคบกว่า util ตัวนี้โดยตั้งใจ
 * (carry → Phase 5, ดู .claude/rules/accounting.md "ยังเปิดอยู่ → Phase 5")
 * (anti-drift net: interco-netting.integration.spec.ts + interco-device-return.integration.spec.ts).
 */
export const SHOP_RECEIVABLE_TYPES = [
  'SWAP_CREDIT',
  'PAYOUT_RECALL',
  'SHOP_COLLECT',
  'DEVICE_RETURN',
] as const;

export type ShopReceivableType = (typeof SHOP_RECEIVABLE_TYPES)[number] | 'UNKNOWN';

const EXPLICIT: ReadonlySet<string> = new Set<string>(SHOP_RECEIVABLE_TYPES);

/** Legacy flow → type (ตารางตายตัว — เพิ่มได้ ห้ามแก้ความหมายเดิม) */
const FLOW_MAP: Readonly<Record<string, ShopReceivableType>> = {
  'exchange-buyback-receivable-11-2107': 'SWAP_CREDIT',
  'shop-exchange-return': 'SWAP_CREDIT', // ขาคู่ S21-1104 ฝั่ง SHOP
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
