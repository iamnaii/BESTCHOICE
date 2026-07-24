-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "cn_source" TEXT,
ADD COLUMN     "public_token" TEXT,
ADD COLUMN     "public_token_expires_at" TIMESTAMP(3),
ADD COLUMN     "source_journal_entry_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "receipts_public_token_key" ON "receipts"("public_token");

-- CreateIndex (partial unique — only one CN receipt per contract per source; excludes soft-deleted rows)
CREATE UNIQUE INDEX "receipts_contract_cn_source_key" ON "receipts"("contract_id", "cn_source") WHERE "cn_source" IS NOT NULL AND "deleted_at" IS NULL;
