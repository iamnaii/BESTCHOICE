-- Unified Chat Engine: Phase 1-4 foundation
-- New enums, extended models, new models for chat engine + ads + CRM

-- New enums
CREATE TYPE "ChatSessionStatus" AS ENUM ('OPEN', 'PENDING', 'HANDOFF', 'RESOLVED', 'ARCHIVED');
CREATE TYPE "ChatPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');
CREATE TYPE "AdsPlatform" AS ENUM ('LINE_ADS', 'FACEBOOK_ADS', 'TIKTOK_ADS', 'GOOGLE_ADS');
CREATE TYPE "LeadStage" AS ENUM ('NEW_LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');
CREATE TYPE "LeadSource" AS ENUM ('CHAT', 'WALK_IN', 'REFERRAL', 'ADS', 'PHONE');
CREATE TYPE "CustomerTier" AS ENUM ('VIP', 'STANDARD', 'AT_RISK', 'NEW');

-- Extend ChatChannel enum
ALTER TYPE "ChatChannel" ADD VALUE IF NOT EXISTS 'WEB';

-- Extend ChatSession
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "external_user_id" TEXT;
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "session_status" "ChatSessionStatus" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "priority" "ChatPriority" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "assigned_to_id" TEXT;
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "first_response_at" TIMESTAMP(3);
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "resolved_at" TIMESTAMP(3);

-- FK for assigned_to
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_assigned_to_id_fkey"
  FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes for ChatSession
CREATE INDEX IF NOT EXISTS "chat_sessions_assigned_to_id_session_status_idx" ON "chat_sessions"("assigned_to_id", "session_status");
CREATE INDEX IF NOT EXISTS "chat_sessions_session_status_priority_idx" ON "chat_sessions"("session_status", "priority");

-- Extend ChatMessage
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "external_message_id" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "staff_id" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP(3);
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP(3);

-- Unique on external_message_id (skip nulls)
CREATE UNIQUE INDEX IF NOT EXISTS "chat_messages_external_message_id_key" ON "chat_messages"("external_message_id") WHERE "external_message_id" IS NOT NULL;

-- FK for staff
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "chat_messages_staff_id_idx" ON "chat_messages"("staff_id");

-- ConversationTag
CREATE TABLE IF NOT EXISTS "conversation_tags" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "tag" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_tags_session_id_tag_key" ON "conversation_tags"("session_id", "tag");
CREATE INDEX IF NOT EXISTS "conversation_tags_tag_idx" ON "conversation_tags"("tag");

