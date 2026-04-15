-- Room-Based Chat Refactor: ChatSession → ChatRoom
-- + Warranty system fields
-- + AI Training / Auto Reply models (if not already applied)

-- 1. Rename chat_sessions table → chat_rooms
ALTER TABLE IF EXISTS "chat_sessions" RENAME TO "chat_rooms";

-- 2. Rename session_id columns → room_id across all related tables
ALTER TABLE IF EXISTS "chat_messages" RENAME COLUMN "session_id" TO "room_id";
ALTER TABLE IF EXISTS "conversation_tags" RENAME COLUMN "session_id" TO "room_id";
ALTER TABLE IF EXISTS "chat_notes" RENAME COLUMN "session_id" TO "room_id";
ALTER TABLE IF EXISTS "chat_feedbacks" RENAME COLUMN "session_id" TO "room_id";
ALTER TABLE IF EXISTS "chat_snoozes" RENAME COLUMN "session_id" TO "room_id";
ALTER TABLE IF EXISTS "chat_side_messages" RENAME COLUMN "session_id" TO "room_id";
ALTER TABLE IF EXISTS "ai_training_pairs" RENAME COLUMN "session_id" TO "room_id";
ALTER TABLE IF EXISTS "ai_auto_reply_logs" RENAME COLUMN "session_id" TO "room_id";

-- 3. Remove session_status, add room status
ALTER TABLE "chat_rooms" DROP COLUMN IF EXISTS "session_status";
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- 4. Add room features: pin, unread count
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "pinned_at" TIMESTAMP(3);
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "pinned_by_id" TEXT;
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "unread_count" INTEGER NOT NULL DEFAULT 0;

-- 5. Add read receipt per message
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP(3);

-- 6. Warranty fields
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "shop_warranty_days" INTEGER;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "shop_warranty_start_date" TIMESTAMP(3);
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "shop_warranty_end_date" TIMESTAMP(3);

-- 7. MDM locked at (if not already applied)
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "mdm_locked_at" TIMESTAMP(3);

-- 8. Lead score fields on chat_rooms (if not already applied)
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "lead_score" INTEGER;
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "lead_temperature" TEXT;
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "attribution_id" TEXT;

-- 9. AI Training Pairs table (if not exists)
CREATE TABLE IF NOT EXISTS "ai_training_pairs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "room_id" TEXT,
    "customer_message" TEXT NOT NULL,
    "ai_draft" TEXT,
    "human_edit" TEXT,
    "intent" TEXT,
    "quality" DOUBLE PRECISION,
    "used_in_prompt" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_training_pairs_pkey" PRIMARY KEY ("id")
);

-- 10. AI Auto Reply Logs table (if not exists)
CREATE TABLE IF NOT EXISTS "ai_auto_reply_logs" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "customer_message" TEXT NOT NULL,
    "ai_reply" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "auto_sent" BOOLEAN NOT NULL,
    "handoff_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_auto_reply_logs_pkey" PRIMARY KEY ("id")
);

-- 11. Indexes
CREATE INDEX IF NOT EXISTS "chat_rooms_lead_score_idx" ON "chat_rooms"("lead_score");
CREATE INDEX IF NOT EXISTS "chat_rooms_pinned_at_idx" ON "chat_rooms"("pinned_at");
CREATE INDEX IF NOT EXISTS "chat_rooms_last_message_at_idx" ON "chat_rooms"("last_message_at");
CREATE INDEX IF NOT EXISTS "ai_training_pairs_intent_quality_idx" ON "ai_training_pairs"("intent", "quality");
CREATE INDEX IF NOT EXISTS "ai_training_pairs_source_idx" ON "ai_training_pairs"("source");
CREATE INDEX IF NOT EXISTS "ai_training_pairs_created_at_idx" ON "ai_training_pairs"("created_at");
CREATE INDEX IF NOT EXISTS "ai_auto_reply_logs_room_id_idx" ON "ai_auto_reply_logs"("room_id");
CREATE INDEX IF NOT EXISTS "ai_auto_reply_logs_auto_sent_created_idx" ON "ai_auto_reply_logs"("auto_sent", "created_at");
