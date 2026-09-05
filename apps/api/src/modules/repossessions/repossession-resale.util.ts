import { Prisma } from '@prisma/client';

/**
 * แถวยึด (`Repossession`) ปิด/เปิดตามชะตาของเครื่อง — **แหล่งเดียว** (2026-09-05):
 *   ปิด  → ขายผ่าน POS (`SaleWriterService`) หรือเปิดสัญญาผ่อนใหม่ (`ContractWorkflowService.activate`)
 *   เปิด → void ใบขาย (`SaleVoidService`) หรือยกเลิกสัญญาผ่อนใหม่ (`ContractCancellationService`, C-1)
 *
 * ห้ามเขียน `updateMany` ชุดที่สอง. `Repossession.productId` เป็น `@unique` จึงมีได้แถวเดียวต่อเครื่อง —
 * การยึดเครื่องเดิมซ้ำถูกกันไว้ที่ `RepossessionsService.create` ด้วยข้อความไทย (ถ้าวันหนึ่งถอด
 * `@unique` ออก `reopenRepossessionOnUnsale` ต้องเปลี่ยนไปเลือกแถวล่าสุดแทน `updateMany`).
 */
export const OPEN_REPOSSESSION_STATUSES = [
  'REPOSSESSED',
  'UNDER_REPAIR',
  'READY_FOR_SALE',
] as const;

export interface CloseRepossessionInput {
  productId: string;
  /** ราคาขายจริง (ราคาขายสด / ราคาขายของสัญญาผ่อนใหม่) */
  resellPrice: Prisma.Decimal | number | string;
  /** เมื่อขายผ่อนใหม่ — ผูกสัญญาใหม่ไว้ให้ตามย้อนได้ */
  soldContractId?: string;
}

/** เครื่องยึดถูกขายออก → แถวยึดที่ยังเปิดอยู่กลายเป็น SOLD พร้อมราคาขายจริง. คืนจำนวนแถวที่ปิด (0 = ไม่ใช่เครื่องยึด) */
export async function closeRepossessionOnSale(
  tx: Prisma.TransactionClient,
  input: CloseRepossessionInput,
): Promise<number> {
  const res = await tx.repossession.updateMany({
    where: {
      productId: input.productId,
      deletedAt: null,
      status: { in: [...OPEN_REPOSSESSION_STATUSES] },
    },
    data: {
      status: 'SOLD',
      resellPrice: input.resellPrice,
      ...(input.soldContractId ? { soldContractId: input.soldContractId } : {}),
    },
  });
  return res.count;
}

/** การขายถูกยกเลิก (void ใบขาย / ยกเลิกสัญญาผ่อนใหม่) → แถวยึดกลับเป็น "พร้อมขาย" คงราคาขายเดิมไว้เป็นราคาตั้ง */
export async function reopenRepossessionOnUnsale(
  tx: Prisma.TransactionClient,
  productIds: string[],
): Promise<number> {
  if (productIds.length === 0) return 0;
  const res = await tx.repossession.updateMany({
    where: { productId: { in: productIds }, status: 'SOLD', deletedAt: null },
    data: { status: 'READY_FOR_SALE', soldContractId: null },
  });
  return res.count;
}
