-- โน้ตปักหมุดของห้อง (ห้องละ 1)
ALTER TABLE "chat_notes" ADD COLUMN IF NOT EXISTS "pinned_at" TIMESTAMP(3);
ALTER TABLE "chat_notes" ADD COLUMN IF NOT EXISTS "pinned_by_id" TEXT;
CREATE INDEX IF NOT EXISTS "chat_notes_room_id_pinned_at_idx" ON "chat_notes"("room_id", "pinned_at");
