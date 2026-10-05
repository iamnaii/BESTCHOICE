-- PR 2 ล็อกเครื่องเมื่อรับมัดจำ (spec 2026-10-05 §4 §5.1 §5.5) — additive ทั้งหมด ไม่มี backfill (prod 0 ใบ)
-- คอลัมน์ของ PR 4 (source_room_id) และ PR 6 (expiry_reminder_*) เพิ่มมาด้วยตาม §5.5 เพื่อให้ migration ชุดนี้ครบในรอบเดียว
ALTER TABLE "bookings"
  ADD COLUMN "locked_product_id" TEXT,
  ADD COLUMN "locked_at" TIMESTAMP(3),
  ADD COLUMN "unlocked_at" TIMESTAMP(3),
  ADD COLUMN "source_room_id" TEXT,
  ADD COLUMN "expiry_reminder_sent_at" TIMESTAMP(3),
  ADD COLUMN "expiry_reminder_skip_reason" TEXT;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_locked_product_id_fkey"
  FOREIGN KEY ("locked_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "bookings_locked_product_id_idx" ON "bookings"("locked_product_id");

-- หนึ่งล็อกต่อหนึ่งเครื่อง (ใบที่ยังไม่ถูกลบ) — Prisma schema แสดงไม่ได้ ดูคอมเมนต์ที่ model Booking
CREATE UNIQUE INDEX "bookings_locked_product_active_unique"
  ON "bookings"("locked_product_id")
  WHERE "locked_product_id" IS NOT NULL AND "deleted_at" IS NULL;
