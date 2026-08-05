import { Prisma } from '@prisma/client';

export const CASH_LABEL = 'ราคาเงินสด';
export const INSTALLMENT_LABEL = 'ราคาผ่อน BESTCHOICE';
const INSTALLMENT_PREFIX = 'ราคาผ่อน';

/**
 * B0 §2.1 — write-through ทางเดียว: คอลัมน์ราคา (`Product.cashPrice` / `installmentPrice`) → แถว `ProductPrice`
 *
 * ผู้อ่าน prices[] ที่ยัง load-bearing: POS, เครื่องคิดเงินสัญญา, stock-overview
 * margin, บอท (`where:{isDefault:true} take:1` **ไม่มี orderBy**) — จึงต้องรับประกัน
 * ว่าหลังเขียนเสร็จมีแถว isDefault **แถวเดียว** เสมอ ไม่งั้น take:1 ได้แถวสุ่ม
 *
 * ต้องเรียกภายใน tx ของ caller เท่านั้น (atomic กับการเขียนคอลัมน์) — util นี้ไม่เปิด tx เอง
 *
 * ลำดับคำสั่งสำคัญ: unset default เดิมทั้งหมดก่อน แล้วค่อยตั้งแถวเป้าหมายเป็น default
 * เสมอ (ห้ามสลับ) — ตาราง `product_prices` มี partial unique index
 * `product_prices_one_default` (`UNIQUE (product_id) WHERE is_default AND deleted_at IS NULL`,
 * migration `20260982000000`) ที่ตรวจทันทีหลังแต่ละ statement ใน Postgres จริง ถ้า
 * create/update แถวใหม่เป็น default ขณะแถวเก่ายังเป็น default อยู่ (ยังไม่ถูกปลด) จะได้
 * P2002 ทันที ไม่ใช่แค่ข้อมูลเพี้ยน — pattern เดียวกับ `ProductsPricingService.addPrice`/
 * `updatePrice` (unset-other-defaults ด้วย `updateMany` ก่อนเสมอ)
 *
 * Fix round 1 [Important 1]: ค่าที่ **ไม่เป็นบวก** (`0` หรือติดลบ) ปฏิบัติเหมือน `null` เป๊ะ
 * — ถือว่า "ยืนยันว่าไม่มีราคา" ข้าม sync ทั้งหมด (ไม่ relabel/overwrite แถวเดิม, ไม่สร้างแถว
 * ใหม่) นี่คือฝาแฝดฝั่ง **เขียน** ของบั๊กที่ Task 1 แก้ฝั่ง **อ่าน** แล้ว (`getPositiveDisplayPrices`
 * ใน `apps/web` ที่ short-circuit เฉพาะ `!= null` เดิมปล่อยให้คอลัมน์ `0` ชนะ label chain) —
 * ถ้าไม่กันตรงนี้ ส่ง `Decimal('0')` เข้ามาจะ relabel+overwrite แถว default เดิม (เช่น
 * `'ราคาขาย'` 17,000) ให้กลายเป็นแถว default เดียวราคา 0 ⇒ ผู้อ่านที่ `take:1` (POS/บอท/margin)
 * ควอต 0 บาทให้ลูกค้าทันที ปิดที่ util นี้เพราะเป็นคอขวดจุดเดียวที่ caller ทั้ง 3 ทาง
 * (products.service / po-receiving / repossessions) inherit การกันนี้ไปฟรีโดยไม่ต้องแก้แยก
 */
function isUsablePrice(value: Prisma.Decimal | null | undefined): value is Prisma.Decimal {
  return value !== undefined && value !== null && value.gt(0);
}

export async function syncPriceRowsFromColumns(
  tx: Prisma.TransactionClient,
  productId: string,
  columns: { cashPrice?: Prisma.Decimal | null; installmentPrice?: Prisma.Decimal | null },
): Promise<{ cashRowId: string | null; installmentRowId: string | null }> {
  const hasCash = isUsablePrice(columns.cashPrice);
  const hasInstallment = isUsablePrice(columns.installmentPrice);
  if (!hasCash && !hasInstallment) return { cashRowId: null, installmentRowId: null };

  const rows = await tx.productPrice.findMany({
    where: { productId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });

  let cashRowId: string | null = null;
  let installmentRowId: string | null = null;

  // Phase 1 — upsert label + amount เท่านั้น ยังไม่แตะ isDefault ของแถวเป้าหมาย
  // (แถวที่ update-in-place อาจเป็น default อยู่แล้ว — ปล่อยค่าเดิมไว้ก่อน ยังไม่ conflict
  // เพราะเป็นแถวเดียวกัน; แถวที่ create ใหม่สร้างเป็น isDefault:false เสมอ กันชนแถว default
  // เดิมที่ยังไม่ถูกปลดใน phase นี้)
  if (hasCash) {
    const amount = columns.cashPrice as Prisma.Decimal;
    const exact = rows.find((r) => r.label === CASH_LABEL);
    const defaultRow = rows.find((r) => r.isDefault && !r.label.startsWith(INSTALLMENT_PREFIX));
    const target = exact ?? defaultRow;
    if (target) {
      await tx.productPrice.update({
        where: { id: target.id },
        data: { amount, label: CASH_LABEL },
      });
      cashRowId = target.id;
    } else {
      const created = await tx.productPrice.create({
        data: { productId, label: CASH_LABEL, amount, isDefault: false },
      });
      cashRowId = created.id;
    }
  }

  if (hasInstallment) {
    const amount = columns.installmentPrice as Prisma.Decimal;
    const exact = rows.find((r) => r.label === INSTALLMENT_LABEL);
    if (exact) {
      await tx.productPrice.update({ where: { id: exact.id }, data: { amount } });
      installmentRowId = exact.id;
    } else {
      const created = await tx.productPrice.create({
        data: { productId, label: INSTALLMENT_LABEL, amount, isDefault: false },
      });
      installmentRowId = created.id;
    }
  }

  // Phase 2 — บังคับ default เดียว: แถวเงินสดชนะเสมอถ้ามี; ถ้าไม่มีแถวเงินสดและก่อนหน้านี้
  // ยังไม่มี default ใดๆ เลย (สินค้าที่ยังไม่เคยมีแถวราคา) ใช้แถวผ่อนแทน
  const keepDefaultId =
    cashRowId ?? (rows.some((r) => r.isDefault) ? null : installmentRowId);

  if (keepDefaultId) {
    // ปลด default เดิมทั้งหมดก่อนเสมอ (รวมแถวที่ยังไม่ถูกแตะใน phase 1 ถ้ามี) แล้วค่อยตั้ง
    // แถวเป้าหมายเป็น default ทีหลัง — ห้ามสลับลำดับ (ดู doc comment ด้านบน)
    await tx.productPrice.updateMany({
      where: { productId, isDefault: true, id: { not: keepDefaultId }, deletedAt: null },
      data: { isDefault: false },
    });
    await tx.productPrice.update({ where: { id: keepDefaultId }, data: { isDefault: true } });
  }

  return { cashRowId, installmentRowId };
}
