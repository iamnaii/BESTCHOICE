-- Phase A SHOP Sales AI: add observability metadata to AI auto-reply logs.
-- Tracks intent classification, MCP tool usage, and token counts per turn
-- so we can monitor confidence, cost, and behavior over time.
-- All columns nullable / defaulted so existing rows remain valid.
-- AlterTable
ALTER TABLE "ai_auto_reply_logs"
  ADD COLUMN "intent" TEXT,
  ADD COLUMN "tools_used" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "input_tokens" INTEGER,
  ADD COLUMN "output_tokens" INTEGER;
