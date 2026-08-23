-- ช่วงทดสอบ (คำสั่งเจ้าของ 2026-08-23 "อยากทดสอบก่อน อย่าเพิ่งติดสถานะ"):
-- ปิดการขายแล้วไม่ปักธง "รอพนักงาน" → บอทคุยต่อได้ · ก่อน go-live ต้องตั้งกลับเป็น 'true' (หรือลบแถว)
INSERT INTO system_config (id, key, value, label, created_at, updated_at)
VALUES (gen_random_uuid(), 'shop_bot_lead_handoff_enabled', 'false', 'SHOP Bot: ปักธงรอพนักงานหลังเก็บ lead (false = ช่วงทดสอบ)', NOW(), NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), deleted_at = NULL;
SELECT key, value, updated_at::timestamp(0) FROM system_config WHERE key = 'shop_bot_lead_handoff_enabled';
