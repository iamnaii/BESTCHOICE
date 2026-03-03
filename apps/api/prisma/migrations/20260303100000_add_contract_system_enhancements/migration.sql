-- CreateEnum
CREATE TYPE "ContractWorkflowStatus" AS ENUM ('CREATING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CreditCheckStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "ContractDocumentType" AS ENUM ('SIGNED_CONTRACT', 'ID_CARD_COPY', 'KYC', 'FACEBOOK_PROFILE', 'FACEBOOK_POST', 'LINE_PROFILE', 'DEVICE_RECEIPT_PHOTO', 'BANK_STATEMENT', 'OTHER');

-- AlterTable: Add workflow and interest fields to contracts
ALTER TABLE "contracts" ADD COLUMN "workflow_status" "ContractWorkflowStatus" NOT NULL DEFAULT 'CREATING';
ALTER TABLE "contracts" ADD COLUMN "reviewed_by_id" TEXT;
ALTER TABLE "contracts" ADD COLUMN "reviewed_at" TIMESTAMP(3);
ALTER TABLE "contracts" ADD COLUMN "review_notes" TEXT;
ALTER TABLE "contracts" ADD COLUMN "payment_due_day" INTEGER;
ALTER TABLE "contracts" ADD COLUMN "interest_config_id" TEXT;

-- CreateTable
CREATE TABLE "interest_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interest_rate" DECIMAL(5,4) NOT NULL,
    "min_down_payment_pct" DECIMAL(5,4) NOT NULL,
    "max_installment_months" INTEGER NOT NULL,
    "min_installment_months" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interest_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_documents" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "document_type" "ContractDocumentType" NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_size" INTEGER,
    "notes" TEXT,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_checks" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "status" "CreditCheckStatus" NOT NULL DEFAULT 'PENDING',
    "bank_name" TEXT,
    "statement_files" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "statement_months" INTEGER NOT NULL DEFAULT 3,
    "ai_analysis" JSONB,
    "ai_score" INTEGER,
    "ai_summary" TEXT,
    "ai_recommendation" TEXT,
    "checked_by_id" TEXT,
    "checked_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contracts_workflow_status_idx" ON "contracts"("workflow_status");

-- CreateIndex
CREATE INDEX "contract_documents_contract_id_idx" ON "contract_documents"("contract_id");

-- CreateIndex
CREATE INDEX "contract_documents_document_type_idx" ON "contract_documents"("document_type");

-- CreateIndex
CREATE UNIQUE INDEX "credit_checks_contract_id_key" ON "credit_checks"("contract_id");

-- CreateIndex
CREATE INDEX "credit_checks_contract_id_idx" ON "credit_checks"("contract_id");

-- CreateIndex
CREATE INDEX "credit_checks_customer_id_idx" ON "credit_checks"("customer_id");

-- CreateIndex
CREATE INDEX "credit_checks_status_idx" ON "credit_checks"("status");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_interest_config_id_fkey" FOREIGN KEY ("interest_config_id") REFERENCES "interest_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_checks" ADD CONSTRAINT "credit_checks_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_checks" ADD CONSTRAINT "credit_checks_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_checks" ADD CONSTRAINT "credit_checks_checked_by_id_fkey" FOREIGN KEY ("checked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
