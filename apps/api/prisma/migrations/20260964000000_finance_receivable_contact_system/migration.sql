-- CreateEnum
CREATE TYPE "FinanceContactChannel" AS ENUM ('CALL', 'EMAIL', 'LINE', 'MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "FinanceContactResult" AS ENUM ('ANSWERED', 'NO_ANSWER', 'PROMISED', 'DISPUTED', 'REQUESTED_DOCS', 'OTHER');

-- AlterTable
ALTER TABLE "external_finance_companies" ADD COLUMN     "credit_term_days" INTEGER,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "line_oa_id" TEXT,
ADD COLUMN     "tax_id" TEXT;

-- AlterTable
ALTER TABLE "finance_receivables" ADD COLUMN     "contact_attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "external_finance_company_id" TEXT,
ADD COLUMN     "last_contacted_at" TIMESTAMP(3),
ADD COLUMN     "last_promised_date" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "finance_company_contacts" (
    "id" TEXT NOT NULL,
    "external_finance_company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "department" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "line_id" TEXT,
    "notes" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "finance_company_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_receivable_contact_logs" (
    "id" TEXT NOT NULL,
    "finance_receivable_id" TEXT NOT NULL,
    "external_finance_company_id" TEXT NOT NULL,
    "finance_company_contact_id" TEXT,
    "contacted_by_id" TEXT NOT NULL,
    "contacted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" "FinanceContactChannel" NOT NULL DEFAULT 'CALL',
    "result" "FinanceContactResult" NOT NULL,
    "notes" TEXT,
    "promised_date" TIMESTAMP(3),
    "promised_amount" DECIMAL(12,2),
    "promised_broken_at" TIMESTAMP(3),
    "promised_kept_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "finance_receivable_contact_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_company_contacts_external_finance_company_id_is_act_idx" ON "finance_company_contacts"("external_finance_company_id", "is_active");

-- CreateIndex
CREATE INDEX "finance_receivable_contact_logs_finance_receivable_id_conta_idx" ON "finance_receivable_contact_logs"("finance_receivable_id", "contacted_at");

-- CreateIndex
CREATE INDEX "finance_receivable_contact_logs_external_finance_company_id_idx" ON "finance_receivable_contact_logs"("external_finance_company_id", "contacted_at");

-- CreateIndex
CREATE INDEX "finance_receivable_contact_logs_promised_date_promised_brok_idx" ON "finance_receivable_contact_logs"("promised_date", "promised_broken_at", "promised_kept_at");

-- CreateIndex
CREATE INDEX "finance_receivables_external_finance_company_id_status_idx" ON "finance_receivables"("external_finance_company_id", "status");

-- CreateIndex
CREATE INDEX "finance_receivables_last_contacted_at_idx" ON "finance_receivables"("last_contacted_at");

-- AddForeignKey
ALTER TABLE "finance_receivables" ADD CONSTRAINT "finance_receivables_external_finance_company_id_fkey" FOREIGN KEY ("external_finance_company_id") REFERENCES "external_finance_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_company_contacts" ADD CONSTRAINT "finance_company_contacts_external_finance_company_id_fkey" FOREIGN KEY ("external_finance_company_id") REFERENCES "external_finance_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_receivable_contact_logs" ADD CONSTRAINT "finance_receivable_contact_logs_finance_receivable_id_fkey" FOREIGN KEY ("finance_receivable_id") REFERENCES "finance_receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_receivable_contact_logs" ADD CONSTRAINT "finance_receivable_contact_logs_external_finance_company_i_fkey" FOREIGN KEY ("external_finance_company_id") REFERENCES "external_finance_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_receivable_contact_logs" ADD CONSTRAINT "finance_receivable_contact_logs_finance_company_contact_id_fkey" FOREIGN KEY ("finance_company_contact_id") REFERENCES "finance_company_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_receivable_contact_logs" ADD CONSTRAINT "finance_receivable_contact_logs_contacted_by_id_fkey" FOREIGN KEY ("contacted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index: at most one primary contact per company (excluding soft-deleted rows)
CREATE UNIQUE INDEX uniq_primary_per_company
  ON finance_company_contacts (external_finance_company_id)
  WHERE is_primary = true AND deleted_at IS NULL;