-- CannedResponse
CREATE TABLE IF NOT EXISTS "canned_responses" (
  "id" TEXT NOT NULL,
  "shortcut" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "category" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "canned_responses_shortcut_key" ON "canned_responses"("shortcut");
CREATE INDEX IF NOT EXISTS "canned_responses_is_active_category_idx" ON "canned_responses"("is_active", "category");
CREATE INDEX IF NOT EXISTS "canned_responses_deleted_at_idx" ON "canned_responses"("deleted_at");

-- StaffChatActivity
CREATE TABLE IF NOT EXISTS "staff_chat_activities" (
  "id" TEXT NOT NULL,
  "staff_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_chat_activities_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "staff_chat_activities" ADD CONSTRAINT "staff_chat_activities_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "staff_chat_activities_staff_id_created_at_idx" ON "staff_chat_activities"("staff_id", "created_at");
CREATE INDEX IF NOT EXISTS "staff_chat_activities_action_idx" ON "staff_chat_activities"("action");

-- ChatNote
CREATE TABLE IF NOT EXISTS "chat_notes" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "staff_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "chat_notes_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "chat_notes" ADD CONSTRAINT "chat_notes_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_notes" ADD CONSTRAINT "chat_notes_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "chat_notes_session_id_idx" ON "chat_notes"("session_id");
CREATE INDEX IF NOT EXISTS "chat_notes_staff_id_idx" ON "chat_notes"("staff_id");
CREATE INDEX IF NOT EXISTS "chat_notes_deleted_at_idx" ON "chat_notes"("deleted_at");

-- AdsCampaign
CREATE TABLE IF NOT EXISTS "ads_campaigns" (
  "id" TEXT NOT NULL,
  "platform" "AdsPlatform" NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "campaign_name" TEXT NOT NULL,
  "ad_set_name" TEXT,
  "ad_name" TEXT,
  "budget" DECIMAL(12,2),
  "start_date" TIMESTAMP(3),
  "end_date" TIMESTAMP(3),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "ads_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ads_campaigns_platform_campaign_id_key" ON "ads_campaigns"("platform", "campaign_id");
CREATE INDEX IF NOT EXISTS "ads_campaigns_is_active_idx" ON "ads_campaigns"("is_active");
CREATE INDEX IF NOT EXISTS "ads_campaigns_deleted_at_idx" ON "ads_campaigns"("deleted_at");

-- AdsAttribution
CREATE TABLE IF NOT EXISTS "ads_attributions" (
  "id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "contract_id" TEXT,
  "utm_source" TEXT,
  "utm_medium" TEXT,
  "utm_campaign" TEXT,
  "utm_content" TEXT,
  "referrer_url" TEXT,
  "first_touch" TIMESTAMP(3) NOT NULL,
  "last_touch" TIMESTAMP(3),
  "converted_at" TIMESTAMP(3),
  "revenue" DECIMAL(12,2),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ads_attributions_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ads_attributions" ADD CONSTRAINT "ads_attributions_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "ads_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ads_attributions" ADD CONSTRAINT "ads_attributions_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ads_attributions" ADD CONSTRAINT "ads_attributions_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ads_attributions_campaign_id_idx" ON "ads_attributions"("campaign_id");
CREATE INDEX IF NOT EXISTS "ads_attributions_customer_id_idx" ON "ads_attributions"("customer_id");
CREATE INDEX IF NOT EXISTS "ads_attributions_utm_source_utm_campaign_idx" ON "ads_attributions"("utm_source", "utm_campaign");

-- CrmLead
CREATE TABLE IF NOT EXISTS "crm_leads" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT,
  "contract_id" TEXT,
  "stage" "LeadStage" NOT NULL DEFAULT 'NEW_LEAD',
  "source" "LeadSource" NOT NULL,
  "channel" TEXT,
  "assigned_to_id" TEXT,
  "branch_id" TEXT,
  "interested_product" TEXT,
  "estimated_value" DECIMAL(12,2),
  "lost_reason" TEXT,
  "won_at" TIMESTAMP(3),
  "lost_at" TIMESTAMP(3),
  "next_follow_up" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_assigned_to_id_fkey"
  FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "crm_leads_stage_assigned_to_id_idx" ON "crm_leads"("stage", "assigned_to_id");
CREATE INDEX IF NOT EXISTS "crm_leads_customer_id_idx" ON "crm_leads"("customer_id");
CREATE INDEX IF NOT EXISTS "crm_leads_branch_id_stage_idx" ON "crm_leads"("branch_id", "stage");
CREATE INDEX IF NOT EXISTS "crm_leads_deleted_at_idx" ON "crm_leads"("deleted_at");

-- CrmNote
CREATE TABLE IF NOT EXISTS "crm_notes" (
  "id" TEXT NOT NULL,
  "lead_id" TEXT NOT NULL,
  "staff_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_notes_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "crm_notes_lead_id_idx" ON "crm_notes"("lead_id");

-- CustomerScore
CREATE TABLE IF NOT EXISTS "customer_scores" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "payment_score" INTEGER NOT NULL DEFAULT 50,
  "engagement_score" INTEGER NOT NULL DEFAULT 50,
  "value_score" INTEGER NOT NULL DEFAULT 50,
  "risk_score" INTEGER NOT NULL DEFAULT 50,
  "total_score" INTEGER NOT NULL DEFAULT 50,
  "tier" "CustomerTier" NOT NULL DEFAULT 'STANDARD',
  "last_calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_scores_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "customer_scores" ADD CONSTRAINT "customer_scores_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS "customer_scores_customer_id_key" ON "customer_scores"("customer_id");
