-- ============================================================
-- P2 Collections UI Enhancements (2026-04-25)
-- - CallLog: voice memo evidence (S3 URL + tier + Glacier restore expiry)
-- - CustomerStatus enum + Customer.status (LOST = skip-tracing target)
-- - LegalCase / LegalCaseDocument: litigation tracking + append-only evidence
-- ============================================================

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'LOST');

-- AlterTable: extend CallLog with voice memo evidence fields
ALTER TABLE "call_logs"
  ADD COLUMN "voice_memo_url" TEXT,
  ADD COLUMN "voice_memo_tier" TEXT DEFAULT 'HOT',
  ADD COLUMN "voice_memo_glacier_restore_expires_at" TIMESTAMP(3);

-- AlterTable: add lifecycle status to Customer (LOST = skip-tracing)
ALTER TABLE "customers"
  ADD COLUMN "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable: legal case file (1:1 with Contract)
CREATE TABLE "legal_cases" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "case_number" TEXT NOT NULL,
    "court" TEXT NOT NULL,
    "hearing_date" TIMESTAMP(3),
    "lawyer_name" TEXT,
    "lawyer_phone" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "legal_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable: append-only legal evidence (complaint, summons, judgment, etc.)
CREATE TABLE "legal_case_documents" (
    "id" TEXT NOT NULL,
    "legal_case_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "s3_url" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by_user_id" TEXT NOT NULL,

    CONSTRAINT "legal_case_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legal_cases_contract_id_key" ON "legal_cases"("contract_id");

-- CreateIndex
CREATE INDEX "legal_cases_contract_id_idx" ON "legal_cases"("contract_id");

-- CreateIndex
CREATE INDEX "legal_case_documents_legal_case_id_idx" ON "legal_case_documents"("legal_case_id");

-- CreateIndex
CREATE INDEX "legal_case_documents_uploaded_by_user_id_idx" ON "legal_case_documents"("uploaded_by_user_id");

-- AddForeignKey
ALTER TABLE "legal_cases" ADD CONSTRAINT "legal_cases_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_case_documents" ADD CONSTRAINT "legal_case_documents_legal_case_id_fkey" FOREIGN KEY ("legal_case_id") REFERENCES "legal_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_case_documents" ADD CONSTRAINT "legal_case_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
