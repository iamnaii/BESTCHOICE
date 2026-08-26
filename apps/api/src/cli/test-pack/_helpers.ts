import type { PrismaService } from '../../prisma/prisma.service';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** คำนวณยอดต่อบรรทัด — ราคาต่อหน่วยเป็นราคาก่อน VAT เสมอ (EXCLUSIVE) */
export function sumLine(unitPrice: number, qty: number, vatPct: number) {
  const amountBeforeVat = round2(unitPrice * qty);
  const vatAmount = round2((amountBeforeVat * vatPct) / 100);
  return { amountBeforeVat, vatAmount, total: round2(amountBeforeVat + vatAmount) };
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
