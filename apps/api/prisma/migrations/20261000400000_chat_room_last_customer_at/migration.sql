-- เวลาข้อความล่าสุดของลูกค้า — ใช้คิดหน้าต่างตอบ 24 ชม. ของ Facebook (สเปก §8)
-- additive · nullable · ไม่ rewrite ตาราง · ค่าย้อนหลังเติมโดย reset-inbox-day-one.cli.ts
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "last_customer_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "chat_rooms_channel_last_customer_at_idx" ON "chat_rooms"("channel", "last_customer_at");
