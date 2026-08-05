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

-- Fix round 1 [Important]: migration นี้ถอยไม่ได้ (ALTER TYPE ADD VALUE ไม่มี DROP VALUE) —
-- ถ้าเลือกแถวผิดบน prod (เช่น dup เยอะกว่าที่คาด) จะไม่มีทางรู้ว่า flip แถวไหนจากอะไร ต้องมี
-- ตารางสำรองก่อน UPDATE เหมือน precedent B0 (20260982000000, "_b0_default_price_dedupe_backup").
-- IF NOT EXISTS + "... AS SELECT" เป็น no-op ถ้าตารางมีอยู่แล้ว (Postgres ไม่รัน SELECT ซ้ำ) —
-- idempotent เหมือน CREATE UNIQUE INDEX IF NOT EXISTS ด้านล่าง. WHERE ต้องตรงกับ UPDATE เป๊ะ
-- (ก็อปมาจากเงื่อนไข UPDATE ด้านล่างตรงๆ ไม่ derive ทีหลัง กันสองเงื่อนไขเพี้ยนออกจากกัน)
CREATE TABLE IF NOT EXISTS "_b5_active_hold_dedupe_backup" AS
SELECT p.id, p.product_id, p.status, p.reserved_at, now() AS backed_up_at
FROM "product_reservations" p
WHERE p."status" = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM "product_reservations" q
    WHERE q."product_id" = p."product_id"
      AND q."status" = 'ACTIVE'
      AND (q."reserved_at", q."id") > (p."reserved_at", p."id")
  );

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
-- IF NOT EXISTS (PG12+): ทำให้ migration นี้ re-apply ได้ปลอดภัยหลัง revert-local-DB-then-reapply
-- ระหว่าง fix round (ค่า enum เพิ่มแล้วถอยไม่ได้ — รันซ้ำแบบไม่มี IF NOT EXISTS จะ error "already exists")
ALTER TYPE "OnlineOrderStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_RECEIVED_UNFULFILLABLE';
