-- Task 30 รอบ 8 I5 — ข้อความกฎ "รับสาย + นัดชำระ" (CALL_ANSWERED_PROMISE) ไม่มีลิงก์ชำระแนบแล้ว
-- (หน้า /pay/:token จ่ายลิงก์ที่ยอดไม่ใช่ยอดคงค้างของงวดเดียวไม่ได้ — DunningEngineService ไม่แนบลิงก์ให้ยอดนัด)
-- ⇒ เอาคำว่า "ผ่านลิงก์ด้านล่าง" ออกจากแม่แบบที่ seed ไว้ · แก้เฉพาะแถวที่ยังเป็นข้อความ seed เดิมทุกตัวอักษร (ข้อความที่เจ้าของแก้แล้วไม่แตะ)
-- idempotent: รันซ้ำไม่มีแถวตรงเงื่อนไข
UPDATE "dunning_rules"
SET "message_template" = 'ขอบคุณที่รับสาย กรุณาชำระยอด {{amount}} ฿ ภายใน {{settlementDate}}',
    "updated_at" = NOW()
WHERE "event_trigger" = 'CALL_ANSWERED_PROMISE'
  AND "message_template" = 'ขอบคุณที่รับสาย กรุณาชำระยอด {{amount}} ฿ ภายใน {{settlementDate}} ผ่านลิงก์ด้านล่าง';
