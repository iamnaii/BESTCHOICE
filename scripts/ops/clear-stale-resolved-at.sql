-- ห้องที่ถูกปิด (resolved) แล้วลูกค้าทักกลับ: สถานะกลับเป็น ACTIVE แล้วแต่ resolved_at ยังค้าง
-- → หน้ากล่องข้อความโชว์ "แชทนี้ปิดแล้ว" + ซ่อนช่องพิมพ์ทั้งที่ลูกค้ากำลังคุย (พบ 26 ห้อง 2026-08-23)
-- โค้ดแก้แล้ว (room-manager ล้าง resolved_at ตอน reopen) — ไฟล์นี้ล้างของเก่าที่ค้างอยู่
BEGIN;
SELECT count(*) AS ห้องที่จะล้าง FROM chat_rooms
WHERE status='ACTIVE' AND resolved_at IS NOT NULL AND last_message_at > resolved_at AND deleted_at IS NULL;

UPDATE chat_rooms SET resolved_at = NULL, updated_at = NOW()
WHERE status='ACTIVE' AND resolved_at IS NOT NULL AND last_message_at > resolved_at AND deleted_at IS NULL;
COMMIT;

SELECT count(*) AS ยังค้าง FROM chat_rooms
WHERE status='ACTIVE' AND resolved_at IS NOT NULL AND last_message_at > resolved_at AND deleted_at IS NULL;
