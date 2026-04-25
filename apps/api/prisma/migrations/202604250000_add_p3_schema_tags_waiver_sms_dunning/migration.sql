-- ============================================================
-- P3 Collections UI Enhancements (2026-04-25)
-- - CustomerTag: customer segmentation (VIP/HIGH_RISK/NEW/LOYAL/BLACKLIST), AUTO + MANUAL
-- - LateFeeWaiverRequest: collector → OWNER approval workflow w/ audit trail
-- - SmsTemplate: configurable LINE/SMS templates with A/B variant self-relation
-- - DunningRule.tag_conditions: JSONB per-tag overrides (skip / delay / immediate / skip-soft)
-- ============================================================

-- CreateEnum
CREATE TYPE "CustomerTagType" AS ENUM ('VIP', 'HIGH_RISK', 'NEW', 'LOYAL', 'BLACKLIST');

-- CreateEnum
CREATE TYPE "CustomerTagSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "LateFeeWaiverStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: per-tag dunning overrides
ALTER TABLE "dunning_rules"
  ADD COLUMN "tag_conditions" JSONB;

-- CreateTable: customer segmentation tags
CREATE TABLE "customer_tags" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "tag" "CustomerTagType" NOT NULL,
    "source" "CustomerTagSource" NOT NULL,
    "reason" TEXT,
    "applied_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable: late fee waiver request → approval workflow
CREATE TABLE "late_fee_waiver_requests" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "payment_ids" TEXT[],
    "reason" TEXT NOT NULL,
    "total_waive_amount" DECIMAL(12,2) NOT NULL,
    "status" "LateFeeWaiverStatus" NOT NULL DEFAULT 'PENDING',
    "requester_user_id" TEXT NOT NULL,
    "approver_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "late_fee_waiver_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: configurable SMS/LINE templates with A/B variants
CREATE TABLE "sms_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "variant_of" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sms_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_tags_customer_id_tag_deleted_at_key" ON "customer_tags"("customer_id", "tag", "deleted_at");

-- CreateIndex
CREATE INDEX "customer_tags_tag_idx" ON "customer_tags"("tag");

-- CreateIndex
CREATE INDEX "customer_tags_customer_id_idx" ON "customer_tags"("customer_id");

-- CreateIndex
CREATE INDEX "late_fee_waiver_requests_status_created_at_idx" ON "late_fee_waiver_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "late_fee_waiver_requests_contract_id_idx" ON "late_fee_waiver_requests"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_templates_name_key" ON "sms_templates"("name");

-- CreateIndex
CREATE INDEX "sms_templates_channel_active_idx" ON "sms_templates"("channel", "active");

-- AddForeignKey
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_applied_by_user_id_fkey" FOREIGN KEY ("applied_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_fee_waiver_requests" ADD CONSTRAINT "late_fee_waiver_requests_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_fee_waiver_requests" ADD CONSTRAINT "late_fee_waiver_requests_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_fee_waiver_requests" ADD CONSTRAINT "late_fee_waiver_requests_approver_user_id_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_variant_of_fkey" FOREIGN KEY ("variant_of") REFERENCES "sms_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
