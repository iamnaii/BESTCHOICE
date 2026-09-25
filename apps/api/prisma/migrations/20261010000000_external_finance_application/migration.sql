-- ยื่น GFIN — แพ็กเช็คเครดิตจากห้องแชท (spec 2026-09-24 §4). Additive only.
CREATE TYPE "ExternalFinanceApplicationStatus" AS ENUM ('DRAFT', 'SENT', 'ACKNOWLEDGED', 'MORE_INFO', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ExternalFinanceDocSlot" AS ENUM ('ID_SELFIE', 'ID_CARD', 'INCOME', 'FB_PROFILE', 'FB_FRIENDS', 'FB_ACTIVITY', 'LINE_PROFILE', 'DEVICE_SCREEN', 'DEVICE_PHOTO', 'GUARANTOR_ID', 'ADDRESS_BILL', 'PHONE_OPENING', 'OTHER');
CREATE TYPE "ExternalFinanceFileSource" AS ENUM ('CHAT_MESSAGE', 'UPLOAD', 'PRODUCT_PHOTO');
CREATE TYPE "ExternalFinanceEventKind" AS ENUM ('CREATED', 'SENT', 'RESENT', 'LINK_VIEWED', 'LINK_EXTENDED', 'LINK_REVOKED', 'PARTNER_ACK', 'PARTNER_MORE_INFO', 'PARTNER_APPROVED', 'PARTNER_REJECTED', 'STAFF_RESULT', 'CANCELLED', 'FILES_PURGED');
CREATE TYPE "ExternalFinanceActorType" AS ENUM ('STAFF', 'PARTNER', 'SYSTEM');
CREATE TYPE "ExternalFinanceSendVia" AS ENUM ('BOT', 'COPY');
CREATE TYPE "ExternalFinanceResultSource" AS ENUM ('PARTNER_LINK', 'STAFF');

CREATE TABLE "external_finance_applications" (
  "id" TEXT NOT NULL, "number" TEXT NOT NULL, "finance_company_id" TEXT NOT NULL, "room_id" TEXT NOT NULL,
  "customer_id" TEXT, "product_id" TEXT, "branch_id" TEXT,
  "status" "ExternalFinanceApplicationStatus" NOT NULL DEFAULT 'DRAFT', "result_source" "ExternalFinanceResultSource",
  "summary" JSONB, "message_text" TEXT, "message_override" TEXT, "occupation_override" TEXT,
  "sent_at" TIMESTAMP(3), "sent_by_id" TEXT, "sent_via" "ExternalFinanceSendVia", "line_request_id" TEXT,
  "share_token_hash" TEXT, "share_token_enc" TEXT, "share_expires_at" TIMESTAMP(3), "share_revoked_at" TIMESTAMP(3),
  "share_view_count" INTEGER NOT NULL DEFAULT 0, "share_last_viewed_at" TIMESTAMP(3), "last_partner_event_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3), "files_purged_at" TIMESTAMP(3), "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "deleted_at" TIMESTAMP(3),
  CONSTRAINT "external_finance_applications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "external_finance_applications_number_key" ON "external_finance_applications"("number");
CREATE UNIQUE INDEX "external_finance_applications_share_token_hash_key" ON "external_finance_applications"("share_token_hash");
CREATE INDEX "external_finance_applications_room_id_status_deleted_at_idx" ON "external_finance_applications"("room_id", "status", "deleted_at");
CREATE INDEX "external_finance_applications_customer_id_deleted_at_idx" ON "external_finance_applications"("customer_id", "deleted_at");
CREATE INDEX "external_finance_applications_status_closed_at_files_purged_idx" ON "external_finance_applications"("status", "closed_at", "files_purged_at");
ALTER TABLE "external_finance_applications" ADD CONSTRAINT "external_finance_applications_finance_company_id_fkey" FOREIGN KEY ("finance_company_id") REFERENCES "external_finance_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_finance_applications" ADD CONSTRAINT "external_finance_applications_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_finance_applications" ADD CONSTRAINT "external_finance_applications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "external_finance_applications" ADD CONSTRAINT "external_finance_applications_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "external_finance_applications" ADD CONSTRAINT "external_finance_applications_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "external_finance_applications" ADD CONSTRAINT "external_finance_applications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_finance_applications" ADD CONSTRAINT "external_finance_applications_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "external_finance_application_files" (
  "id" TEXT NOT NULL, "application_id" TEXT NOT NULL, "slot" "ExternalFinanceDocSlot" NOT NULL,
  "storage_key" TEXT, "mime_type" TEXT NOT NULL, "size" INTEGER NOT NULL, "original_name" TEXT,
  "source" "ExternalFinanceFileSource" NOT NULL, "source_message_id" TEXT, "source_angle" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0, "sent_at" TIMESTAMP(3), "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "deleted_at" TIMESTAMP(3),
  CONSTRAINT "external_finance_application_files_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "external_finance_application_files_application_id_deleted_a_idx" ON "external_finance_application_files"("application_id", "deleted_at");
CREATE INDEX "external_finance_application_files_source_message_id_idx" ON "external_finance_application_files"("source_message_id");
ALTER TABLE "external_finance_application_files" ADD CONSTRAINT "external_finance_application_files_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "external_finance_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_finance_application_files" ADD CONSTRAINT "external_finance_application_files_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "external_finance_application_events" (
  "id" TEXT NOT NULL, "application_id" TEXT NOT NULL, "kind" "ExternalFinanceEventKind" NOT NULL,
  "actor_type" "ExternalFinanceActorType" NOT NULL, "actor_user_id" TEXT, "actor_name" TEXT, "note" TEXT, "meta" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_finance_application_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "external_finance_application_events_application_id_created__idx" ON "external_finance_application_events"("application_id", "created_at");
ALTER TABLE "external_finance_application_events" ADD CONSTRAINT "external_finance_application_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "external_finance_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- แถวบริษัท GFIN (ยังไม่มี seed ที่ไหน — ผูกด้วยชื่อ unique; ใบยื่นทุกใบชี้แถวนี้)
INSERT INTO "external_finance_companies" ("id", "name", "is_active", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'GFIN', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
