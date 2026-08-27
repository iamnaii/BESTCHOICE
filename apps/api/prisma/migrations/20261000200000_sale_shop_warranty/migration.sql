-- ประกันร้านบนใบขาย (คำสั่งเจ้าของ 2026-08-27)
--
-- เดิมวันประกันร้านมีที่เก็บเดียวคือคอลัมน์ชื่อเดียวกันบนตาราง contracts ⇒ ขายสด /
-- ไฟแนนซ์นอกซึ่งไม่มีสัญญา ไม่มีที่เก็บเลย ลูกค้ากลุ่มนี้จึงได้ประกันร้าน 0 วันในระบบ
--
-- additive ล้วน: nullable ทั้งคู่ ไม่มี default ⇒ ไม่ rewrite ตาราง และใบขายเก่าทุกใบ
-- ยังเป็น NULL ซึ่งผู้อ่านตีความว่า "ไม่มีประกันร้าน" เหมือนเดิมทุกประการ (forward-only
-- ไม่ backfill — ใบขายเก่าไม่เคยสัญญาประกันร้านกับลูกค้าไว้)
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "shop_warranty_start_date" TIMESTAMP(3);
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "shop_warranty_end_date" TIMESTAMP(3);

-- ใช้โดยหน้าเช็คประกัน/คิวประกันใกล้หมด ที่กรองด้วยช่วงวันหมดอายุ
CREATE INDEX IF NOT EXISTS "sales_shop_warranty_end_date_idx"
  ON "sales" ("shop_warranty_end_date");
