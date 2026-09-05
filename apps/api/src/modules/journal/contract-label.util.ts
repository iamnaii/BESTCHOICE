import { Prisma, PrismaClient } from '@prisma/client';

/**
 * เลขสัญญาสำหรับ `description` ของ JE — JP5 เขียนเลขสัญญาอยู่แล้ว แต่ refund-payout /
 * refund-waive / shop-collect-settlement เคยเขียน `contractId.slice(0, 8)` (UUID)
 * ทำให้ค้นสมุดรายวันด้วยเลขสัญญาไม่เจอ (spec 2026-09-05 §4.4). Fallback เป็น UUID
 * 8 ตัวเดิมเมื่อไม่พบสัญญา (ไม่ควรเกิด — caller โหลดสัญญามาก่อนเสมอ).
 * ไม่แตะ `reference` / `metadata` — idempotency probe จับที่ metadata ไม่ใช่ข้อความ.
 */
export async function resolveContractLabel(
  client: Prisma.TransactionClient | PrismaClient,
  contractId: string,
): Promise<string> {
  const row = await client.contract.findUnique({
    where: { id: contractId },
    select: { contractNumber: true },
  });
  return row?.contractNumber ?? contractId.slice(0, 8);
}
