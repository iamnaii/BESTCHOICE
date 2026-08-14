-- ล้างธง handoff ของห้องทดสอบ whitelist ทั้ง 3 (ใช้ซ้ำได้ระหว่างช่วงเทสบอท)
-- ธงเกิดได้จาก: capture_lead (ตั้งใจ), AI ไม่มั่นใจ/โดน guard บล็อก (ไม่ตั้งใจ — ล้างได้)
UPDATE chat_rooms
SET handoff_mode = FALSE, handoff_reason = NULL, updated_at = NOW()
WHERE external_user_id IN ('8830107663706216','8355380127892529','29329154600008963')
  AND handoff_mode = TRUE
RETURNING display_name, 'ล้างธงแล้ว' AS result;
