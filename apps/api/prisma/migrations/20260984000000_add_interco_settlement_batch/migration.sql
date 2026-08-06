-- CreateEnum
CREATE TYPE "InterCoBatchStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REVERSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "inter_co_settlement_batches" (
    "id" TEXT NOT NULL,
    "batch_number" TEXT NOT NULL,
    "status" "InterCoBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "transfer_date" TIMESTAMP(3) NOT NULL,
    "posted_at" TIMESTAMP(3),
    "finance_bank_code" TEXT NOT NULL,
    "shop_bank_code" TEXT NOT NULL,
    "total_financed" DECIMAL(12,2) NOT NULL,
    "total_commission" DECIMAL(12,2) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "shop_posted_amount" DECIMAL(12,2) NOT NULL,
    "transfer_ref" TEXT,
    "slip_file_key" TEXT,
    "note" TEXT,
    "maker_id" TEXT NOT NULL,
    "approver_id" TEXT,
    "finance_journal_entry_id" TEXT,
    "shop_journal_entry_id" TEXT,
    "reverse_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "inter_co_settlement_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inter_co_settlement_items" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "financed_gl" DECIMAL(12,2) NOT NULL,
    "commission_gl" DECIMAL(12,2) NOT NULL,
    "shop_financed_gl" DECIMAL(12,2) NOT NULL,
    "shop_commission_gl" DECIMAL(12,2) NOT NULL,
    "legacy_no_shop" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "inter_co_settlement_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inter_co_settlement_batches_batch_number_key" ON "inter_co_settlement_batches"("batch_number");

-- CreateIndex
CREATE UNIQUE INDEX "inter_co_settlement_batches_finance_journal_entry_id_key" ON "inter_co_settlement_batches"("finance_journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "inter_co_settlement_batches_shop_journal_entry_id_key" ON "inter_co_settlement_batches"("shop_journal_entry_id");

-- CreateIndex
CREATE INDEX "inter_co_settlement_batches_status_idx" ON "inter_co_settlement_batches"("status");

-- CreateIndex
CREATE INDEX "inter_co_settlement_batches_transfer_date_idx" ON "inter_co_settlement_batches"("transfer_date");

-- CreateIndex
CREATE INDEX "inter_co_settlement_items_contract_id_idx" ON "inter_co_settlement_items"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "inter_co_settlement_items_batch_id_contract_id_key" ON "inter_co_settlement_items"("batch_id", "contract_id");

-- AddForeignKey
ALTER TABLE "inter_co_settlement_batches" ADD CONSTRAINT "inter_co_settlement_batches_maker_id_fkey" FOREIGN KEY ("maker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inter_co_settlement_batches" ADD CONSTRAINT "inter_co_settlement_batches_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inter_co_settlement_items" ADD CONSTRAINT "inter_co_settlement_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "inter_co_settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inter_co_settlement_items" ADD CONSTRAINT "inter_co_settlement_items_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
