/**
 * READ-ONLY survey — B0 gate (spec §9.1)
 *
 * คำถามที่ต้องตอบ: `PricingTemplate.installmentBestchoicePrice` คือ
 *   (ก) ค่างวดต่อเดือน  — sticker/บอทตีความแบบนี้ (StickerPrintPage.tsx:152 render 'X ฿ × N ด.')
 *   (ข) ราคาเต็มสำหรับผ่อน — import help ฝั่งแอดมินสื่อแบบนี้
 * ตัวชี้: อัตราส่วน installmentBestchoicePrice / cashPrice
 *   ~0.05-0.25  → เกือบแน่ว่าเป็น "ต่อเดือน"
 *   ~1.0-1.6    → เกือบแน่ว่าเป็น "ราคารวม"
 * เช็คซ้ำ: installmentBestchoicePrice × rate1TermMonths + rate1DownPayment ≈ กี่เท่าของ cashPrice
 *
 * รัน: DATABASE_URL=... npm --prefix apps/api run survey:pricing-templates
 *
 * ห้ามมี update/create/delete ในไฟล์นี้ — read-only 100%
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.pricingTemplate.findMany({
    where: { deletedAt: null },
    orderBy: [{ brand: 'asc' }, { model: 'asc' }, { storage: 'asc' }],
  });

  const buckets = { perMonthLike: 0, nearCash: 0, totalLike: 0, unusable: 0 };
  const samples: Record<string, unknown>[] = [];

  // B0: นับ "คู่ประกัน" ต่อ (brand, model, storage) ของหมวดมือสอง —
  // ถ้าคีย์ไหนมีทั้งแถว hasWarranty=true และ false = autofill เดินสาย ambiguous
  // (เทมเพลตมาตรฐานที่ระบบแจกให้กรอกมี 2 แถวต่อรุ่นมือสองพอดี —
  //  PricingTemplatesPage.tsx:147-149 'มีประกัน' + 'ไม่มีประกัน') → เจ้าของต้องเห็นว่า
  //  ถ้าไม่ทำ fallback เครื่องเทิร์นเกือบทุกเครื่องจะไม่ได้ราคาเลย
  const usedKeys = new Map<string, Set<boolean>>();
  for (const t of rows) {
    if (t.category !== 'PHONE_USED' || !t.isActive || t.deletedAt) continue;
    const k = `${t.brand}|${t.model}|${t.storage}`;
    if (!usedKeys.has(k)) usedKeys.set(k, new Set());
    usedKeys.get(k)!.add(Boolean(t.hasWarranty));
  }
  const usedWarrantyPairs = {
    keysTotal: usedKeys.size,
    keysWithBothWarrantyVariants: [...usedKeys.values()].filter((s) => s.size > 1).length,
    keysWithSingleVariant: [...usedKeys.values()].filter((s) => s.size === 1).length,
  };

  for (const t of rows) {
    const cash = Number(t.cashPrice);
    const inst = Number(t.installmentBestchoicePrice);
    if (!(cash > 0) || !(inst > 0)) {
      buckets.unusable++;
      continue;
    }
    const ratio = inst / cash;
    if (ratio < 0.5) buckets.perMonthLike++;
    else if (ratio <= 1.05) buckets.nearCash++;
    else buckets.totalLike++;

    if (samples.length < 12) {
      const term = t.rate1TermMonths ?? null;
      const down = t.rate1DownPayment != null ? Number(t.rate1DownPayment) : null;
      samples.push({
        brand: t.brand,
        model: t.model,
        storage: t.storage,
        category: t.category,
        hasWarranty: t.hasWarranty,
        cashPrice: cash,
        installmentBestchoicePrice: inst,
        ratio: Number(ratio.toFixed(4)),
        rate1TermMonths: term,
        rate1DownPayment: down,
        impliedTotalIfPerMonth:
          term != null ? Number((inst * term + (down ?? 0)).toFixed(2)) : null,
        impliedTotalOverCash:
          term != null ? Number(((inst * term + (down ?? 0)) / cash).toFixed(4)) : null,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        totalRows: rows.length,
        activeRows: rows.filter((r) => r.isActive).length,
        buckets,
        usedWarrantyPairs,
        verdictHint:
          buckets.perMonthLike > buckets.totalLike
            ? 'ส่วนใหญ่ดูเป็น "ค่างวดต่อเดือน" (PER_MONTH)'
            : 'ส่วนใหญ่ดูเป็น "ราคารวม" (TOTAL)',
        samples,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
