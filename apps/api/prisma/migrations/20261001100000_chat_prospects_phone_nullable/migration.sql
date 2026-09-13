-- ผู้สนใจจากแชท (docs/superpowers/specs/2026-09-13-chat-prospects-design.md)
-- 1) เบอร์ว่างได้เฉพาะแถว placeholder ที่สร้างจากห้องแชท — โค้ดกันไม่ให้ล้างเบอร์ของคนที่มีเบอร์แล้ว
ALTER TABLE "customers" ALTER COLUMN "phone" DROP NOT NULL;

-- 2) คำใบ้ "อาจเป็นคนเดียวกัน" ที่ถูกกด "ไม่ใช่" (เก็บ customer id) — ไม่ถามซ้ำ
ALTER TABLE "chat_rooms" ADD COLUMN "dismissed_same_person_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
