-- B5: กันขายซ้ำเว็บ ↔ หน้าร้าน
-- (1) ธงกันแจ้งซ้ำเมื่อ hold โดนตัดหน้า  (2) กัน hold ACTIVE ซ้อนต่อเครื่อง  (3) สถานะ "เงินเข้าแต่ของไม่มี"

ALTER TABLE "product_reservations" ADD COLUMN "preempt_notified_at" TIMESTAMP(3);

-- hold ที่โดนตัดหน้าไปแล้วก่อน deploy นี้ = ถือว่าแจ้งแล้ว (กัน cron ยิง LINE ย้อนหลังเป็นพรวด)
UPDATE "product_reservations" SET "preempt_notified_at" = NOW() WHERE "status" = 'PREEMPTED';

CREATE INDEX "product_reservations_status_preempt_notified_at_idx"
  ON "product_reservations"("status", "preempt_notified_at");

-- B5: reserve() เป็น check-then-act (findFirst แล้วค่อย create) และตารางนี้มีแค่
-- @@index([product_id, status]) ที่ไม่ unique → สอง request พร้อมกันสร้าง hold ACTIVE
-- ซ้อนบนเครื่องเดียวกันได้ ป้องกันชั้นสุดท้ายที่ระดับ DB:
--   1) ล้างข้อมูลเก่าก่อน (เก็บ hold ล่าสุดต่อเครื่อง ที่เหลือเป็น EXPIRED)
--   2) ค่อยสร้าง partial unique index
-- คอลัมน์จริงในตารางคือ product_id / status (ยืนยันจาก 20260529100000_add_shop_phase1_tables)
UPDATE "product_reservations" p SET "status" = 'EXPIRED'
WHERE p."status" = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM "product_reservations" q
    WHERE q."product_id" = p."product_id"
      AND q."status" = 'ACTIVE'
      AND (q."reserved_at", q."id") > (p."reserved_at", p."id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "product_reservations_active_product_idx"
  ON "product_reservations"("product_id")
  WHERE "status" = 'ACTIVE';

-- ต้องเป็น statement สุดท้าย: Postgres ห้ามใช้ค่า enum ใหม่ใน transaction เดียวกับที่เพิ่มค่า
ALTER TYPE "OnlineOrderStatus" ADD VALUE 'PAYMENT_RECEIVED_UNFULFILLABLE';
