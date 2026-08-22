-- แก้ผลกระทบบั๊ก echo-pause (2026-08-16 → 2026-08-21):
-- ข้อความทักทายอัตโนมัติของเพจถูกตีความว่าพนักงาน takeover → ปิด AI ไป 633 ห้อง
-- ปลดเฉพาะห้องที่ "ระบบสั่งเอง" (ai_paused_by_id IS NULL) — ห้องที่พนักงานกดปุ่มเองไม่แตะ
BEGIN;

SELECT count(*) AS ห้องที่จะปลด FROM chat_rooms
WHERE ai_paused = true AND deleted_at IS NULL AND ai_paused_by_id IS NULL;

UPDATE chat_rooms SET
  ai_paused = false,
  ai_paused_at = NULL,
  updated_at = NOW()
WHERE ai_paused = true AND deleted_at IS NULL AND ai_paused_by_id IS NULL;

COMMIT;

SELECT
  count(*) FILTER (WHERE ai_paused) AS ยังปิดอยู่,
  count(*) FILTER (WHERE ai_paused AND ai_paused_by_id IS NOT NULL) AS พนักงานกดเอง
FROM chat_rooms WHERE deleted_at IS NULL;
