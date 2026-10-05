import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * ก้อน 3 — "เครื่องนี้ลงบัญชีสินค้าคงคลังรับเข้าแล้วหรือยัง"
 *
 * การตัดจำหน่าย (LOST / WRITE_OFF) เครดิต S11-200x ได้ก็ต่อเมื่อเคยมีเดบิตเข้ามาก่อน — เครื่องที่ยังไม่มีรายการ
 * รับเข้า (ของยกมาจาก Tooltify ที่รอฝ่ายบัญชี · เครื่องที่เพิ่มด้วยมือ · มือสองจากใบสั่งซื้อที่ยังรอถ่ายรูป) ต้องตัด
 * โดยไม่มี JE แล้วแจ้งฝ่ายบัญชี (คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 8 + spec ก้อน 3 §3.4).
 *
 * ลำดับ (หยุดที่ข้อแรกที่เข้า):
 *  1. มีแถว `GoodsReceivingItem` ของเครื่อง → ตัดสินจาก `journalEntryId` ของแถวนั้นเท่านั้น (เครื่องจาก PO เป็นเครื่องจาก PO —
 *     ถ้ายังไม่ลง ห้ามไปค้นสายอื่นแล้วเจอ JE ของเครื่องคนละตัวโดยบังเอิญ)
 *  2. รับซื้อมือสอง: `Product.checklistResults.source === 'trade-in'` → JE flow `shop-trade-in` ที่ `metadata.tradeInId` ตรง
 *  3. รับคืนเครื่อง: JE flow `shop-repossession-intake` ที่ `metadata.productId` ตรง
 *  4. เปลี่ยนเครื่อง A.4: JE flow `shop-exchange-return` ที่ `metadata.oldProductId` ตรง และยังไม่ถูกกลับรายการ
 * ยอดที่ลง = บรรทัด Dr บนบัญชี S11-200x ของรายการนั้น (ไม่มีบรรทัด = ไม่นับ)
 */
export type BookedSource = 'GOODS_RECEIVING' | 'TRADE_IN' | 'REPOSSESSION' | 'EXCHANGE_RETURN';

export interface BookedInventory {
  booked: boolean;
  source: BookedSource | null;
  bookedAmount: Decimal | null;
  journalEntryNo: string | null;
  grNumber: string | null;
}

const INVENTORY_ACCOUNT = /^S11-200[1-4]$/;
const NOT_BOOKED: BookedInventory = { booked: false, source: null, bookedAmount: null, journalEntryNo: null, grNumber: null };

type JeWithLines = {
  id: string;
  entryNumber: string;
  metadata: unknown;
  lines: { accountCode: string; debit: Decimal | string | number; credit: Decimal | string | number }[];
};

export async function resolveBookedInventory(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<BookedInventory> {
  const grItem = await tx.goodsReceivingItem.findFirst({
    where: { productId, deletedAt: null },
    select: { receivedCost: true, journalEntryId: true, receiving: { select: { grNumber: true } } },
  });
  if (grItem) {
    if (!grItem.journalEntryId || grItem.receivedCost === null) {
      return { ...NOT_BOOKED, grNumber: grItem.receiving?.grNumber ?? null };
    }
    const je = await tx.journalEntry.findUnique({ where: { id: grItem.journalEntryId }, select: { entryNumber: true } });
    return {
      booked: true,
      source: 'GOODS_RECEIVING',
      bookedAmount: new Decimal(grItem.receivedCost.toString()),
      journalEntryNo: je?.entryNumber ?? null,
      grNumber: grItem.receiving?.grNumber ?? null,
    };
  }

  const product = await tx.product.findUnique({ where: { id: productId }, select: { checklistResults: true } });
  const checklist = (product?.checklistResults ?? null) as Record<string, unknown> | null;
  if (checklist && checklist.source === 'trade-in' && typeof checklist.tradeInId === 'string') {
    const hit = await findInventoryJe(tx, 'shop-trade-in', 'tradeInId', checklist.tradeInId);
    if (hit) return { ...hit, source: 'TRADE_IN' };
  }

  const repo = await findInventoryJe(tx, 'shop-repossession-intake', 'productId', productId);
  if (repo) return { ...repo, source: 'REPOSSESSION' };

  const exchange = await findInventoryJe(tx, 'shop-exchange-return', 'oldProductId', productId);
  if (exchange) return { ...exchange, source: 'EXCHANGE_RETURN' };

  return NOT_BOOKED;
}

async function findInventoryJe(
  tx: Prisma.TransactionClient,
  flow: string,
  key: string,
  value: string,
): Promise<Omit<BookedInventory, 'source'> | null> {
  const je = (await tx.journalEntry.findFirst({
    where: {
      status: 'POSTED',
      deletedAt: null,
      AND: [
        { metadata: { path: ['flow'], equals: flow } as any },
        { metadata: { path: [key], equals: value } as any },
      ],
    },
    include: { lines: { where: { deletedAt: null } } },
    orderBy: { postedAt: 'desc' },
  })) as JeWithLines | null;
  if (!je) return null;
  const meta = (je.metadata ?? null) as Record<string, unknown> | null;
  if (meta?.reversed === true) return null;
  const inventoryLine = je.lines.find(
    (line) => INVENTORY_ACCOUNT.test(line.accountCode) && new Decimal(line.debit.toString()).gt(0),
  );
  if (!inventoryLine) return null;
  return {
    booked: true,
    bookedAmount: new Decimal(inventoryLine.debit.toString()),
    journalEntryNo: je.entryNumber,
    grNumber: null,
  };
}
