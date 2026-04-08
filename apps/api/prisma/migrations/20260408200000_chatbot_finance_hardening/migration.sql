-- Chatbot Finance Hardening Migration
-- - Add reference_key + unique constraint to chat_auto_triggers (race condition fix)
-- - Add chatbot_otp_requests table (multi-instance OTP storage)
-- Created: 2026-04-08

-- ============================================================
-- ChatAutoTrigger: add reference_key + unique constraint
-- ============================================================
-- Step 1: add nullable column
ALTER TABLE "chat_auto_triggers"
  ADD COLUMN IF NOT EXISTS "reference_key" TEXT;

-- Step 2: backfill existing rows from payload (if any)
UPDATE "chat_auto_triggers"
   SET "reference_key" = trigger_type::text || ':' || COALESCE(payload->>'paymentId', id)
 WHERE "reference_key" IS NULL;

-- Step 3: enforce NOT NULL
ALTER TABLE "chat_auto_triggers"
  ALTER COLUMN "reference_key" SET NOT NULL;

-- Step 4: unique constraint (idempotent — drop+add)
ALTER TABLE "chat_auto_triggers"
  DROP CONSTRAINT IF EXISTS "chat_auto_triggers_customer_id_reference_key_key";

ALTER TABLE "chat_auto_triggers"
  ADD CONSTRAINT "chat_auto_triggers_customer_id_reference_key_key"
  UNIQUE ("customer_id", "reference_key");

-- ============================================================
-- ChatbotOtpRequest: new table
-- ============================================================
CREATE TABLE IF NOT EXISTS "chatbot_otp_requests" (
  "id" TEXT NOT NULL,
  "line_user_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_request_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chatbot_otp_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "chatbot_otp_requests_line_user_id_key"
  ON "chatbot_otp_requests"("line_user_id");

CREATE INDEX IF NOT EXISTS "chatbot_otp_requests_expires_at_idx"
  ON "chatbot_otp_requests"("expires_at");
