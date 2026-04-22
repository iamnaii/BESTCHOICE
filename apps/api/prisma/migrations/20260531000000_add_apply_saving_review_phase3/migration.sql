-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'SCHEDULED', 'IN_REVIEW', 'APPROVED', 'CONTRACT_SIGNED', 'REJECTED', 'NO_SHOW', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SavingPlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TradeInSubmissionSource" AS ENUM ('OFFLINE', 'ONLINE');

-- CreateEnum
CREATE TYPE "TradeInFlow" AS ENUM ('EXCHANGE', 'BUYBACK');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'FLAGGED');

-- AlterTable
ALTER TABLE "trade_ins"
    ADD COLUMN "submission_source" "TradeInSubmissionSource" NOT NULL DEFAULT 'OFFLINE',
    ADD COLUMN "flow" "TradeInFlow" NOT NULL DEFAULT 'EXCHANGE',
    ADD COLUMN "customer_notes" TEXT,
    ADD COLUMN "customer_line_id" TEXT,
    ADD COLUMN "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "battery_health" INTEGER;

-- CreateIndex
CREATE INDEX "trade_ins_submission_source_status_idx" ON "trade_ins"("submission_source", "status");

-- CreateIndex
CREATE INDEX "trade_ins_flow_idx" ON "trade_ins"("flow");

-- AlterTable
ALTER TABLE "payment_links" ADD COLUMN "saving_plan_id" TEXT;

-- CreateIndex
CREATE INDEX "payment_links_saving_plan_id_idx" ON "payment_links"("saving_plan_id");

-- CreateTable
CREATE TABLE "online_installment_applications" (
    "id" TEXT NOT NULL,
    "application_number" TEXT NOT NULL,
    "customer_id" TEXT,
    "product_id" TEXT NOT NULL,
    "reservation_id" TEXT,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "national_id" TEXT NOT NULL,
    "proposed_down_payment" DECIMAL(12,2) NOT NULL,
    "proposed_total_months" INTEGER NOT NULL,
    "proposed_monthly_payment" DECIMAL(12,2) NOT NULL,
    "line_user_id" TEXT,
    "notes" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "scheduled_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "reject_reason" TEXT,
    "contract_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "online_installment_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saving_plans" (
    "id" TEXT NOT NULL,
    "plan_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "target_product_model" TEXT,
    "target_product_id" TEXT,
    "target_amount" DECIMAL(12,2) NOT NULL,
    "monthly_amount" DECIMAL(12,2) NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "total_saved" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "SavingPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL,
    "next_payment_due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "applied_to_contract_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "saving_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saving_plan_payments" (
    "id" TEXT NOT NULL,
    "saving_plan_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "payment_method" TEXT NOT NULL,
    "payment_ref" TEXT,
    "payment_link_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saving_plan_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "comment" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_source" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "hidden_reason" TEXT,
    "moderated_by_id" TEXT,
    "moderated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "online_installment_applications_application_number_key" ON "online_installment_applications"("application_number");

-- CreateIndex
CREATE UNIQUE INDEX "online_installment_applications_reservation_id_key" ON "online_installment_applications"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "online_installment_applications_contract_id_key" ON "online_installment_applications"("contract_id");

-- CreateIndex
CREATE INDEX "online_installment_applications_phone_idx" ON "online_installment_applications"("phone");

-- CreateIndex
CREATE INDEX "online_installment_applications_status_idx" ON "online_installment_applications"("status");

-- CreateIndex
CREATE INDEX "online_installment_applications_customer_id_idx" ON "online_installment_applications"("customer_id");

-- CreateIndex
CREATE INDEX "online_installment_applications_created_at_idx" ON "online_installment_applications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "saving_plans_plan_number_key" ON "saving_plans"("plan_number");

-- CreateIndex
CREATE INDEX "saving_plans_customer_id_idx" ON "saving_plans"("customer_id");

-- CreateIndex
CREATE INDEX "saving_plans_status_idx" ON "saving_plans"("status");

-- CreateIndex
CREATE INDEX "saving_plans_next_payment_due_at_idx" ON "saving_plans"("next_payment_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "saving_plan_payments_payment_link_id_key" ON "saving_plan_payments"("payment_link_id");

-- CreateIndex
CREATE INDEX "saving_plan_payments_saving_plan_id_idx" ON "saving_plan_payments"("saving_plan_id");

-- CreateIndex
CREATE INDEX "saving_plan_payments_paid_at_idx" ON "saving_plan_payments"("paid_at");

-- CreateIndex
CREATE INDEX "reviews_product_id_status_idx" ON "reviews"("product_id", "status");

-- CreateIndex
CREATE INDEX "reviews_customer_id_idx" ON "reviews"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_product_id_customer_id_key" ON "reviews"("product_id", "customer_id");

-- AddForeignKey
ALTER TABLE "online_installment_applications" ADD CONSTRAINT "online_installment_applications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_installment_applications" ADD CONSTRAINT "online_installment_applications_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_installment_applications" ADD CONSTRAINT "online_installment_applications_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "product_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_installment_applications" ADD CONSTRAINT "online_installment_applications_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saving_plans" ADD CONSTRAINT "saving_plans_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saving_plans" ADD CONSTRAINT "saving_plans_target_product_id_fkey" FOREIGN KEY ("target_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saving_plan_payments" ADD CONSTRAINT "saving_plan_payments_saving_plan_id_fkey" FOREIGN KEY ("saving_plan_id") REFERENCES "saving_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_saving_plan_id_fkey" FOREIGN KEY ("saving_plan_id") REFERENCES "saving_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
