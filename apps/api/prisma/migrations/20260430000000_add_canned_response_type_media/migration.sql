-- Add response_type + media_url columns to canned_responses
-- Schema drift: schema.prisma has these fields but prior migration
-- (20260412200000_add_unified_chat_engine) never created them, so fresh
-- CI databases fail with P2022 "column response_type does not exist" when
-- seed.ts calls prisma.cannedResponse.upsert() (Prisma sends the default
-- value "text" and the unknown mediaUrl column to Postgres).

ALTER TABLE "canned_responses"
  ADD COLUMN IF NOT EXISTS "response_type" TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS "media_url" TEXT;
