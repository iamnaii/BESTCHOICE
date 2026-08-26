import { Prisma } from '@prisma/client';

import type { PrismaService } from '../../prisma/prisma.service';

/** ปัดเงิน 2 ตำแหน่ง half-up ใน Decimal — Global Constraint: ห้ามใช้ float กับจำนวนเงิน */
export const round2 = (n: Prisma.Decimal): Prisma.Decimal =>
  n.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/**
 * คำนวณยอดต่อบรรทัด — ราคาต่อหน่วยเป็นราคาก่อน VAT เสมอ (EXCLUSIVE)
 * รับ number literal จากตาราง ROWS ได้ แต่คูณ/ปัด/บวกใน Prisma.Decimal ทั้งหมด
 * และคืน Prisma.Decimal — ส่งเข้า create() ของคอลัมน์ Decimal ได้ตรง ๆ
 * (แสดงผลค่อย .toNumber() ที่จุด format เท่านั้น ห้ามเอาไปคำนวณต่อแบบ float)
 */
export function sumLine(
  unitPrice: number,
  qty: number,
  vatPct: number,
): { amountBeforeVat: Prisma.Decimal; vatAmount: Prisma.Decimal; total: Prisma.Decimal } {
  const amountBeforeVat = round2(new Prisma.Decimal(unitPrice).mul(qty));
  const vatAmount = round2(amountBeforeVat.mul(vatPct).div(100));
  return { amountBeforeVat, vatAmount, total: round2(amountBeforeVat.plus(vatAmount)) };
}

/**
 * เลขถัดไปจากเลขล่าสุด — pure จึงเทสได้โดยไม่ต้องแตะ DB
 * mirror แกนของ DocNumberService.next(): max+1 ไม่ใช่ count+1
 */
export function nextNumberFrom(prefix: string, lastNumber: string | null, width = 4): string {
  const lastSeq = lastNumber ? parseInt(lastNumber.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(width, '0')}`;
}

/**
 * เลขเอกสารถัดไปของ ExpenseDocument (EX- / PR-) — mirror DocNumberService.next()
 * โดยไม่ต้องลาก DI เข้าเฟส 2 · **ไม่กรอง deletedAt เหมือนของจริง** จึงไม่มีทางเกิดเลขซ้ำหลัง cleanup
 * โมเดลอื่น (OtherIncome / EquityDocument / FixedAsset) ทำ findFirst ของตัวเองแล้วส่งเข้า nextNumberFrom
 */
export async function nextDocNumber(
  prisma: PrismaService,
  prefixLetters: string,
  dateStr: string,
  width = 4,
): Promise<string> {
  const prefix = `${prefixLetters}-${dateStr}-`;
  const last = await prisma.expenseDocument.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  return nextNumberFrom(prefix, last?.number ?? null, width);
}
