-- Chat AI Hybrid C: add aiPaused state on ChatRoom + singleton AiSettings table.
-- Purely additive migration. No drops, no data backfill required (all new columns
-- have safe defaults or are nullable).

-- AlterTable: ChatRoom — AI pause state (staff take-over)
ALTER TABLE "chat_rooms"
  ADD COLUMN "ai_paused" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ai_paused_at" TIMESTAMP(3),
  ADD COLUMN "ai_paused_by_id" TEXT;

-- AddForeignKey: ChatRoom.aiPausedBy -> User
ALTER TABLE "chat_rooms"
  ADD CONSTRAINT "chat_rooms_ai_paused_by_id_fkey"
  FOREIGN KEY ("ai_paused_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: AiSettings (single-row, id = 'singleton')
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "sales_bot_mode" TEXT NOT NULL DEFAULT 'HYBRID',
    "service_bot_mode" TEXT NOT NULL DEFAULT 'HYBRID',
    "sales_bot_confidence_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.70,
    "service_bot_confidence_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: AiSettings.updatedBy -> User
ALTER TABLE "ai_settings"
  ADD CONSTRAINT "ai_settings_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
