-- ปลดธง "รอพนักงาน" ของห้องทดสอบ 3 คน (whitelist) เพื่อให้บอทกลับมาตอบ
BEGIN;
SELECT display_name, handoff_mode, handoff_reason FROM chat_rooms
WHERE external_user_id IN ('8830107663706216','8355380127892529','29329154600008963') AND deleted_at IS NULL;

UPDATE chat_rooms SET
  handoff_mode = false, handoff_reason = NULL, handoff_tagged_at = NULL,
  ai_paused = false, ai_paused_at = NULL, ai_paused_by_id = NULL,
  updated_at = NOW()
WHERE external_user_id IN ('8830107663706216','8355380127892529','29329154600008963')
  AND deleted_at IS NULL AND (handoff_mode OR ai_paused);
COMMIT;

SELECT display_name, ai_paused AS ปิดAI, handoff_mode AS รอพนักงาน FROM chat_rooms
WHERE external_user_id IN ('8830107663706216','8355380127892529','29329154600008963') AND deleted_at IS NULL;
