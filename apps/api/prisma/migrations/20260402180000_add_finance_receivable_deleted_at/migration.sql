-- AlterTable
ALTER TABLE "finance_receivables" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "finance_receivables_deleted_at_idx" ON "finance_receivables"("deleted_at");
