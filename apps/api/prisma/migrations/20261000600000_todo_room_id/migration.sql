-- นัดหมายของห้องแชท: Todo ผูกกับ chat_rooms ได้ (nullable · ลบห้องแล้วนัดยังอยู่แต่หลุดจากห้อง)
ALTER TABLE "todos" ADD COLUMN IF NOT EXISTS "room_id" TEXT;
CREATE INDEX IF NOT EXISTS "todos_room_id_idx" ON "todos"("room_id");
DO $$ BEGIN
  ALTER TABLE "todos" ADD CONSTRAINT "todos_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
