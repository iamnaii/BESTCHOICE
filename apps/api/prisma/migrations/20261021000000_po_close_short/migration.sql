-- ปิดใบ รับไม่ครบ (คำตัดสินเจ้าของ 2026-10-11): สถานะใหม่ของใบสั่งซื้อ + ใคร/เมื่อไร/ทำไม
-- Additive only — ADD VALUE IF NOT EXISTS ปลอดภัยในทรานแซกชันเดียวกันตราบใดที่ไม่มีการอ้างอิงค่าใหม่ในไฟล์นี้
ALTER TYPE "POStatus" ADD VALUE IF NOT EXISTS 'CLOSED_SHORT';

ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "closed_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "close_reason" TEXT;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_closed_by_id_fkey"
  FOREIGN KEY ("closed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
