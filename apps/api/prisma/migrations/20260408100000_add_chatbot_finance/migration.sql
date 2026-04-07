-- Chatbot Finance Bot Migration (idempotent)
-- Created: 2026-04-08

-- ============================================================
-- Enums (idempotent via DO block)
-- ============================================================
DO $$ BEGIN
  CREATE TYPE "LineChannelType" AS ENUM ('SHOP', 'FINANCE', 'STAFF');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ChatChannel" AS ENUM ('LINE_FINANCE', 'LINE_SHOP', 'FACEBOOK', 'TIKTOK');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ChatStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'BLOCKED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "MessageRole" AS ENUM ('CUSTOMER', 'BOT', 'STAFF', 'AUTO_TRIGGER', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'FILE', 'STICKER', 'LOCATION', 'TEMPLATE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AutoTriggerType" AS ENUM (
    'REMINDER_T_MINUS_5','REMINDER_T_MINUS_3','REMINDER_T_MINUS_1','REMINDER_T_DAY',
    'ESCALATION_T_PLUS_1','ESCALATION_T_PLUS_3','HOLIDAY_WARNING','RECEIPT_DELIVERY','CUSTOM_BROADCAST'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "TriggerStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================
-- Customer: chat consent fields
-- ============================================================
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "chat_consent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "chat_consent_at" TIMESTAMP(3);

-- ============================================================
-- CustomerLineLink
-- ============================================================
CREATE TABLE IF NOT EXISTS "customer_line_links" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "line_user_id" TEXT NOT NULL,
  "channel" "LineChannelType" NOT NULL,
  "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unlinked_at" TIMESTAMP(3),
  CONSTRAINT "customer_line_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_line_links_line_user_id_channel_key"
  ON "customer_line_links"("line_user_id", "channel");
CREATE UNIQUE INDEX IF NOT EXISTS "customer_line_links_customer_id_channel_key"
  ON "customer_line_links"("customer_id", "channel");
CREATE INDEX IF NOT EXISTS "customer_line_links_customer_id_idx" ON "customer_line_links"("customer_id");
CREATE INDEX IF NOT EXISTS "customer_line_links_line_user_id_idx" ON "customer_line_links"("line_user_id");

DO $$ BEGIN
  ALTER TABLE "customer_line_links"
    ADD CONSTRAINT "customer_line_links_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================
-- ChatSession
-- ============================================================
CREATE TABLE IF NOT EXISTS "chat_sessions" (
  "id" TEXT NOT NULL,
  "line_user_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "channel" "ChatChannel" NOT NULL DEFAULT 'LINE_FINANCE',
  "status" "ChatStatus" NOT NULL DEFAULT 'ACTIVE',
  "verified_at" TIMESTAMP(3),
  "verification_attempts" INTEGER NOT NULL DEFAULT 0,
  "handoff_mode" BOOLEAN NOT NULL DEFAULT false,
  "handoff_reason" TEXT,
  "handoff_tagged_at" TIMESTAMP(3),
  "handoff_staff_id" TEXT,
  "total_messages" INTEGER NOT NULL DEFAULT 0,
  "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "chat_sessions_line_user_id_channel_key"
  ON "chat_sessions"("line_user_id", "channel");
CREATE INDEX IF NOT EXISTS "chat_sessions_customer_id_idx" ON "chat_sessions"("customer_id");
CREATE INDEX IF NOT EXISTS "chat_sessions_handoff_mode_status_idx" ON "chat_sessions"("handoff_mode", "status");

DO $$ BEGIN
  ALTER TABLE "chat_sessions"
    ADD CONSTRAINT "chat_sessions_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "chat_sessions"
    ADD CONSTRAINT "chat_sessions_handoff_staff_id_fkey"
    FOREIGN KEY ("handoff_staff_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================
-- ChatMessage
-- ============================================================
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "role" "MessageRole" NOT NULL,
  "type" "MessageType" NOT NULL DEFAULT 'TEXT',
  "text" TEXT,
  "media_url" TEXT,
  "media_type" TEXT,
  "intent" TEXT,
  "confidence" DOUBLE PRECISION,
  "tools_used" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "model_used" TEXT,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "cost_usd" DECIMAL(10,6),
  "vision_extracted" JSONB,
  "payment_id" TEXT,
  "receipt_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "chat_messages_session_id_created_at_idx" ON "chat_messages"("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "chat_messages_intent_idx" ON "chat_messages"("intent");
CREATE INDEX IF NOT EXISTS "chat_messages_role_idx" ON "chat_messages"("role");

DO $$ BEGIN
  ALTER TABLE "chat_messages"
    ADD CONSTRAINT "chat_messages_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================
-- ChatKnowledgeBase
-- ============================================================
CREATE TABLE IF NOT EXISTS "chat_knowledge_base" (
  "id" TEXT NOT NULL,
  "channel" "ChatChannel" NOT NULL DEFAULT 'LINE_FINANCE',
  "category" TEXT NOT NULL,
  "intent" TEXT NOT NULL,
  "trigger_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "example_questions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "response_template" TEXT NOT NULL,
  "response_type" TEXT NOT NULL,
  "requires_auth" BOOLEAN NOT NULL DEFAULT true,
  "requires_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "chat_knowledge_base_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "chat_knowledge_base_channel_intent_idx" ON "chat_knowledge_base"("channel", "intent");
CREATE INDEX IF NOT EXISTS "chat_knowledge_base_active_priority_idx" ON "chat_knowledge_base"("active", "priority");

-- ============================================================
-- ChatAutoTrigger
-- ============================================================
CREATE TABLE IF NOT EXISTS "chat_auto_triggers" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "trigger_type" "AutoTriggerType" NOT NULL,
  "scheduled_for" TIMESTAMP(3) NOT NULL,
  "sent_at" TIMESTAMP(3),
  "status" "TriggerStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB NOT NULL,
  "message_id" TEXT,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_auto_triggers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "chat_auto_triggers_scheduled_for_status_idx" ON "chat_auto_triggers"("scheduled_for", "status");
CREATE INDEX IF NOT EXISTS "chat_auto_triggers_customer_id_idx" ON "chat_auto_triggers"("customer_id");

DO $$ BEGIN
  ALTER TABLE "chat_auto_triggers"
    ADD CONSTRAINT "chat_auto_triggers_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
