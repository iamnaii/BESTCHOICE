-- เจ้าของสั่งถอดแม่แบบไลน์ "ประกันใกล้หมด 7 วัน" (2026-09-27) — แม่แบบนี้ seed แบบปิดไว้ใน
-- 20261011100000_seed_after_sales_line_templates และไม่เคยเปิดใช้/ไม่เคยส่ง (notification_logs
-- ที่ related_id 'warranty:%' = 0 แถวบน prod ณ 2026-09-27). โค้ดตัวไล่ส่ง (WarrantyCron +
-- WarrantyLineNotifierService) ถูกลบในคอมมิตเดียวกัน.
--
-- soft delete ตามกติกา (ห้าม hard delete) · event_type เป็น @unique เต็มตาราง ⇒ ถ้าวันหน้าจะใช้
-- event type นี้อีกต้องชุบแถวนี้คืน (ตั้ง deleted_at = NULL) ไม่ใช่ INSERT ใหม่ · รันซ้ำได้
UPDATE "notification_templates"
SET "is_active" = false,
    "deleted_at" = NOW(),
    "updated_at" = NOW()
WHERE "event_type" = 'WARRANTY_EXPIRING_7D'
  AND "deleted_at" IS NULL;
