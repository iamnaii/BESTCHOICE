-- ของแถมในสัญญาผ่อน (2026-09-20) — additive: สัญญาเดิมทุกใบได้ '{}' = ไม่มีของแถม
-- รูปเดียวกับ sales.bundle_product_ids (Prisma สร้าง scalar list เป็น TEXT[] DEFAULT ไม่มี NOT NULL)
ALTER TABLE "contracts" ADD COLUMN "bundle_product_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
