import { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * ล้างสมุดเงินหน้าร้าน (`shop_tenders`) ของ "เอกสารทดสอบ" — ใช้ร่วมกันโดย cleanup-test-contracts และ
 * cleanup ของ test-pack (สเปค 2026-09-20-shop-tenders-daily-cash).
 *
 * ทำไมต้องลบถาวร ทั้งที่ flow ปกติห้ามแก้/ลบแถวในสมุดนี้: cleanup ฝั่งเอกสารเป็น soft delete ⇒ แถวเงินของ
 * เอกสารทดสอบจะยังโผล่ในหน้า "สรุปเงินรายวัน" ของจริง และหน้ารายงานกรองด้วย `deletedAt` ของเอกสารไม่ได้ เพราะ
 * ใบขายที่ถูก **ยกเลิก** ก็เป็น soft delete เหมือนกัน — แถวรับเงิน + แถวคืนเงินของใบนั้นคือสิ่งที่เจ้าของต้องเห็น.
 * คลาสเดียวกับ JE ของเอกสารทดสอบที่ cleanup ลบถาวรอยู่แล้ว.
 *
 * where เป็นแบบ relation filter (ไม่ใช่รายการ id ของเอกสารที่ยังไม่ถูกลบ) — แถวเงินของเอกสารทดสอบที่ถูก
 * void / soft delete ไปก่อนหน้าก็ต้องถูกกวาดด้วย.
 */
export function testTenderWhere(parts: Prisma.ShopTenderWhereInput[]): Prisma.ShopTenderWhereInput | null {
  return parts.length ? { OR: parts } : null;
}

export async function countShopTenders(db: Db, where: Prisma.ShopTenderWhereInput | null): Promise<number> {
  return where ? db.shopTender.count({ where }) : 0;
}

/** `reverses_tender_id` เป็น ON DELETE SET NULL ⇒ ลบรวดเดียวได้ ไม่ต้องเรียงแถว OUT ก่อน IN */
export async function deleteShopTenders(db: Db, where: Prisma.ShopTenderWhereInput | null): Promise<number> {
  return where ? (await db.shopTender.deleteMany({ where })).count : 0;
}

/**
 * JE แยกยอดของบิลจ่ายผสม (flow `shop-tender-split`) + ใบกลับรายการของมัน.
 * JE แยกยอดของ **สัญญา/ใบจอง** จงใจไม่ stamp `contractId`/`bookingId` (sweep ยกเลิกสัญญามี cash tripwire) ⇒
 * cleanup ที่ตามด้วยสอง key นั้นมองไม่เห็น ต้องตามด้วย `metadata.tenderDocId`; ใบกลับรายการไม่ carry key เดิม
 * จึงตามต่อด้วย `metadata.reversesEntryId` — ลบต้นฉบับแต่ทิ้ง mirror ไว้ = งบทดลองเพี้ยนหนักกว่าเดิม.
 * (ใบขายไม่ต้องใช้ตัวนี้: JE แยกยอดของใบขาย stamp `saleId` และถูกกวาดพร้อม JE ขายใบอื่น)
 */
export async function findTenderSplitEntries(db: Db, docIds: string[]): Promise<{ id: string; entryNumber: string }[]> {
  if (!docIds.length) return [];
  const originals = await db.journalEntry.findMany({
    where: { OR: docIds.map((id) => ({ metadata: { path: ['tenderDocId'], equals: id } as Prisma.JsonFilter<'JournalEntry'> })) },
    select: { id: true, entryNumber: true },
  });
  if (!originals.length) return [];
  const mirrors = await db.journalEntry.findMany({
    where: { OR: originals.map((je) => ({ metadata: { path: ['reversesEntryId'], equals: je.id } as Prisma.JsonFilter<'JournalEntry'> })) },
    select: { id: true, entryNumber: true },
  });
  const seen = new Set<string>();
  return [...originals, ...mirrors].filter((je) => !seen.has(je.id) && seen.add(je.id));
}
