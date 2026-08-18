-- ล้างธง handoff ค้างยุคทดสอบ (2026-05-13/21 + AI ไม่มั่นใจ 2026-07-03) — 77 ห้อง
-- ห้องพวกนี้บอทถูกปิดปากถาวรมา 3 เดือน ไม่มี cron ล้าง; whitelist ยังคุมอยู่
-- (FB_BOT_DISABLED=true) การล้างธงจึงยังไม่ทำให้บอทตอบใครเพิ่มจนกว่าจะเปิดเพจ
BEGIN;

-- แสดงก่อนล้าง
SELECT handoff_reason, count(*) FROM chat_rooms
WHERE handoff_mode = true AND deleted_at IS NULL
  AND (handoff_reason LIKE 'Bot paused%' OR handoff_reason = 'router_handoff'
       OR (handoff_reason LIKE '%ไม่มั่นใจ%' AND handoff_tagged_at < NOW() - INTERVAL '14 days'))
GROUP BY handoff_reason;

UPDATE chat_rooms SET
  handoff_mode = false,
  handoff_reason = NULL,
  handoff_tagged_at = NULL,
  updated_at = NOW()
WHERE handoff_mode = true AND deleted_at IS NULL
  AND (handoff_reason LIKE 'Bot paused%' OR handoff_reason = 'router_handoff'
       OR (handoff_reason LIKE '%ไม่มั่นใจ%' AND handoff_tagged_at < NOW() - INTERVAL '14 days'));

COMMIT;

SELECT count(*) AS remaining_handoff_rooms FROM chat_rooms WHERE handoff_mode = true AND deleted_at IS NULL;
