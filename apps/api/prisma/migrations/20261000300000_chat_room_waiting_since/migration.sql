-- "รอตอบตั้งแต่" (สเปก docs/superpowers/specs/2026-09-05-inbox-day-one-readiness-design.md §4)
--
-- วัด prod 2026-09-05: ลูกค้าที่ข้อความสุดท้ายเป็นของลูกค้าและไม่มีใครตอบ 231 ห้อง/30 วัน
-- ถูก cron ซ่อนเป็น IDLE 222 ห้อง เพราะระบบไม่มีข้อมูล "ลูกค้ารอตอบอยู่ตอนนี้" เลย
-- (unread_count ล้างตอนเปิดห้อง · first_response_at ตั้งครั้งเดียวต่อห้อง)
--
-- additive ล้วน: nullable ไม่มี default ⇒ ไม่ rewrite ตาราง · ห้องเก่าทุกห้องเป็น NULL = ไม่ได้รอ
-- ค่าเริ่มต้นสำหรับห้องที่รออยู่จริง ณ วันเปิดใช้ ใส่ด้วย CLI reset-inbox-day-one (ไม่ backfill ใน migration)
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "waiting_since" TIMESTAMP(3);

-- แท็บ "รอตอบ" กรอง waiting_since IS NOT NULL และเรียง waiting_since ASC
CREATE INDEX IF NOT EXISTS "chat_rooms_waiting_since_idx"
  ON "chat_rooms" ("waiting_since");
