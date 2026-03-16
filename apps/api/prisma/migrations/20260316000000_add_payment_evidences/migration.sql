-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "payment_evidences" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "line_user_id" TEXT,
    "image_url" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "status" "EvidenceStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_evidences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_evidences_contract_id_idx" ON "payment_evidences"("contract_id");
CREATE INDEX "payment_evidences_status_idx" ON "payment_evidences"("status");
CREATE INDEX "payment_evidences_line_user_id_idx" ON "payment_evidences"("line_user_id");

-- AddForeignKey
ALTER TABLE "payment_evidences" ADD CONSTRAINT "payment_evidences_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_evidences" ADD CONSTRAINT "payment_evidences_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_evidences" ADD CONSTRAINT "payment_evidences_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
