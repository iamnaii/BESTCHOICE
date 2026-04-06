-- CreateTable
CREATE TABLE "bad_debt_provisions" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "provision_date" TIMESTAMP(3) NOT NULL,
    "aging_bucket" TEXT NOT NULL,
    "days_overdue" INTEGER NOT NULL,
    "outstanding_amount" DECIMAL(12,2) NOT NULL,
    "provision_rate" DECIMAL(5,4) NOT NULL,
    "provision_amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "written_off_at" TIMESTAMP(3),
    "written_off_by_id" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "bad_debt_provisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bad_debt_provisions_contract_id_idx" ON "bad_debt_provisions"("contract_id");

-- CreateIndex
CREATE INDEX "bad_debt_provisions_provision_date_idx" ON "bad_debt_provisions"("provision_date");

-- CreateIndex
CREATE INDEX "bad_debt_provisions_status_idx" ON "bad_debt_provisions"("status");

-- AddForeignKey
ALTER TABLE "bad_debt_provisions" ADD CONSTRAINT "bad_debt_provisions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
